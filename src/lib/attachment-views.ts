import type { Attachment } from "@/db/schema";
import { openAttachmentMeta } from "./crypto";

/**
 * How long a presigned download URL stays valid. The client fetches as soon
 * as the user clicks, so this only needs to cover a page left open a while.
 */
const URL_TTL_MS = 10 * 60 * 1000;
/** Lifetime of the read-only delegation token the URLs are signed with. */
const TOKEN_TTL_MS = 60 * 60 * 1000;

type ReadToken = {
  delegationToken: string;
  clientSigningToken: string;
  validUntil: number;
};

let tokenPromise: Promise<ReadToken> | null = null;

/**
 * A store-wide, GET-only delegation token, cached per function instance so
 * signing a URL is a local HMAC rather than a Blob API call per request.
 * Re-issued once it can no longer cover a full URL lifetime.
 */
async function getReadToken(): Promise<ReadToken> {
  const cached = tokenPromise && (await tokenPromise.catch(() => null));
  if (cached && cached.validUntil - Date.now() > URL_TTL_MS) return cached;
  tokenPromise = (async () => {
    const { issueSignedToken } = await import("@vercel/blob");
    return issueSignedToken({
      pathname: "*",
      operations: ["get"],
      validUntil: Date.now() + TOKEN_TTL_MS,
    });
  })();
  return tokenPromise;
}

/**
 * Short-lived URLs the browser can download the encrypted blobs from directly,
 * so file bytes never pass through a function. The URLs expire with the paste
 * at the latest. Returns null (the client falls back to the download route)
 * when Blob isn't configured or signing fails.
 */
async function presignDownloadUrls(
  blobPaths: string[],
  pasteExpiresAt: Date | null
): Promise<string[] | null> {
  if (blobPaths.length === 0 || !process.env.BLOB_READ_WRITE_TOKEN) return null;
  try {
    const token = await getReadToken();
    const { presignUrl } = await import("@vercel/blob");
    const validUntil = Math.min(
      Date.now() + URL_TTL_MS,
      pasteExpiresAt?.getTime() ?? Infinity
    );
    return await Promise.all(
      blobPaths.map(async (pathname) => {
        const { presignedUrl } = await presignUrl(token, {
          operation: "get",
          pathname,
          access: "private",
          validUntil,
        });
        return presignedUrl;
      })
    );
  } catch (e) {
    console.error("presignDownloadUrls failed", (e as Error)?.message);
    return null;
  }
}

/**
 * The attachment list sent to a viewer: decrypted name and MIME, plus what the
 * browser needs to download and decrypt each file itself (the per-file IV,
 * auth tag and compression, which are not secret, and a presigned URL).
 */
export async function toAttachmentViews(
  contentKey: Buffer,
  attachments: Attachment[],
  pasteExpiresAt: Date | null
) {
  const urls = await presignDownloadUrls(
    attachments.map((a) => a.blobPath),
    pasteExpiresAt
  );
  return attachments.map((a, i) => ({
    ...openAttachmentMeta(contentKey, a),
    id: a.id,
    size: a.size,
    iv: Buffer.from(a.iv).toString("base64"),
    authTag: Buffer.from(a.authTag).toString("base64"),
    compression: a.compression,
    url: urls?.[i],
  }));
}
