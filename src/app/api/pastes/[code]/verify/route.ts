import { NextRequest, NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { getPasteByCode } from "@/lib/paste-service";
import { unwrapKey } from "@/lib/crypto";
import { revealResponse, unavailableResponse } from "@/lib/paste-view";
import { isValidCode } from "@/lib/ids";
import {
  checkReadLimit,
  beginPasswordAttempt,
  refundPasswordAttempt,
  PASSWORD_LOCKED_MESSAGE,
} from "@/lib/rate-limit";
import { contentKeySchema } from "@/lib/validation";

export const runtime = "nodejs";

const verifySchema = z.object({ contentKey: contentKeySchema });

/** Unlocks a password-protected paste with the browser-derived key. */
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

  const unavailable = unavailableResponse(code, paste);
  if (unavailable) return unavailable;

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

  // Checked before comparing, so a locked paste rejects even the right
  // password until the window ends.
  if (!(await beginPasswordAttempt(code, req))) {
    return NextResponse.json({ error: PASSWORD_LOCKED_MESSAGE }, { status: 429 });
  }
  if (
    contentKey.length !== provided.length ||
    !timingSafeEqual(contentKey, provided)
  ) {
    return NextResponse.json({ error: "Invalid password" }, { status: 401 });
  }
  await refundPasswordAttempt(code, req);

  return revealResponse(code, paste, contentKey, {
    includeKey: false,
    decryptError: { error: "Invalid password", status: 401 },
  });
}
