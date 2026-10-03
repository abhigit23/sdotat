import { NextRequest, NextResponse } from "next/server";
import { Buffer } from "node:buffer";
import { createPasteSchema, MAX_PASTE_TOTAL_BYTES } from "@/lib/validation";
import {
  encryptPasteText,
  generateContentKey,
  generateDeleteToken,
  sealAttachmentMeta,
  wrapKey,
} from "@/lib/crypto";
import {
  createPaste,
  addAttachments,
  deleteBlobs,
  deletePaste,
  describeDbError,
  pgErrorCode,
} from "@/lib/paste-service";
import { checkCreateLimit, getUploadSizes } from "@/lib/rate-limit";

export const runtime = "nodejs";

/**
 * The pathname a blob's token was issued for: `files/<uuid>`. Blobs are now
 * stored at exactly that path; older ones also carry a `-<suffix>`.
 */
function tokenPathname(blobPathname: string): string {
  return blobPathname.slice(0, "files/".length + 36);
}

/**
 * Checks the client's file entries against the sizes actually stored. The
 * client reports sizes itself, so without this it could under-report them and
 * attach far more than the per-paste limit. Returns an error, or null if OK.
 *
 * Sizes come from the upload-token route's records (one Redis round trip):
 * each is the exact size declared for that upload, and Blob rejects anything
 * larger, so it bounds the stored blob. Files without a record (no Redis, or
 * it expired) fall back to asking Blob, which takes ~0.75 s per lookup.
 */
async function checkUploadedSizes(
  files: Array<{ pathname: string; size: number; compression: string }>
): Promise<{ message: string; status: number } | null> {
  if (!process.env.BLOB_READ_WRITE_TOKEN) {
    return { message: "File attachments are not configured", status: 500 };
  }
  const recorded =
    (await getUploadSizes(files.map((f) => tokenPathname(f.pathname)))) ??
    files.map(() => null);
  const missing = files.filter((_, i) => recorded[i] === null);
  let looked: (number | null)[] = [];
  if (missing.length > 0) {
    // Imported lazily to keep this route's bundle small (see deleteBlobs).
    const { head } = await import("@vercel/blob");
    looked = await Promise.all(
      missing.map((f) => head(f.pathname).then((b) => b.size, () => null))
    );
  }
  let next = 0;
  const sizes = recorded.map((s) => s ?? looked[next++]);
  if (sizes.some((s) => s === null || s === undefined)) {
    return { message: "Uploaded file not found", status: 400 };
  }
  const stored = sizes.reduce<number>((sum, s) => sum + (s ?? 0), 0);
  if (stored > MAX_PASTE_TOTAL_BYTES) {
    return { message: "Total file size exceeds the 100 MB per-paste limit", status: 400 };
  }
  // AES-GCM ciphertext is exactly as long as its plaintext (the auth tag is
  // stored separately), so an uncompressed file's size must match its blob.
  // Deflated sizes can't be checked here; downloads cap their output instead.
  const mismatch = files.some(
    (f, i) => f.compression === "none" && f.size !== sizes[i]
  );
  if (mismatch) {
    return { message: "File size does not match the uploaded file", status: 400 };
  }
  return null;
}

export async function POST(req: NextRequest) {
  const { result, active } = await checkCreateLimit(req);
  if (active && !result.success) {
    return NextResponse.json(
      { error: "Too many requests. Please slow down." },
      { status: 429 }
    );
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = createPasteSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid input" },
      { status: 400 }
    );
  }
  const input = parsed.data;
  const files = input.files;

  // The client uploads blobs before this request, so any rejection past this
  // point must delete them or they are left orphaned in the store.
  const discardUploads = () => deleteBlobs(files.map((f) => f.pathname));

  if (input.burnAfterRead && files.length > 0) {
    await discardUploads();
    return NextResponse.json(
      { error: "Burn-after-read pastes cannot have file attachments" },
      { status: 400 }
    );
  }

  if (files.length > 0) {
    const sizeError = await checkUploadedSizes(files);
    if (sizeError) {
      await discardUploads();
      return NextResponse.json({ error: sizeError.message }, { status: sizeError.status });
    }
  }

  let contentKey: Buffer;
  let salt: Buffer | null = null;

  if (input.contentKey) {
    contentKey = Buffer.from(input.contentKey, "base64");
    if (input.salt) {
      salt = Buffer.from(input.salt, "base64");
    }
  } else {
    contentKey = generateContentKey();
  }

  const { ciphertext, iv, authTag, compression } = encryptPasteText(
    contentKey,
    input.content
  );

  const keyWrapped = wrapKey(contentKey);
  const deleteToken = generateDeleteToken();

  let paste;
  try {
    paste = await createPaste({
      ciphertext,
      iv,
      authTag,
      compression,
      keyWrapped,
      salt,
      deleteTokenHash: deleteToken.hash,
      burnAfterRead: input.burnAfterRead,
      expiresIn: input.expiresIn,
    });
  } catch (e) {
    console.error("createPaste failed", describeDbError(e));
    await discardUploads();
    return NextResponse.json({ error: "Failed to create paste" }, { status: 500 });
  }

  if (files.length > 0) {
    try {
      await addAttachments(
        files.map((f) => ({
          pasteCode: paste.code,
          meta: sealAttachmentMeta(contentKey, {
            filename: f.filename,
            mime: f.mime,
          }),
          size: f.size,
          compression: f.compression,
          blobPath: f.pathname,
          iv: Buffer.from(f.iv, "base64"),
          authTag: Buffer.from(f.authTag, "base64"),
        }))
      );
    } catch (e) {
      await deletePaste(paste.code);
      // A unique violation on blob_path means a file already belongs to
      // another paste; deleting it would break that paste. Leave any genuinely
      // unreferenced blobs to the orphan sweep.
      if (pgErrorCode(e) === "23505") {
        return NextResponse.json(
          { error: "File is already attached to another paste" },
          { status: 409 }
        );
      }
      console.error("addAttachments failed", describeDbError(e));
      await discardUploads();
      return NextResponse.json(
        { error: "Failed to save attachments" },
        { status: 500 }
      );
    }
  }

  const base = (process.env.APP_URL ?? "").replace(/\/$/, "");
  // The delete token goes in the URL fragment, which browsers never send to
  // the server, so it stays out of request logs and referrers.
  return NextResponse.json(
    {
      code: paste.code,
      url: `${base}/${paste.code}`,
      deleteUrl: `${base}/${paste.code}#delete=${deleteToken.token}`,
      expiresAt: paste.expiresAt?.toISOString() ?? null,
    },
    { status: 201 }
  );
}
