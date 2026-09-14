  "use client";

import { useState } from "react";
import { upload } from "@vercel/blob/client";
import { X } from "lucide-react";
import CopyButton from "./copy-button";
import PasswordInput from "./password-input";
import {
  bytesToBase64,
  generateContentKey,
  deriveKeyFromPassword,
  prepareFileForUpload,
} from "@/lib/client-crypto";
import { MAX_FILE_BYTES, MAX_FILES_PER_PASTE, MAX_PASTE_TOTAL_BYTES } from "@/lib/validation";

const EXPIRY_OPTIONS = [
  { value: "5min", label: "5 minutes" },
  { value: "10min", label: "10 minutes" },
  { value: "30min", label: "30 minutes" },
  { value: "1h", label: "1 hour" },
  { value: "3h", label: "3 hours" },
  { value: "6h", label: "6 hours" },
  { value: "12h", label: "12 hours" },
  { value: "1d", label: "1 day" },
  { value: "3d", label: "3 days" },
] as const;

type CreateResponse = { code: string; url: string };

function formatBytes(n: number): string {
  if (n >= 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MB`;
  if (n >= 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${n} B`;
}

/**
 * Runs `fn` over `items` with at most `limit` concurrent promises. Results are
 * collected in input order.
 */
async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i], i);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

const UPLOAD_CONCURRENCY = 3;

