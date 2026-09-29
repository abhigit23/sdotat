import { NextResponse } from "next/server";
import { handleUpload, type HandleUploadBody } from "@vercel/blob/client";
import { checkCreateLimit } from "@/lib/rate-limit";
import { MAX_FILE_BYTES, UPLOAD_PATHNAME } from "@/lib/validation";

export const runtime = "nodejs";

export async function POST(req: Request) {
  const { result, active } = await checkCreateLimit(
    req as Parameters<typeof checkCreateLimit>[0]
  );
  if (active && !result.success) {
    return NextResponse.json(
      { error: "Too many requests. Please slow down." },
      { status: 429 }
    );
  }

  try {
    const jsonResponse = await handleUpload({
      body: (await req.json()) as HandleUploadBody,
      request: req,
      onBeforeGenerateToken: async (pathname) => {
        // Keep uploads under files/ so the orphan sweep can find them.
        if (!UPLOAD_PATHNAME.test(pathname)) {
          throw new Error("Invalid upload path");
        }
        return {
          allowedContentTypes: ["application/octet-stream"],
          maximumSizeInBytes: MAX_FILE_BYTES,
          addRandomSuffix: true,
        };
      },
    });
    return NextResponse.json(jsonResponse);
  } catch (error) {
    return NextResponse.json(
      { error: (error as Error).message },
      { status: 400 }
    );
  }
}