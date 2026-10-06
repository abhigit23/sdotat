"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Spinner from "./spinner";
import AttachmentsField, { DropOverlay } from "./attachments-field";
import PasteOptions from "./paste-options";
import PasteResult, { type PasteResultData } from "./paste-result";
import UploadProgress from "./upload-progress";
import { useFileDrop } from "@/hooks/use-file-drop";
import { createPaste, describeCreateError } from "@/lib/create-paste";
import { expiryLabel } from "@/lib/expiry";
import {
  MAX_CONTENT_BYTES,
  MAX_FILE_BYTES,
  MAX_FILES_PER_PASTE,
  MAX_PASTE_TOTAL_BYTES,
} from "@/lib/limits";
import { formatBytes } from "@/lib/format";
import { isWeakPassword } from "@/lib/passphrase";

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

export default function PasteEditor() {
  const [content, setContent] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [burnAfterRead, setBurnAfterRead] = useState(false);
  const [expiresIn, setExpiresIn] = useState<string>("1h");
  const [files, setFiles] = useState<File[]>([]);
  const [result, setResult] = useState<PasteResultData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [submitPhase, setSubmitPhase] = useState<SubmitPhase>("idle");
  const [uploadPct, setUploadPct] = useState(0);

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
  // A warning only: long enough to submit, but easy to guess.
  const passwordWeak =
    !passwordTooShort &&
    trimmedPassword.length > 0 &&
    isWeakPassword(trimmedPassword);

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

  const isDraggingFiles = useFileDrop(addFiles);

  function removeFile(index: number) {
    setFiles((prev) => prev.filter((_, i) => i !== index));
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

      const controller = new AbortController();
      abortRef.current = controller;
      const outcome = await createPaste({
        content,
        password: trimmedPassword,
        burnAfterRead,
        expiresIn,
        files,
        signal: controller.signal,
        onProgress: setUploadPct,
        onSaving: () => setSubmitPhase("saving"),
      });
      if (!outcome.ok) {
        setError(outcome.error);
        setSubmitPhase("idle");
        setLoading(false);
        return;
      }
      setResult({
        ...outcome.paste,
        expiresLabel: expiryLabel(expiresIn),
        burn: burnAfterRead,
        passwordProtected: !!trimmedPassword,
      });
      setContent("");
      setPassword("");
      setShowPassword(false);
      setBurnAfterRead(false);
      setExpiresIn("1h");
      setFiles([]);
    } catch (e) {
      setError(describeCreateError(e, !!abortRef.current?.signal.aborted));
    }
    abortRef.current = null;
    setSubmitPhase("idle");
    setLoading(false);
  }

  if (result) {
    return (
      <PasteResult result={result} onCreateAnother={() => setResult(null)} />
    );
  }

  return (
    <>
      {isDraggingFiles && <DropOverlay />}
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
          className="min-h-20 tiny:min-h-12 w-full flex-1 resize-none rounded-xl border border-zinc-300 bg-white p-4 font-mono text-sm leading-relaxed placeholder:text-zinc-500 focus:outline-none focus:ring-2 focus:ring-blue-500 short:p-3 dark:border-zinc-700 dark:bg-zinc-900 dark:placeholder:text-zinc-400"
        />
        {showCounter && (
          <p
            className={`shrink-0 text-right text-xs tabular-nums ${
              overLimit
                ? "font-medium text-red-600 dark:text-red-400"
                : nearLimit
                  ? "text-amber-700 dark:text-amber-400"
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

        <AttachmentsField
          files={files}
          totalBytes={totalBytes}
          isDragging={isDraggingFiles}
          disabled={loading}
          onAdd={addFiles}
          onRemove={removeFile}
        />

        <PasteOptions
          expiresIn={expiresIn}
          onExpiresInChange={setExpiresIn}
          password={password}
          onPasswordChange={setPassword}
          showPassword={showPassword}
          onShowPasswordChange={setShowPassword}
          passwordTooShort={passwordTooShort}
          passwordWeak={passwordWeak}
          minPasswordLength={MIN_PASSWORD_LENGTH}
          burnAfterRead={burnAfterRead}
          onBurnAfterReadChange={setBurnAfterRead}
          hasFiles={files.length > 0}
        />

        {error && (
          <p role="alert" className="shrink-0 text-sm text-red-600 dark:text-red-400">
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
          <UploadProgress pct={uploadPct} onCancel={cancelUpload} />
        )}
      </form>
    </>
  );
}
