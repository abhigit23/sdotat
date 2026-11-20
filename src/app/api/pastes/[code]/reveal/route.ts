import { NextRequest, NextResponse } from "next/server";
import { getPasteByCode } from "@/lib/paste-service";
import { unwrapKey } from "@/lib/crypto";
import { revealResponse, unavailableResponse } from "@/lib/paste-view";
import { isValidCode } from "@/lib/ids";
import { checkReadLimit } from "@/lib/rate-limit";

export const runtime = "nodejs";

/** Reveals a paste without a password (the explicit "View" step). */
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

  const unavailable = unavailableResponse(code, paste);
  if (unavailable) return unavailable;

  // This endpoint is only for non-password pastes.
  if (paste.salt) {
    return NextResponse.json({ error: "Password required" }, { status: 400 });
  }

  let contentKey: Buffer;
  try {
    contentKey = unwrapKey(Buffer.from(paste.keyWrapped));
  } catch {
    console.error("unwrapKey failed for", code);
    return NextResponse.json({ error: "Invalid paste" }, { status: 500 });
  }

  // Files are decrypted in the browser, which needs the key for that. This
  // route returns the plaintext text anyway, so the key reveals nothing more.
  return revealResponse(code, paste, contentKey, {
    includeKey: true,
    decryptError: { error: "Decryption failed", status: 500 },
  });
}
