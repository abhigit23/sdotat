import { NextResponse } from "next/server";
import { handleUpload, type HandleUploadBody } from "@vercel/blob/client";
import {
  checkUploadLimit,
  claimUploadSize,
  reserveUploadBytes,
} from "@/lib/rate-limit";
import { MAX_FILE_BYTES, UPLOAD_PATHNAME } from "@/lib/validation";

export const runtime = "nodejs";

class QuotaError extends Error {}

/**
 * Size of the encrypted file the client is about to upload, sent as the
 * upload's `clientPayload` (`{"size": <bytes>}`).
 */
function parseDeclaredSize(clientPayload: string | null): number {
  try {
    const { size } = JSON.parse(clientPayload ?? "") as { size?: unknown };
    if (
      typeof size === "number" &&
      Number.isInteger(size) &&
      size > 0 &&
      size <= MAX_FILE_BYTES
    ) {
      return size;
    }
  } catch {}
  throw new Error("Invalid upload size");
}

export async function POST(req: Request) {
  const nextReq = req as Parameters<typeof checkUploadLimit>[0];
  const { result, active } = await checkUploadLimit(nextReq);
  if (active && !result.success) {
    return NextResponse.json(
      { error: "Too many uploads. Please slow down." },
      { status: 429 }
    );
  }

  try {
    const jsonResponse = await handleUpload({
      body: (await req.json()) as HandleUploadBody,
      request: req,
      onBeforeGenerateToken: async (pathname, clientPayload) => {
        // Keep uploads under files/ so the orphan sweep can find them.
        if (!UPLOAD_PATHNAME.test(pathname)) {
          throw new Error("Invalid upload path");
        }
        const size = parseDeclaredSize(clientPayload);
        // Recorded before the quota so a reused pathname costs no quota.
        if (!(await claimUploadSize(pathname, size))) {
          throw new Error("Invalid upload path");
        }
        if (!(await reserveUploadBytes(nextReq, size))) {
          throw new QuotaError("Daily upload limit reached. Try again tomorrow.");
        }
        return {
          allowedContentTypes: ["application/octet-stream"],
          // Blob rejects anything larger than declared, so the quota can't be
          // dodged by under-reporting.
          maximumSizeInBytes: size,
          // Store at exactly files/<uuid> with overwriting off (the default),
          // so a token can create one blob only. With a random suffix every
          // upload got a new path, letting one token (and one quota charge)
          // upload again and again until it expired. The client's random UUID
          // already makes the path unguessable.
          addRandomSuffix: false,
        };
      },
    });
    return NextResponse.json(jsonResponse);
  } catch (error) {
    return NextResponse.json(
      { error: (error as Error).message },
      { status: error instanceof QuotaError ? 429 : 400 }
    );
  }
}
