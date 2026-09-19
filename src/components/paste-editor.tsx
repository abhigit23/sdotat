"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { upload } from "@vercel/blob/client";
import { X } from "lucide-react";
import CopyButton from "./copy-button";
import PasswordInput from "./password-input";
import Spinner from "./spinner";
import {
  bytesToBase64,
  generateContentKey,
  deriveKeyFromPassword,
  prepareFileForUpload,
} from "@/lib/client-crypto";
import {
  MAX_FILE_BYTES,
  MAX_FILES_PER_PASTE,
  MAX_PASTE_TOTAL_BYTES,
} from "@/lib/validation";

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
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i], i);
    }
  };
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, worker),
  );
  return results;
}

const UPLOAD_CONCURRENCY = 3;

type SubmitPhase = "idle" | "encrypting" | "uploading" | "saving";

const SUBMIT_LABELS: Record<SubmitPhase, string> = {
  idle: "Create paste",
  encrypting: "Encrypting…",
  uploading: "Uploading files…",
  saving: "Creating paste…",
};

export default function PasteEditor() {
  const [content, setContent] = useState("");
  const [password, setPassword] = useState("");
  const [burnAfterRead, setBurnAfterRead] = useState(false);
  const [expiresIn, setExpiresIn] = useState<string>("1h");
  const [files, setFiles] = useState<File[]>([]);
  const [result, setResult] = useState<CreateResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [submitPhase, setSubmitPhase] = useState<SubmitPhase>("idle");
  const [isDraggingFiles, setIsDraggingFiles] = useState(false);

  // Refs mirror state so the document-level drag/drop and paste listeners can
  // be attached once and still read the latest values.
  const filesRef = useRef<File[]>(files);
  const loadingRef = useRef(loading);
  filesRef.current = files;
  loadingRef.current = loading;

  const totalBytes = files.reduce((sum, f) => sum + f.size, 0);

  const addFiles = useCallback((incoming: File[]) => {
    if (loadingRef.current || incoming.length === 0) return;
    for (const f of incoming) {
      if (f.size > MAX_FILE_BYTES) {
        setError(`"${f.name}" exceeds the 50 MB per-file limit`);
        return;
      }
    }
    if (incoming.length + filesRef.current.length > MAX_FILES_PER_PASTE) {
      setError(`At most ${MAX_FILES_PER_PASTE} files per paste`);
      return;
    }
    setError(null);
    setFiles((prev) => [...prev, ...incoming]);
  }, []);

  function onSelectFiles(e: React.ChangeEvent<HTMLInputElement>) {
    const list = e.target.files;
    if (!list) return;
    const next = Array.from(list);
    // Reset the native input immediately so its "N files" label doesn't keep
    // a stale count after files are removed from the list below.
    e.target.value = "";
    addFiles(next);
  }

  function removeFile(index: number) {
    setFiles((prev) => prev.filter((_, i) => i !== index));
  }

  useEffect(() => {
    function isFileDrag(
      dataTransfer: DataTransfer | null | undefined,
    ): boolean {
      return !!dataTransfer && Array.from(dataTransfer.types).includes("Files");
    }

    // Depth counter avoids flicker as the pointer moves between nested nodes.
    let dragDepth = 0;

    function onDragEnter(e: DragEvent) {
      if (!isFileDrag(e.dataTransfer)) return;
      dragDepth += 1;
      setIsDraggingFiles(true);
    }

    function onDragOver(e: DragEvent) {
      // Swallows the browser's default of navigating to a dropped file even
      // when it lands outside the form.
      if (isFileDrag(e.dataTransfer)) e.preventDefault();
    }

    function onDragLeave(e: DragEvent) {
      if (!isFileDrag(e.dataTransfer)) return;
      dragDepth = Math.max(0, dragDepth - 1);
      if (dragDepth === 0) setIsDraggingFiles(false);
    }

    function onDrop(e: DragEvent) {
      dragDepth = 0;
      setIsDraggingFiles(false);
      if (!e.dataTransfer || e.dataTransfer.files.length === 0) return;
      e.preventDefault();
      addFiles(Array.from(e.dataTransfer.files));
    }

    function onPaste(e: ClipboardEvent) {
      const items = e.clipboardData?.items;
      if (!items || items.length === 0) return;
      const pasted: File[] = [];
      for (const item of items) {
        if (item.kind === "file") {
          const f = item.getAsFile();
          if (f) pasted.push(f);
        }
      }
      if (pasted.length === 0) return;
      e.preventDefault();
      addFiles(pasted);
    }

    document.addEventListener("dragenter", onDragEnter);
    document.addEventListener("dragover", onDragOver);
    document.addEventListener("dragleave", onDragLeave);
    document.addEventListener("drop", onDrop);
    document.addEventListener("paste", onPaste);
    return () => {
      document.removeEventListener("dragenter", onDragEnter);
      document.removeEventListener("dragover", onDragOver);
      document.removeEventListener("dragleave", onDragLeave);
      document.removeEventListener("drop", onDrop);
      document.removeEventListener("paste", onPaste);
    };
  }, [addFiles]);

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

      if (files.length > 0) setSubmitPhase("encrypting");

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
        files.map((f) => prepareFileForUpload(key, f)),
      );

      if (files.length > 0) setSubmitPhase("uploading");

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
            },
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
        },
      );

      setSubmitPhase("saving");

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
        setSubmitPhase("idle");
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
    setSubmitPhase("idle");
    setLoading(false);
  }

  if (result) {
    return (
      <div className="mx-auto flex w-full max-w-md flex-col gap-6 rounded-xl border border-zinc-200 bg-white p-4 shadow-sm sm:p-8 dark:border-zinc-800 dark:bg-zinc-900">
        <h2 className="text-center text-lg font-semibold">Your paste is ready!</h2>
        <div className="flex flex-col items-stretch gap-2 rounded-md border border-zinc-300 bg-zinc-50 p-3 sm:flex-row sm:items-center dark:border-zinc-700 dark:bg-zinc-800">
          <span className="min-w-0 flex-1 break-all font-mono text-sm sm:truncate">
            {result.url}
          </span>
          <div className="shrink-0">
            <CopyButton text={result.url} />
          </div>
        </div>
        <p className="text-center text-sm text-zinc-500 dark:text-zinc-400">
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
    <>
      {isDraggingFiles && (
        <div className="pointer-events-none fixed inset-0 z-50 flex items-center justify-center bg-blue-500/10">
          <div className="mx-4 flex max-w-md flex-col items-center gap-2 rounded-xl border-2 border-dashed border-blue-500 bg-white/90 p-10 text-center shadow-lg dark:border-blue-400 dark:bg-zinc-900/90">
            <span className="text-lg font-semibold">
              Drop files to attach them
            </span>
            <span className="text-sm text-zinc-600 dark:text-zinc-400">
              They will be encrypted and uploaded with your paste.
            </span>
          </div>
        </div>
      )}
      <form
        onSubmit={handleSubmit}
        autoComplete="off"
        className="flex w-full max-w-3xl flex-col gap-3"
      >
        <fieldset disabled={loading} className="contents">
        <textarea
          id="paste-content"
          name="content"
          value={content}
          onChange={(e) => setContent(e.target.value)}
          placeholder="Paste or type your text here..."
          className="min-h-40 w-full resize-y rounded-xl border border-zinc-300 bg-white p-4 font-mono text-sm leading-relaxed focus:outline-none focus:ring-2 focus:ring-blue-500 sm:min-h-52 dark:border-zinc-700 dark:bg-zinc-900"
          required
        />

        <p className="text-xs text-zinc-500 dark:text-zinc-400 text-center hidden md:block">
          Tip: you can also drag files anywhere on this page, or paste them from
          your clipboard (Ctrl/Cmd+V).
        </p>

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
              id="paste-files"
              name="files"
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
                    <span className="min-w-0 flex-1 truncate font-mono">
                      {f.name}
                    </span>
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
              id="paste-expiration"
              name="expiresIn"
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
              id="burn-after-read"
              name="burnAfterRead"
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
          className="flex w-full items-center justify-center gap-2 rounded-lg bg-blue-600 px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-blue-700 disabled:opacity-50 sm:w-auto"
        >
          {loading && <Spinner />}
          {SUBMIT_LABELS[submitPhase]}
        </button>
        </fieldset>
      </form>
    </>
  );
}