export default function PasteEditor() {
  const [content, setContent] = useState("");
  const [password, setPassword] = useState("");
  const [burnAfterRead, setBurnAfterRead] = useState(false);
  const [expiresIn, setExpiresIn] = useState<string>("1h");
  const [files, setFiles] = useState<File[]>([]);
  const [result, setResult] = useState<CreateResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const totalBytes = files.reduce((sum, f) => sum + f.size, 0);

  function onSelectFiles(e: React.ChangeEvent<HTMLInputElement>) {
    const list = e.target.files;
    if (!list) return;
    const next = Array.from(list);
    // Reset the native input immediately so its "N files" label doesn't keep
    // a stale count after files are removed from the list below.
    e.target.value = "";
    for (const f of next) {
      if (f.size > MAX_FILE_BYTES) {
        setError(`"${f.name}" exceeds the 50 MB per-file limit`);
        return;
      }
    }
    if (next.length + files.length > MAX_FILES_PER_PASTE) {
      setError(`At most ${MAX_FILES_PER_PASTE} files per paste`);
      return;
    }
    setError(null);
    setFiles((prev) => [...prev, ...next]);
  }

  function removeFile(index: number) {
    setFiles((prev) => prev.filter((_, i) => i !== index));
  }

  async function handleSubmit(e: React.SubmitEvent<HTMLFormElement>) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      if (burnAfterRead && files.length > 0) {
        setError("Burn-after-read pastes cannot have file attachments");
        setLoading(false);
        return;
      }
      if (totalBytes > MAX_PASTE_TOTAL_BYTES) {
        setError("Total file size exceeds the 100 MB per-paste limit");
        setLoading(false);
        return;
      }

      const trimmedPassword = password.trim();
      let key: Uint8Array<ArrayBuffer>;
      let keyForBody: string | undefined;
      let saltForBody: string | undefined;
      if (trimmedPassword) {
        const derived = await deriveKeyFromPassword(trimmedPassword);
        key = derived.key;
        saltForBody = bytesToBase64(derived.salt);
      } else {
        key = await generateContentKey();
        keyForBody = bytesToBase64(key);
      }

      const prepared = await Promise.all(
        files.map((f) => prepareFileForUpload(key, f))
      );

      const fileMeta = await mapWithConcurrency(
        prepared,
        UPLOAD_CONCURRENCY,
        async ({ bytes, meta }) => {
          const blob = await upload(
            `files/${crypto.randomUUID()}`,
            new Blob([bytes]),
            {
              access: "private",
              contentType: "application/octet-stream",
              handleUploadUrl: "/api/pastes/upload-token",
            }
          );
          return {
            pathname: blob.pathname,
            filename: meta.name,
            mime: meta.mime,
            size: meta.size,
            iv: meta.ivB64,
            authTag: meta.authTagB64,
            compression: meta.compression,
          };
        }
      );

      const res = await fetch("/api/pastes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          content,
          password: trimmedPassword || undefined,
          burnAfterRead,
          expiresIn,
          contentKey: keyForBody,
          salt: saltForBody,
          files: fileMeta,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Failed to create paste");
        setLoading(false);
        return;
      }
      setResult(data);
      setContent("");
      setPassword("");
      setBurnAfterRead(false);
      setExpiresIn("1h");
      setFiles([]);
    } catch {
      setError("Network error");
    }
    setLoading(false);
  }

  if (result) {
    return (
      <div className="mx-auto flex w-full max-w-md flex-col gap-6 rounded-xl border border-zinc-200 bg-white p-4 shadow-sm sm:p-8 dark:border-zinc-800 dark:bg-zinc-900">
        <h2 className="text-lg font-semibold">Your paste is ready!</h2>
        <div className="flex flex-col items-stretch gap-2 rounded-md border border-zinc-300 bg-zinc-50 p-3 sm:flex-row sm:items-center dark:border-zinc-700 dark:bg-zinc-800">
          <span className="min-w-0 flex-1 break-all font-mono text-sm sm:truncate">
            {result.url}
          </span>
          <div className="shrink-0">
            <CopyButton text={result.url} />
          </div>
        </div>
        <p className="text-sm text-zinc-500 dark:text-zinc-400">
          Share this link. Once someone opens it, they can read the content.
        </p>
        <button
          type="button"
          onClick={() => setResult(null)}
          className="rounded-md border border-zinc-300 px-4 py-2 text-sm font-medium transition hover:bg-zinc-50 dark:border-zinc-700 dark:hover:bg-zinc-800"
        >
          Create another paste
        </button>
      </div>
    );
  }

  return (
    <form
      onSubmit={handleSubmit}
      autoComplete="off"
      className="flex w-full max-w-3xl flex-col gap-3"
    >
      <textarea
        value={content}
        onChange={(e) => setContent(e.target.value)}
        placeholder="Paste or type your text here..."
        className="min-h-40 w-full resize-y rounded-xl border border-zinc-300 bg-white p-4 font-mono text-sm leading-relaxed focus:outline-none focus:ring-2 focus:ring-blue-500 sm:min-h-52 dark:border-zinc-700 dark:bg-zinc-900"
        required
      />

      <div className="flex flex-col gap-1.5 rounded-xl border border-dashed border-zinc-300 p-3 dark:border-zinc-700">
        <label className="flex cursor-pointer items-center justify-between gap-3 text-sm">
          <span className="font-medium">Attachments (optional)</span>
          <span className="inline-flex items-center gap-2 rounded-md border border-zinc-300 px-3 py-1.5 text-xs font-medium transition hover:bg-zinc-50 dark:border-zinc-700 dark:hover:bg-zinc-800">
            {files.length > 0
              ? `${files.length} file${files.length > 1 ? "s" : ""} selected`
              : "Choose files"}
          </span>
          <input
            type="file"
            multiple
            disabled={loading}
            onChange={(e) => onSelectFiles(e)}
            className="sr-only"
          />
        </label>
        {files.length > 0 && (
          <>
            <ul className="mt-1 flex flex-col gap-1">
            {files.map((f, i) => (
              <li
                key={`${f.name}-${i}`}
                className="flex items-center gap-2 rounded-md bg-zinc-50 px-2 py-1.5 text-xs dark:bg-zinc-800/60"
              >
                <span className="min-w-0 flex-1 truncate font-mono">{f.name}</span>
                <span className="w-16 shrink-0 text-right tabular-nums text-zinc-500 dark:text-zinc-400">
                  {formatBytes(f.size)}
                </span>
                <button
                  type="button"
                  onClick={() => removeFile(i)}
                  className="flex h-6 w-6 shrink-0 items-center justify-center rounded text-zinc-400 transition hover:text-red-500"
                  aria-label={`Remove ${f.name}`}
                >
                  <X size={14} />
                </button>
              </li>
            ))}
            <li className="flex items-center gap-2 px-2 py-1 text-xs text-zinc-500 dark:text-zinc-400">
              <span className="min-w-0 flex-1">
                {files.length} file{files.length > 1 ? "s" : ""}
              </span>
              <span className="w-16 shrink-0 text-right tabular-nums">
                {formatBytes(totalBytes)} total
              </span>
              <span className="w-6 shrink-0" aria-hidden="true" />
            </li>
          </ul>
          <p className="text-xs text-zinc-500 dark:text-zinc-400">
            Max 50 MB/file, 100 MB per paste
          </p>
          </>
        )}
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <label className="flex flex-col gap-1">
          <span className="text-sm font-medium">Expiration</span>
          <select
            value={expiresIn}
            onChange={(e) => setExpiresIn(e.target.value)}
            className="rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 dark:border-zinc-700 dark:bg-zinc-900"
          >
            {EXPIRY_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </label>

        <label className="flex flex-col gap-1">
          <span className="text-sm font-medium">Password (optional)</span>
          <PasswordInput
            value={password}
            onChange={setPassword}
            placeholder="Protect with a password"
          />
        </label>

        <label className="mt-auto flex items-center gap-2 pb-2">
          <input
            type="checkbox"
            checked={burnAfterRead}
            disabled={files.length > 0}
            onChange={(e) => setBurnAfterRead(e.target.checked)}
            className="h-4 w-4 accent-blue-600"
          />
          <span className="text-sm font-medium">Burn after reading</span>
        </label>
      </div>

      {burnAfterRead && files.length > 0 && (
        <p className="text-xs text-amber-600 dark:text-amber-400">
          Remove attachments to enable burn-after-read.
        </p>
      )}

      {error && <p className="text-sm text-red-600">{error}</p>}

      <button
        type="submit"
        disabled={loading || !content.trim()}
        className="rounded-lg bg-blue-600 px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-blue-700 disabled:opacity-50 sm:w-auto w-full"
      >
        {loading ? "Creating..." : "Create paste"}
      </button>
    </form>
  );
}
