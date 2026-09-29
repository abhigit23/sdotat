import { NextRequest, NextResponse, after } from "next/server";
import { get } from "@vercel/blob";
import { Readable } from "node:stream";
import { createDecipheriv, timingSafeEqual } from "node:crypto";
import { createInflate } from "node:zlib";
import {
  getAttachmentForDownload,
  deletePaste,
  claimPasteForView,
  deleteAttachmentsBlobs,
} from "@/lib/paste-service";
import { unwrapKey } from "@/lib/crypto";
import { isValidCode } from "@/lib/ids";
import { checkReadLimit } from "@/lib/rate-limit";
import { ATTACHMENT_ID } from "@/lib/validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ALGO = "aes-256-gcm";

/**
 * Content-Disposition value with an ASCII fallback `filename` and an RFC 5987
 * `filename*` so non-ASCII names survive the download.
 */
function contentDisposition(name: string): string {
  const ascii = name.replace(/[^\x20-\x7e]|["\\]/g, "_");
  const encoded = encodeURIComponent(name).replace(
    /['()*]/g,
    (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`
  );
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encoded}`;
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ code: string; id: string }> }
) {
  const { code, id } = await params;

  const { result, active } = await checkReadLimit(req);
  if (active && !result.success) {
    return NextResponse.json({ error: "Too many requests" }, { status: 429 });
  }

  if (!isValidCode(code) || !ATTACHMENT_ID.test(id)) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const row = await getAttachmentForDownload(code, id);
  if (!row) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  const { attachment } = row;

  if (row.expiresAt && row.expiresAt.getTime() < Date.now()) {
    after(async () => {
      await deleteAttachmentsBlobs(code);
      await deletePaste(code);
    });
    return NextResponse.json({ error: "Expired" }, { status: 404 });
  }

  if (row.burnAfterRead && row.consumed) {
    return NextResponse.json({ error: "Gone" }, { status: 410 });
  }

  let contentKey: Buffer;
  try {
    contentKey = unwrapKey(Buffer.from(row.keyWrapped));
    if (row.salt) {
      const providedRaw = req.headers.get("x-paste-key");
      if (!providedRaw) {
        return NextResponse.json({ error: "Invalid password" }, { status: 401 });
      }
      const provided = Buffer.from(providedRaw, "base64");
      if (
        contentKey.length !== provided.length ||
        !timingSafeEqual(contentKey, provided)
      ) {
        return NextResponse.json({ error: "Invalid password" }, { status: 401 });
      }
    }
  } catch {
    return NextResponse.json({ error: "Invalid password" }, { status: 401 });
  }

  const blob = await get(attachment.blobPath, { access: "private" });
  if (!blob || !blob.stream) {
    return NextResponse.json({ error: "File unavailable" }, { status: 500 });
  }
  const blobStream: ReadableStream = blob.stream;

  const decipher = createDecipheriv(
    ALGO,
    contentKey,
    Buffer.from(attachment.iv)
  );
  decipher.setAuthTag(Buffer.from(attachment.authTag));

  try {
    const decrypted = Readable.fromWeb(
      blobStream as Parameters<typeof Readable.fromWeb>[0]
    ).pipe(decipher);
    const plain =
      attachment.compression === "deflate"
        ? decrypted.pipe(createInflate())
        : decrypted;

    if (row.burnAfterRead) {
      // Burn-after-read pastes cannot have attachments, but if this ever
      // happens, atomically consume the paste and delete it after the
      // streamed response finishes instead of blocking the download.
      const claimed = await claimPasteForView(code);
      if (!claimed) {
        return NextResponse.json({ error: "Gone" }, { status: 410 });
      }
      after(async () => {
        await deleteAttachmentsBlobs(code);
        await deletePaste(code);
      });
    }

    // The stored MIME type is uploader-supplied, so never serve it from this
    // origin: the client already knows the real type from the paste metadata.
    const headers = new Headers();
    headers.set("Content-Type", "application/octet-stream");
    headers.set("Content-Disposition", contentDisposition(attachment.filename));
    headers.set("Content-Security-Policy", "default-src 'none'; sandbox");
    headers.set("Cache-Control", "no-store");
    headers.set("X-Content-Type-Options", "nosniff");

    return new Response(
      Readable.toWeb(plain) as unknown as BodyInit,
      { headers }
    );
  } catch {
    return NextResponse.json({ error: "Decryption failed" }, { status: 500 });
  }
}
