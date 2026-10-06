import {
  bytesToBase64,
  generateContentKey,
  deriveKeyFromPassword,
  prepareFileForUpload,
} from "./client-crypto";
import { mapWithByteBudget } from "./map-concurrency";
import { saveDeleteToken } from "./delete-tokens";

// Raw file bytes allowed in flight at once while uploading (see
// mapWithByteBudget). One file always runs, however large.
const UPLOAD_BYTE_BUDGET = 64 * 1024 * 1024;
// Files above this are sent as 8 MB multipart chunks so a dropped connection
// only retries the failed chunk instead of restarting the whole file.
const MULTIPART_THRESHOLD_BYTES = 8 * 1024 * 1024;

export type CreatePasteInput = {
  content: string;
  /** Already trimmed; empty for no password. */
  password: string;
  burnAfterRead: boolean;
  expiresIn: string;
  files: File[];
  /** Aborts the file uploads (the Cancel button). */
  signal: AbortSignal;
  /** Overall upload progress, 0–100, called only when the whole percent changes. */
  onProgress: (pct: number) => void;
  /** Called once the files are uploaded and the paste itself is being saved. */
  onSaving: () => void;
};

export type CreatedPaste = { code: string; url: string; deleteUrl: string };

/**
 * Encrypts and uploads the files, then creates the paste. Returns the server's
 * error message when it rejects the paste; throws on network failures and
 * cancellation (see describeCreateError).
 */
export async function createPaste(
  input: CreatePasteInput,
): Promise<{ ok: true; paste: CreatedPaste } | { ok: false; error: string }> {
  const { content, password, burnAfterRead, expiresIn, files, signal } = input;

  let key: Uint8Array<ArrayBuffer>;
  let keyForBody: string | undefined;
  let saltForBody: string | undefined;
  if (password) {
    const derived = await deriveKeyFromPassword(password);
    key = derived.key;
    keyForBody = bytesToBase64(key);
    saltForBody = bytesToBase64(derived.salt);
  } else {
    key = await generateContentKey();
    if (files.length > 0) keyForBody = bytesToBase64(key);
  }

  // Overall progress weights each file's percentage by its size. Updates
  // are throttled to whole-percent changes to avoid a render per chunk.
  const filePct = files.map(() => 0);
  const uploadTotal = Math.max(
    files.reduce((sum, f) => sum + f.size, 0),
    1,
  );
  let lastPct = 0;
  const report = (index: number, pct: number) => {
    // A retried chunk can briefly report lower progress; never go back.
    filePct[index] = Math.max(filePct[index], pct);
    const overall = Math.floor(
      filePct.reduce((sum, p, i) => sum + p * files[i].size, 0) / uploadTotal,
    );
    if (overall !== lastPct) {
      lastPct = overall;
      input.onProgress(overall);
    }
  };

  // The upload SDK is only needed for attachments, so text-only pastes
  // (most of them) never download it.
  const upload =
    files.length > 0 ? (await import("@vercel/blob/client")).upload : null;

  // Encrypt each file immediately before its upload so encryption
  // overlaps with in-flight uploads. Files start while the raw bytes in
  // flight stay under the budget (each holds ~3x its size while prepared),
  // so several small files go in parallel but large ones go one at a time
  // instead of exhausting a phone's memory.
  const fileMeta = await mapWithByteBudget(
    files,
    UPLOAD_BYTE_BUDGET,
    (f) => f.size,
    async (f, i) => {
      if (signal.aborted) {
        throw new DOMException("Upload cancelled", "AbortError");
      }
      // Wrapped so the ciphertext array goes out of scope once it's copied
      // into the Blob, rather than staying alive for the whole upload.
      const { body, meta } = await (async () => {
        const { bytes, meta } = await prepareFileForUpload(key, f);
        return { body: new Blob([bytes]), meta };
      })();
      if (!upload) throw new Error("Upload SDK not loaded");
      const blob = await upload(`files/${crypto.randomUUID()}`, body, {
        access: "private",
        contentType: "application/octet-stream",
        handleUploadUrl: "/api/pastes/upload-token",
        // Counted against the daily upload quota and enforced by Blob.
        clientPayload: JSON.stringify({ size: body.size }),
        multipart: body.size > MULTIPART_THRESHOLD_BYTES,
        abortSignal: signal,
        onUploadProgress: ({ percentage }) => report(i, percentage),
      });
      report(i, 100);
      return {
        pathname: blob.pathname,
        filename: meta.name,
        mime: meta.mime,
        size: meta.size,
        iv: meta.ivB64,
        authTag: meta.authTagB64,
        compression: meta.compression,
      };
    },
  );

  input.onSaving();

  const res = await fetch("/api/pastes", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      content: content.trim() ? content : "",
      burnAfterRead,
      expiresIn,
      contentKey: keyForBody,
      salt: saltForBody,
      files: fileMeta,
    }),
  });
  const data = await res.json();
  if (!res.ok) return { ok: false, error: data.error ?? "Failed to create paste" };

  saveDeleteToken(data.code, data.deleteUrl.split("#delete=")[1], data.expiresAt);
  return {
    ok: true,
    paste: { code: data.code, url: data.url, deleteUrl: data.deleteUrl },
  };
}

/** User-facing message for an error thrown by createPaste. */
export function describeCreateError(error: unknown, aborted: boolean): string {
  if (aborted) return "Upload cancelled. Nothing was saved.";
  // The Blob SDK hides the token route's error (rate limit, daily quota)
  // behind this message, so explain the likely cause instead.
  const refused =
    error instanceof Error && error.message.includes("retrieve the client token");
  return refused
    ? "Upload refused: you've hit the upload limit. Try again later or attach fewer files."
    : "Network error";
}
