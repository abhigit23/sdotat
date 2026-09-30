"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { upload } from "@vercel/blob/client";
import { Clock, Dices, Flame, Lock, Plus, X } from "lucide-react";
import CopyButton from "./copy-button";
import FileIcon from "./file-icon";
import ShareButton from "./share-button";
import PasswordInput from "./password-input";
import Spinner from "./spinner";
import {
  bytesToBase64,
  generateContentKey,
  deriveKeyFromPassword,
  prepareFileForUpload,
} from "@/lib/client-crypto";
import {
  MAX_CONTENT_BYTES,
  MAX_FILE_BYTES,
  MAX_FILES_PER_PASTE,
  MAX_PASTE_TOTAL_BYTES,
} from "@/lib/validation";
import { formatBytes, formatFileCount } from "@/lib/format";
import { mapWithConcurrency } from "@/lib/map-concurrency";
import { generatePassphrase } from "@/lib/passphrase";

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

type CreateResult = {
  code: string;
  url: string;
  expiresLabel: string;
  burn: boolean;
  passwordProtected: boolean;
};

const UPLOAD_CONCURRENCY = 3;
// The password-derived key is all that protects a password paste.
const MIN_PASSWORD_LENGTH = 8;
// Below this many characters the text cannot approach the byte limit (at most
// 3 UTF-8 bytes per character), so the counter and exact byte count are skipped.
const COUNTER_MIN_CHARS = 100_000;

type SubmitPhase = "idle" | "processing" | "saving";

const SUBMIT_LABELS: Record<SubmitPhase, string> = {
  idle: "Create paste",
  processing: "Encrypting & uploading…",
  saving: "Creating paste…",
};

const CHIP_CLASS =
  "inline-flex items-center gap-1 rounded-full border border-zinc-200 bg-zinc-50 px-2.5 py-1 text-zinc-600 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-300";

