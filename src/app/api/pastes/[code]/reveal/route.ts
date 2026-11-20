import { NextRequest, NextResponse, after } from "next/server";
import {
  getPasteByCode,
  deletePaste,
  incrementViews,
  claimPasteForView,
  getAttachmentsByCode,
  deleteAttachmentsBlobs,
} from "@/lib/paste-service";
import { unwrapKey, decryptPasteText } from "@/lib/crypto";
import { toAttachmentViews } from "@/lib/attachment-views";
import { isValidCode } from "@/lib/ids";
import { checkReadLimit } from "@/lib/rate-limit";

export const runtime = "nodejs";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ code: string }> }
) {
  const { code } = await params;

  const { result, active } = await checkReadLimit(req);
  if (active && !result.success) {
    return NextResponse.json({ error: "Too many requests" }, { status: 429 });
  }

  const paste = isValidCode(code) ? await getPasteByCode(code) : null;
  if (!paste) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  if (paste.expiresAt && paste.expiresAt.getTime() < Date.now()) {
    after(async () => {
      await deleteAttachmentsBlobs(code);
      await deletePaste(code);
    });
    return NextResponse.json({ error: "Expired" }, { status: 404 });
  }

  if (paste.burnAfterRead && paste.consumed) {
    return NextResponse.json({ error: "Gone" }, { status: 410 });
  }

  // This endpoint is only for non-password pastes.
  if (paste.salt) {
    return NextResponse.json(
      { error: "Password required" },
      { status: 400 }
    );
  }

  // Fetch attachments in parallel with decryption — the two are independent.
  const attachmentsPromise = getAttachmentsByCode(code);

  let contentKey: Buffer;
  try {
    contentKey = unwrapKey(Buffer.from(paste.keyWrapped));
  } catch {
    console.error("unwrapKey failed for", code);
    return NextResponse.json({ error: "Invalid paste" }, { status: 500 });
  }

  let plaintext: string;
  try {
    plaintext = decryptPasteText(contentKey, {
      ciphertext: Buffer.from(paste.ciphertext),
      iv: Buffer.from(paste.iv),
      authTag: Buffer.from(paste.authTag),
      compression: paste.compression,
    });
  } catch {
    return NextResponse.json({ error: "Decryption failed" }, { status: 500 });
  }

  const attachments = await attachmentsPromise;

  const isBurn = paste.burnAfterRead;
  if (isBurn) {
    // Atomically mark the paste consumed so a concurrent reveal cannot read
    // it again; the physical delete is deferred until after the response.
    const claimed = await claimPasteForView(code);
    if (!claimed) {
      return NextResponse.json({ error: "Gone" }, { status: 410 });
    }
  }

  after(async () => {
    // A burned paste is deleted, so counting its view is a wasted write.
    if (isBurn) {
      await deleteAttachmentsBlobs(code);
      await deletePaste(code);
    } else {
      await incrementViews(code);
    }
  });

  return NextResponse.json({
    content: plaintext,
    burnAfterRead: isBurn,
    expiresAt: paste.expiresAt?.toISOString() ?? null,
    views: paste.views + 1,
    // Files are decrypted in the browser, which needs the key for that. This
    // route returns the plaintext text anyway, so it reveals nothing more.
    // (Password pastes have the key client-side already.)
    contentKey:
      attachments.length > 0 ? contentKey.toString("base64") : undefined,
    attachments: await toAttachmentViews(
      contentKey,
      attachments,
      paste.expiresAt
    ),
  }, { headers: { "Cache-Control": "no-store" } });
}
