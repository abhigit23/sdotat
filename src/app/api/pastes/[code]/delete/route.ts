import { NextRequest, NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { z } from "zod";
import {
  getDeleteTokenHash,
  deletePaste,
  deleteAttachmentsBlobs,
} from "@/lib/paste-service";
import { hashDeleteToken } from "@/lib/crypto";
import { isValidCode } from "@/lib/ids";
import { checkReadLimit } from "@/lib/rate-limit";

export const runtime = "nodejs";

const deleteSchema = z.object({
  // 32 random bytes, base64url: 43 characters.
  token: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
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

  const parsed = deleteSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid delete link" }, { status: 400 });
  }

  const stored = isValidCode(code) ? await getDeleteTokenHash(code) : undefined;
  if (stored === undefined) {
    return NextResponse.json(
      { error: "This paste no longer exists" },
      { status: 404 }
    );
  }

  const provided = hashDeleteToken(parsed.data.token);
  if (
    !stored ||
    stored.length !== provided.length ||
    !timingSafeEqual(Buffer.from(stored), provided)
  ) {
    return NextResponse.json({ error: "Invalid delete link" }, { status: 403 });
  }

  // Blobs first: their paths live in the attachment rows the paste delete
  // cascades away. Anything a failed blob delete leaves behind is swept by the
  // daily orphan cleanup.
  await deleteAttachmentsBlobs(code);
  await deletePaste(code);

  return NextResponse.json({ ok: true });
}
