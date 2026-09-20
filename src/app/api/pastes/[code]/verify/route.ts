import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import {
  getPasteByCode,
  deletePaste,
  incrementViews,
  getAttachmentsByCode,
  deleteAttachmentsBlobs,
} from "@/lib/paste-service";
import { decryptContent, deriveKeyFromPassword } from "@/lib/crypto";
import { checkReadLimit } from "@/lib/rate-limit";

export const runtime = "nodejs";

const verifySchema = z.object({
  password: z.string().max(256).optional().default(""),
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

  const paste = await getPasteByCode(code);
  if (!paste) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  // Expired -> delete + 404
  if (paste.expiresAt && paste.expiresAt.getTime() < Date.now()) {
    await deleteAttachmentsBlobs(code);
    await deletePaste(code);
    return NextResponse.json({ error: "Expired" }, { status: 404 });
  }

  // Burn-after-read already consumed -> gone
  if (paste.burnAfterRead && paste.consumed) {
    return NextResponse.json({ error: "Gone" }, { status: 410 });
  }

  // Password required to decrypt
  const password = parsed.data.password;
  let contentKey: Buffer;
  try {
    if (!paste.salt) {
      throw new Error("Missing salt for password-protected paste");
    }
    contentKey = deriveKeyFromPassword(password, Buffer.from(paste.salt)).key;
  } catch {
    return NextResponse.json({ error: "Invalid password" }, { status: 401 });
  }

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

  await incrementViews(code);

  const attachments = await getAttachmentsByCode(code);

  const isBurn = paste.burnAfterRead;
  if (isBurn) {
    // Delete immediately so a refresh/prefetch cannot read it again.
    await deleteAttachmentsBlobs(code);
    await deletePaste(code);
  }

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
  });
}
