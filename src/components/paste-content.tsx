"use client";

import { useEffect, useMemo, useState } from "react";
import {
  Clock,
  Download,
  Eye,
  ListOrdered,
  TextWrap,
  TriangleAlert,
} from "lucide-react";
import CopyButton from "./copy-button";
import PasteFiles, { type AttachmentMeta } from "./paste-files";
import { saveBlob } from "@/lib/download";
import { formatTimeUntil } from "@/lib/format";

type Props = {
  title: string;
  burn: boolean;
  views: number;
  content: string;
  code: string;
  attachments: AttachmentMeta[];
  contentKey?: string;
  expiresAt?: string;
};

// One DOM row per line keeps wrapped lines aligned with their number, but is
// too heavy for very long pastes, so numbering is only offered up to this.
const MAX_NUMBERED_LINES = 5000;

const TOOL_BUTTON =
  "inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-sm font-medium transition hover:bg-zinc-50 dark:hover:bg-zinc-800";

export default function PasteContent({
  title,
  burn,
  views,
  content,
  code,
  attachments,
  contentKey,
  expiresAt,
}: Props) {
  const hasText = content.trim().length > 0;
  const [wrap, setWrap] = useState(true);
  const [lineNumbers, setLineNumbers] = useState(false);
  // Set once the user has copied or downloaded the text of a burned paste.
  const [saved, setSaved] = useState(false);
  const [now, setNow] = useState(() => Date.now());

  const lines = useMemo(() => (hasText ? content.split("\n") : []), [content, hasText]);
  const canNumber = lines.length <= MAX_NUMBERED_LINES;

  useEffect(() => {
    if (!expiresAt || burn) return;
    const id = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(id);
  }, [expiresAt, burn]);
  const expiresIn = expiresAt ? formatTimeUntil(expiresAt, now) : null;

  // A burned paste exists only on this page: warn before it is lost.
  const atRisk = burn && hasText && !saved;
  useEffect(() => {
    if (!atRisk) return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [atRisk]);

  function downloadText() {
    saveBlob(
      new Blob([content], { type: "text/plain;charset=utf-8" }),
      `sdotat-${code}.txt`
    );
    setSaved(true);
  }

  const textClasses = wrap
    ? "whitespace-pre-wrap wrap-break-word"
    : "whitespace-pre";
  // Shrinks to whatever height is left on the page and scrolls inside. Shrinks
  // 4x faster than the attachment list, so long text gives way first.
  const boxClasses =
    "min-h-16 w-full shrink-[4] overflow-auto rounded-lg border border-zinc-200 bg-zinc-50 p-4 text-left font-mono text-sm leading-relaxed sm:p-6 short:p-3 dark:border-zinc-800 dark:bg-zinc-950";

  return (
    <div className="flex min-h-0 w-full flex-col">
      {burn && hasText && (
        <div
          role="status"
          className={`mb-3 flex shrink-0 items-start gap-2 rounded-lg border p-3 text-sm short:mb-2 short:p-2 ${
            saved
              ? "border-emerald-300 bg-emerald-50 text-emerald-900 dark:border-emerald-500/40 dark:bg-emerald-950/40 dark:text-emerald-200"
              : "border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-500/40 dark:bg-amber-950/40 dark:text-amber-200"
          }`}
        >
          <TriangleAlert size={16} className="mt-0.5 shrink-0" aria-hidden />
          <p>
            {saved
              ? "Saved. This paste is already deleted, so keep your copy."
              : "Copy it now. This paste is already deleted and can't be shown again. If you refresh or leave this page, the content is lost."}
          </p>
        </div>
      )}
      <div className="mb-3 flex shrink-0 flex-col items-center gap-2 text-center short:mb-2 short:gap-1 sm:flex-row sm:items-center sm:justify-between sm:text-left">
        <div className="flex flex-wrap items-center justify-center gap-x-2 gap-y-0.5 sm:justify-start">
          <h2 className="text-sm font-medium text-zinc-500 dark:text-zinc-400">
            {hasText || burn ? title : "Shared files"}
          </h2>
          {!burn && (
            <span aria-hidden className="text-xs text-zinc-500 dark:text-zinc-400">
              ·
            </span>
          )}
          {!burn && (
            <p className="flex items-center gap-1.5 text-xs text-zinc-500 dark:text-zinc-400">
              <Eye size={14} aria-hidden />
              {views} view{views === 1 ? "" : "s"}
            </p>
          )}
          {!burn && expiresAt && (
            <>
              <span
                aria-hidden
                className="text-xs text-zinc-500 dark:text-zinc-400"
              >
                ·
              </span>
              <p className="flex items-center gap-1.5 text-xs text-zinc-500 dark:text-zinc-400">
                <Clock size={12} aria-hidden />
                {expiresIn ? `Expires in ${expiresIn}` : "Expired"}
              </p>
            </>
          )}
        </div>
        {hasText && (
          <div className="flex shrink-0 flex-wrap items-center justify-center gap-2">
            <button
              type="button"
              onClick={() => setWrap((w) => !w)}
              aria-pressed={wrap}
              title="Wrap long lines"
              className={`${TOOL_BUTTON} ${
                wrap
                  ? "border-blue-500 bg-blue-50 text-blue-700 dark:border-blue-400 dark:bg-blue-950/40 dark:text-blue-300"
                  : "border-zinc-300 dark:border-zinc-700"
              }`}
            >
              <TextWrap size={14} aria-hidden />
              <span className="hidden sm:inline">Wrap</span>
              <span className="sr-only sm:hidden">Wrap long lines</span>
            </button>
            <button
              type="button"
              onClick={() => setLineNumbers((n) => !n)}
              aria-pressed={lineNumbers && canNumber}
              disabled={!canNumber}
              title={
                canNumber
                  ? "Show line numbers"
                  : `Line numbers are off for pastes over ${MAX_NUMBERED_LINES} lines`
              }
              className={`${TOOL_BUTTON} disabled:opacity-50 ${
                lineNumbers && canNumber
                  ? "border-blue-500 bg-blue-50 text-blue-700 dark:border-blue-400 dark:bg-blue-950/40 dark:text-blue-300"
                  : "border-zinc-300 dark:border-zinc-700"
              }`}
            >
              <ListOrdered size={14} aria-hidden />
              <span className="hidden sm:inline">Lines</span>
              <span className="sr-only sm:hidden">Show line numbers</span>
            </button>
            <button
              type="button"
              onClick={downloadText}
              title="Download as .txt"
              className={`${TOOL_BUTTON} border-zinc-300 dark:border-zinc-700`}
            >
              <Download size={14} aria-hidden />
              <span className="hidden sm:inline">.txt</span>
              <span className="sr-only sm:hidden">Download as .txt</span>
            </button>
            <CopyButton text={content} onCopy={() => setSaved(true)} />
          </div>
        )}
      </div>
      {hasText &&
        (lineNumbers && canNumber ? (
          <div className={boxClasses}>
            {lines.map((line, i) => (
              <div key={i} className="flex gap-4">
                <span
                  aria-hidden
                  className="w-10 shrink-0 select-none text-right tabular-nums text-zinc-500 dark:text-zinc-400"
                >
                  {i + 1}
                </span>
                <span className={`min-h-lh min-w-0 flex-1 ${textClasses}`}>
                  {line}
                </span>
              </div>
            ))}
          </div>
        ) : (
          <pre className={`${boxClasses} ${textClasses}`}>{content}</pre>
        ))}
      <PasteFiles code={code} attachments={attachments} contentKey={contentKey} />
    </div>
  );
}
