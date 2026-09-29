import { NextRequest, NextResponse, after } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { z } from "zod";
import {
  getPasteByCode,
  deletePaste,
  incrementViews,
  claimPasteForView,
  getAttachmentsByCode,
  deleteAttachmentsBlobs,
} from "@/lib/paste-service";
import { unwrapKey, decryptContent } from "@/lib/crypto";
import { isValidCode } from "@/lib/ids";
import { checkReadLimit } from "@/lib/rate-limit";

export const runtime = "nodejs";

const verifySchema = z.object({
  contentKey: z
    .string()
    .refine((v) => Buffer.from(v, "base64").length === 32, "invalid content key"),
});

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ code: string }> }
) {
  const { code } = await params;

  const { result, active } = await checkReadLimit(req);
  if (active && !result.success) {
    return NextResponse.json({ error: "Too many requests" }, { status: 429 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = verifySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid input" }, { status: 400 });
  }

  const paste = isValidCode(code) ? await getPasteByCode(code) : null;
  if (!paste) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  // Expired -> clean up in the background + 404
  if (paste.expiresAt && paste.expiresAt.getTime() < Date.now()) {
    after(async () => {
      await deleteAttachmentsBlobs(code);
      await deletePaste(code);
    });
    return NextResponse.json({ error: "Expired" }, { status: 404 });
  }

  // Burn-after-read already consumed -> gone
  if (paste.burnAfterRead && paste.consumed) {
    return NextResponse.json({ error: "Gone" }, { status: 410 });
  }

  if (!paste.salt) {
    return NextResponse.json(
      { error: "Not a password-protected paste" },
      { status: 400 }
    );
  }

  const provided = Buffer.from(parsed.data.contentKey, "base64");
  let contentKey: Buffer;
  try {
    contentKey = unwrapKey(Buffer.from(paste.keyWrapped));
  } catch {
    return NextResponse.json({ error: "Invalid paste" }, { status: 500 });
  }
  if (
    contentKey.length !== provided.length ||
    !timingSafeEqual(contentKey, provided)
  ) {
    return NextResponse.json({ error: "Invalid password" }, { status: 401 });
  }

  // Fetch attachments in parallel with decryption.
  const attachmentsPromise = getAttachmentsByCode(code);

  let plaintext: Buffer;
  try {
    plaintext = decryptContent(contentKey, {
      ciphertext: Buffer.from(paste.ciphertext),
      iv: Buffer.from(paste.iv),
      authTag: Buffer.from(paste.authTag),
    });
  } catch {
    return NextResponse.json({ error: "Invalid password" }, { status: 401 });
  }

  const attachments = await attachmentsPromise;

  const isBurn = paste.burnAfterRead;
  if (isBurn) {
    // Atomically mark the paste consumed so a concurrent unlock cannot read
    // it again; the physical delete is deferred until after the response.
    const claimed = await claimPasteForView(code);
    if (!claimed) {
      return NextResponse.json({ error: "Gone" }, { status: 410 });
    }
  }

  after(async () => {
    await incrementViews(code);
    if (isBurn) {
      await deleteAttachmentsBlobs(code);
      await deletePaste(code);
    }
  });

  return NextResponse.json({
    content: plaintext.toString("utf8"),
    burnAfterRead: isBurn,
    expiresAt: paste.expiresAt?.toISOString() ?? null,
    views: paste.views + 1,
    attachments: attachments.map((a) => ({
      id: a.id,
      filename: a.filename,
      mime: a.mime,
      size: a.size,
    })),
  }, { headers: { "Cache-Control": "no-store" } });
}
