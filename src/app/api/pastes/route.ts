import { NextRequest, NextResponse } from "next/server";
import { Buffer } from "node:buffer";
import { createPasteSchema } from "@/lib/validation";
import {
  encryptContent,
  generateContentKey,
  wrapKey,
} from "@/lib/crypto";
import { createPaste, addAttachments, deleteBlobs, deletePaste } from "@/lib/paste-service";
import { checkCreateLimit } from "@/lib/rate-limit";

export const runtime = "nodejs";

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

  const { ciphertext, iv, authTag } = encryptContent(
    contentKey,
    Buffer.from(input.content, "utf8")
  );

  const keyWrapped = wrapKey(contentKey);

  let paste;
  try {
    paste = await createPaste({
      ciphertext,
      iv,
      authTag,
      keyWrapped,
      salt,
      burnAfterRead: input.burnAfterRead,
      expiresIn: input.expiresIn,
    });
  } catch (e) {
    console.error("createPaste failed", e);
    await discardUploads();
    return NextResponse.json({ error: "Failed to create paste" }, { status: 500 });
  }

  if (files.length > 0) {
    try {
      await addAttachments(
        files.map((f) => ({
          pasteCode: paste.code,
          filename: f.filename,
          mime: f.mime,
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
      const err = e as { code?: string; cause?: { code?: string } };
      if ((err.code ?? err.cause?.code) === "23505") {
        return NextResponse.json(
          { error: "File is already attached to another paste" },
          { status: 409 }
        );
      }
      console.error("addAttachments failed", e);
      await discardUploads();
      return NextResponse.json(
        { error: "Failed to save attachments" },
        { status: 500 }
      );
    }
  }

  const base = (process.env.APP_URL ?? "").replace(/\/$/, "");
  return NextResponse.json(
    { code: paste.code, url: `${base}/${paste.code}` },
    { status: 201 }
  );
}
