import { NextResponse, after } from "next/server";
import type { Paste } from "@/db/schema";
import {
  claimPasteForView,
  deletePasteWithBlobs,
  getAttachmentsByCode,
  incrementViews,
} from "./paste-service";
import { decryptPasteText } from "./crypto";
import { toAttachmentViews } from "./attachment-views";

/** True once a paste's expiry time has passed. */
export function isExpired(paste: { expiresAt: Date | null }): boolean {
  return !!paste.expiresAt && paste.expiresAt.getTime() < Date.now();
}

/** Deletes a paste and its blobs after the response is sent. */
export function deleteAfterResponse(code: string): void {
  after(() => deletePasteWithBlobs(code));
}

/**
 * The response for a paste that can no longer be read, or null if it can:
 * 404 when expired (and deletes it after responding, since cron runs only
 * daily), 410 when a burn-after-read paste was already viewed.
 */
export function unavailableResponse(
  code: string,
  paste: Pick<Paste, "expiresAt" | "burnAfterRead" | "consumed">
): NextResponse | null {
  if (isExpired(paste)) {
    deleteAfterResponse(code);
    return NextResponse.json({ error: "Expired" }, { status: 404 });
  }
  if (paste.burnAfterRead && paste.consumed) {
    return NextResponse.json({ error: "Gone" }, { status: 410 });
  }
  return null;
}

/**
 * Decrypts a paste for a viewer who is allowed to see it, and builds the
 * reveal/verify response: the text, the attachment list, and for burn-after-
 * read pastes the atomic claim plus deletion after the response.
 */
export async function revealResponse(
  code: string,
  paste: Paste,
  contentKey: Buffer,
  options: {
    /**
     * Send the content key, so the browser can decrypt the files. Only for
     * non-password pastes: password pastes have the key client-side already.
     */
    includeKey: boolean;
    /** Response when the text fails to decrypt. */
    decryptError: { error: string; status: number };
  }
): Promise<NextResponse> {
  // Fetch attachments in parallel with decryption: the two are independent.
  const attachmentsPromise = getAttachmentsByCode(code);

  let plaintext: string;
  try {
    plaintext = decryptPasteText(contentKey, {
      ciphertext: Buffer.from(paste.ciphertext),
      iv: Buffer.from(paste.iv),
      authTag: Buffer.from(paste.authTag),
      compression: paste.compression,
    });
  } catch {
    attachmentsPromise.catch(() => {});
    const { error, status } = options.decryptError;
    return NextResponse.json({ error }, { status });
  }

  const attachments = await attachmentsPromise;

  const isBurn = paste.burnAfterRead;
  if (isBurn) {
    // Atomically mark the paste consumed so a concurrent request cannot read
    // it again; the physical delete is deferred until after the response.
    if (!(await claimPasteForView(code))) {
      return NextResponse.json({ error: "Gone" }, { status: 410 });
    }
    deleteAfterResponse(code);
  } else {
    // A burned paste is deleted, so counting its view would be a wasted write.
    after(() => incrementViews(code));
  }

  return NextResponse.json(
    {
      content: plaintext,
      burnAfterRead: isBurn,
      expiresAt: paste.expiresAt?.toISOString() ?? null,
      views: paste.views + 1,
      contentKey:
        options.includeKey && attachments.length > 0
          ? contentKey.toString("base64")
          : undefined,
      attachments: await toAttachmentViews(
        contentKey,
        attachments,
        paste.expiresAt
      ),
    },
    { headers: { "Cache-Control": "no-store" } }
  );
}