export default function PasteEditor() {
  const [content, setContent] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [burnAfterRead, setBurnAfterRead] = useState(false);
  const [expiresIn, setExpiresIn] = useState<string>("1h");
  const [files, setFiles] = useState<File[]>([]);
  const [result, setResult] = useState<CreateResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [submitPhase, setSubmitPhase] = useState<SubmitPhase>("idle");
  const [uploadPct, setUploadPct] = useState(0);
  const [isDraggingFiles, setIsDraggingFiles] = useState(false);

  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  // Refs mirror state so the document-level drag/drop and paste listeners can
  // be attached once and still read the latest values.
  const filesRef = useRef<File[]>(files);
  const loadingRef = useRef(loading);
  filesRef.current = files;
  loadingRef.current = loading;

  const totalBytes = files.reduce((sum, f) => sum + f.size, 0);

  const contentBytes = useMemo(
    () =>
      content.length > COUNTER_MIN_CHARS
        ? new TextEncoder().encode(content).length
        : content.length,
    [content],
  );
  const showCounter = content.length > COUNTER_MIN_CHARS;
  const overLimit = contentBytes > MAX_CONTENT_BYTES;
  const nearLimit = contentBytes > MAX_CONTENT_BYTES * 0.9;

  const trimmedPassword = password.trim();
  const passwordTooShort =
    trimmedPassword.length > 0 && trimmedPassword.length < MIN_PASSWORD_LENGTH;

  const hasInput = content.trim().length > 0 || files.length > 0;
  const canSubmit = !loading && hasInput && !overLimit && !passwordTooShort;

  // On devices with a precise pointer, start in the text box. Skipped on touch
  // devices so the on-screen keyboard doesn't cover the page on load.
  useEffect(() => {
    if (window.matchMedia("(pointer: fine)").matches) {
      textareaRef.current?.focus();
    }
  }, []);

  // Warn before a refresh or tab close throws away what the user has entered.
  const hasUnsaved =
    !result && (content.trim().length > 0 || files.length > 0 || !!password);
  useEffect(() => {
    if (!hasUnsaved) return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [hasUnsaved]);

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

  function generatePassword() {
    setPassword(generatePassphrase());
    // Show it so the user can copy it before it is masked.
    setShowPassword(true);
  }

  function cancelUpload() {
    abortRef.current?.abort();
  }

  function onFormKeyDown(e: React.KeyboardEvent<HTMLFormElement>) {
    if (e.key === "Enter" && (e.ctrlKey || e.metaKey) && canSubmit) {
      e.preventDefault();
      e.currentTarget.requestSubmit();
    }
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

      if (trimmedPassword && trimmedPassword.length < MIN_PASSWORD_LENGTH) {
        setError(
          `Password must be at least ${MIN_PASSWORD_LENGTH} characters`
        );
        setLoading(false);
        return;
      }

      if (files.length > 0) setSubmitPhase("processing");
      setUploadPct(0);

      let key: Uint8Array<ArrayBuffer>;
      let keyForBody: string | undefined;
      let saltForBody: string | undefined;
      if (trimmedPassword) {
        const derived = await deriveKeyFromPassword(trimmedPassword);
        key = derived.key;
        keyForBody = bytesToBase64(key);
        saltForBody = bytesToBase64(derived.salt);
      } else {
        key = await generateContentKey();
        if (files.length > 0) keyForBody = bytesToBase64(key);
      }

      const controller = new AbortController();
      abortRef.current = controller;
      // Overall progress weights each file's percentage by its size. Updates
      // are throttled to whole-percent changes to avoid a render per chunk.
      const filePct = files.map(() => 0);
      const uploadTotal = Math.max(totalBytes, 1);
      let lastPct = 0;
      const report = (index: number, pct: number) => {
        filePct[index] = pct;
        const overall = Math.floor(
          filePct.reduce((sum, p, i) => sum + p * files[i].size, 0) /
            uploadTotal,
        );
        if (overall !== lastPct) {
          lastPct = overall;
          setUploadPct(overall);
        }
      };

      // Encrypt each file immediately before its upload so at most
      // UPLOAD_CONCURRENCY ciphertexts are held in memory at once and
      // encryption overlaps with in-flight uploads.
      const fileMeta = await mapWithConcurrency(
        files,
        UPLOAD_CONCURRENCY,
        async (f, i) => {
          if (controller.signal.aborted) {
            throw new DOMException("Upload cancelled", "AbortError");
          }
          const { bytes, meta } = await prepareFileForUpload(key, f);
          const blob = await upload(
            `files/${crypto.randomUUID()}`,
            new Blob([bytes]),
            {
              access: "private",
              contentType: "application/octet-stream",
              handleUploadUrl: "/api/pastes/upload-token",
              abortSignal: controller.signal,
              onUploadProgress: ({ percentage }) => report(i, percentage),
            },
          );
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

      setSubmitPhase("saving");

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
      if (!res.ok) {
        setError(data.error ?? "Failed to create paste");
        setSubmitPhase("idle");
        setLoading(false);
        return;
      }
      setResult({
        code: data.code,
        url: data.url,
        expiresLabel:
          EXPIRY_OPTIONS.find((o) => o.value === expiresIn)?.label ?? expiresIn,
        burn: burnAfterRead,
        passwordProtected: !!trimmedPassword,
      });
      setContent("");
      setPassword("");
      setShowPassword(false);
      setBurnAfterRead(false);
      setExpiresIn("1h");
      setFiles([]);
    } catch {
      setError(
        abortRef.current?.signal.aborted
          ? "Upload cancelled. Nothing was saved."
          : "Network error",
      );
    }
    abortRef.current = null;
    setSubmitPhase("idle");
    setLoading(false);
  }

  if (result) {
    return (
      <div className="mx-auto my-auto flex w-full max-w-md flex-col gap-4 rounded-xl border border-zinc-200 bg-white p-4 shadow-sm sm:gap-5 sm:p-6 short:gap-3 short:p-3 tiny:max-w-2xl tiny:gap-2 tiny:p-2 dark:border-zinc-800 dark:bg-zinc-900">
        <h2 className="text-center text-lg font-semibold short:text-base tiny:sr-only">Your paste is ready!</h2>
        <div className="flex flex-col gap-4 short:gap-3 tiny:grid tiny:grid-cols-2 tiny:items-start tiny:gap-3">
        <div className="flex flex-col gap-2 rounded-md border border-zinc-300 bg-zinc-50 p-3 short:p-2 dark:border-zinc-700 dark:bg-zinc-800">
          <span className="truncate text-center font-mono text-sm" title={result.url}>
            {result.url}
          </span>
          <div className="flex shrink-0 items-center justify-center gap-2">
            <ShareButton url={result.url} title="New paste on sdotat" />
            <CopyButton text={result.url} />
          </div>
        </div>
        <div className="flex flex-col gap-4 short:gap-3 tiny:gap-2">
        <ul className="flex flex-wrap items-center justify-center gap-2 text-xs short:gap-1.5">
          <li className={CHIP_CLASS}>
            <Clock size={12} aria-hidden />
            Expires in {result.expiresLabel}
          </li>
          {result.burn && (
            <li className={CHIP_CLASS}>
              <Flame size={12} aria-hidden />
              Burns after reading
            </li>
          )}
          {result.passwordProtected && (
            <li className={CHIP_CLASS}>
              <Lock size={12} aria-hidden />
              Password protected
            </li>
          )}
        </ul>
        <div className="flex flex-col gap-1 text-center text-sm text-zinc-500 short:text-xs dark:text-zinc-400">
          {result.passwordProtected ? (
            <p>
              The password is <strong>not</strong> part of the link. Send it
              separately, ideally over a different channel.
            </p>
          ) : (
            <p>Anyone with this link can read the paste.</p>
          )}
          {result.burn && (
            <p>The first person to open it will delete it for everyone.</p>
          )}
        </div>
        </div>
        </div>
        <button
          type="button"
          onClick={() => setResult(null)}
          className="rounded-md border border-zinc-300 px-4 py-2 text-sm font-medium short:py-1.5 transition hover:bg-zinc-50 dark:border-zinc-700 dark:hover:bg-zinc-800"
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
        onKeyDown={onFormKeyDown}
        autoComplete="off"
        className="flex w-full flex-1 flex-col gap-2 short:gap-1.5"
      >
        <fieldset disabled={loading} className="contents">
        <textarea
          ref={textareaRef}
          id="paste-content"
          name="content"
          aria-label="Paste content"
          value={content}
          onChange={(e) => setContent(e.target.value)}
          placeholder="Paste or type your text here..."
          aria-invalid={overLimit || undefined}
          className="min-h-20 tiny:min-h-12 w-full flex-1 resize-none rounded-xl border border-zinc-300 bg-white p-4 font-mono text-sm leading-relaxed focus:outline-none focus:ring-2 focus:ring-blue-500 short:p-3 dark:border-zinc-700 dark:bg-zinc-900"
        />
        {showCounter && (
          <p
            className={`shrink-0 text-right text-xs tabular-nums ${
              overLimit
                ? "font-medium text-red-600"
                : nearLimit
                  ? "text-amber-600 dark:text-amber-400"
                  : "text-zinc-500 dark:text-zinc-400"
            }`}
          >
            {formatBytes(contentBytes)} / {formatBytes(MAX_CONTENT_BYTES)}
            {overLimit && " — too long. Shorten the text or attach it as a file."}
          </p>
        )}

        <p className="hidden shrink-0 text-center text-xs text-zinc-500 md:block short:hidden dark:text-zinc-400">
          Tip: you can also drag files anywhere on this page, or paste them from
          your clipboard (Ctrl/Cmd+V). Press Ctrl/Cmd+Enter to create.
        </p>

        <div
          className={`flex shrink-0 flex-col gap-1.5 rounded-xl border border-dashed p-3 transition-colors short:gap-1 short:p-2 tiny:p-1.5 ${
            isDraggingFiles
              ? "border-blue-500 bg-blue-50 dark:border-blue-400 dark:bg-blue-950/30"
              : "border-zinc-300 dark:border-zinc-700"
          }`}
        >
          <label className="flex cursor-pointer items-center justify-between gap-3 text-sm">
            <span className="font-medium">Attachments (optional)</span>
            <span className="flex flex-wrap items-center justify-end gap-2">
              {files.length > 0 && (
                <span className="text-xs text-zinc-500 short:hidden tiny:inline dark:text-zinc-400">
                  {formatFileCount(files.length)} selected
                </span>
              )}
              <span className="inline-flex items-center gap-1 rounded-md border border-zinc-300 px-3 py-1.5 text-xs font-medium transition hover:bg-zinc-50 dark:border-zinc-700 dark:hover:bg-zinc-800">
                {files.length > 0 ? (
                  <>
                    <Plus size={14} aria-hidden />
                    Add more files
                  </>
                ) : (
                  "Choose files"
                )}
              </span>
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
              {/* Long lists scroll here instead of growing the page. */}
              <ul className="flex max-h-28 flex-col gap-1 overflow-y-auto short:max-h-16 tiny:max-h-9">
                {files.map((f, i) => (
                  <li
                    key={`${f.name}-${i}`}
                    className="flex shrink-0 items-center gap-2 rounded-md bg-zinc-50 px-2 py-1 text-xs dark:bg-zinc-800/60"
                  >
                    <FileIcon
                      name={f.name}
                      mime={f.type}
                      className="shrink-0 text-zinc-500 dark:text-zinc-400"
                    />
                    <span className="min-w-0 flex-1 truncate font-mono">
                      {f.name}
                    </span>
                    <span className="w-16 shrink-0 text-right tabular-nums text-zinc-500 dark:text-zinc-400">
                      {formatBytes(f.size)}
                    </span>
                    <button
                      type="button"
                      onClick={() => removeFile(i)}
                      className="flex h-6 w-6 shrink-0 items-center justify-center rounded text-zinc-500 transition hover:text-red-500 dark:text-zinc-400"
                      aria-label={`Remove ${f.name}`}
                    >
                      <X size={14} />
                    </button>
                  </li>
                ))}
              </ul>
              <div className="flex items-center gap-2 px-2 text-xs text-zinc-500 tiny:hidden dark:text-zinc-400">
                <span className="min-w-0 flex-1">
                  {formatFileCount(files.length)}
                  <span className="short:hidden">
                    {" "}
                    · max 50 MB/file, 100 MB per paste
                  </span>
                </span>
                <span className="shrink-0 whitespace-nowrap text-right tabular-nums">
                  {formatBytes(totalBytes)} total
                </span>
              </div>
            </>
          )}
        </div>

        <div className="grid shrink-0 grid-cols-1 gap-2 short:max-sm:grid-cols-2 sm:grid-cols-2 md:grid-cols-3 tiny:grid-cols-3">
          <label className="flex flex-col gap-1">
            <span className="text-sm font-medium tiny:sr-only">Expiration</span>
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
            <span className="text-xs text-zinc-500 short:hidden dark:text-zinc-400">
              The paste is deleted automatically after this.
            </span>
          </label>

          <div className="flex flex-col gap-1">
            <div className="flex items-center justify-between gap-2 tiny:justify-end">
              <span className="text-sm font-medium tiny:sr-only">Password</span>
              <button
                type="button"
                onClick={generatePassword}
                className="inline-flex items-center gap-1 text-xs font-medium text-blue-600 hover:underline dark:text-blue-400"
              >
                <Dices size={12} aria-hidden />
                Generate
              </button>
            </div>
            <PasswordInput
              value={password}
              onChange={setPassword}
              placeholder="Protect with a password"
              show={showPassword}
              onShowChange={setShowPassword}
              describedBy="password-hint"
              invalid={passwordTooShort}
            />
            <span
              id="password-hint"
              className={`text-xs ${
                passwordTooShort
                  ? "text-amber-600 dark:text-amber-400"
                  : "text-zinc-500 short:hidden dark:text-zinc-400"
              }`}
            >
              {passwordTooShort
                ? `Use at least ${MIN_PASSWORD_LENGTH} characters.`
                : "Optional. You share it separately from the link."}
            </span>
          </div>

          <label className="flex items-start gap-2 short:max-sm:col-span-2 sm:col-span-2 md:col-span-1 md:pt-6 tiny:col-span-1 tiny:pt-6">
            <input
              type="checkbox"
              id="burn-after-read"
              name="burnAfterRead"
              checked={burnAfterRead}
              disabled={files.length > 0}
              onChange={(e) => setBurnAfterRead(e.target.checked)}
              className="mt-0.5 h-4 w-4 shrink-0 accent-blue-600"
            />
            <span className="flex flex-col">
              <span className="text-sm font-medium">Burn after reading</span>
              <span className="text-xs text-zinc-500 short:hidden dark:text-zinc-400">
                Deleted for good the first time someone opens it. Can&apos;t
                be combined with attachments.
              </span>
              {files.length > 0 && (
                <span className="text-xs text-amber-600 short:hidden dark:text-amber-400">
                  Remove attachments to use this.
                </span>
              )}
            </span>
          </label>
        </div>

        {error && (
          <p role="alert" className="shrink-0 text-sm text-red-600">
            {error}
          </p>
        )}

        <button
          type="submit"
          disabled={!canSubmit}
          className="flex w-full shrink-0 items-center justify-center gap-2 rounded-lg bg-blue-600 px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-blue-700 disabled:opacity-50 sm:w-auto short:py-2 tiny:py-1.5"
        >
          {loading && <Spinner />}
          {SUBMIT_LABELS[submitPhase]}
        </button>
        </fieldset>

        {/* Outside the fieldset, which is disabled while loading. */}
        {loading && submitPhase === "processing" && (
          <div className="flex shrink-0 items-center gap-3">
            <div
              role="progressbar"
              aria-label="Upload progress"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={uploadPct}
              className="h-2 flex-1 overflow-hidden rounded-full bg-zinc-200 dark:bg-zinc-800"
            >
              <div
                className="h-full rounded-full bg-blue-600 transition-[width] duration-200 ease-out"
                style={{ width: `${uploadPct}%` }}
              />
            </div>
            <span className="w-10 text-right text-xs tabular-nums text-zinc-500 dark:text-zinc-400">
              {uploadPct}%
            </span>
            <button
              type="button"
              onClick={cancelUpload}
              className="text-xs font-medium text-red-600 hover:underline"
            >
              Cancel
            </button>
          </div>
        )}
      </form>
    </>
  );
}
