"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Clock,
  Download,
  Eye,
  ListOrdered,
  Lock,
  Maximize2,
  Minimize2,
  TextWrap,
  TriangleAlert,
} from "lucide-react";
import CopyButton from "./copy-button";
import PasteFiles, { type AttachmentMeta } from "./paste-files";
import { saveBlob } from "@/lib/download";
import { formatTimeUntil } from "@/lib/format";

type Props = {
  burn: boolean;
  /** Unlocked with a password; shown as an item in the meta line. */
  passwordProtected?: boolean;
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

// Fixed 34px height (their natural height with a text label) so icon-only
// buttons on phones match Copy, which keeps its label. On phones the
// icon-only ones are 34px squares, keeping the toolbar on one row.
const TOOL_BUTTON =
  "inline-flex h-[34px] items-center gap-1.5 rounded-md border px-3 py-1.5 text-sm font-medium transition hover:bg-zinc-50 max-sm:w-[34px] max-sm:justify-center max-sm:px-0 dark:hover:bg-zinc-800";

/** History entry marker for the expanded view, so Back closes it. */
const EXPANDED_STATE = "paste-expanded";

export default function PasteContent({
  burn,
  passwordProtected = false,
  views,
  content,
  code,
  attachments,
  contentKey,
  expiresAt,
}: Props) {
  const hasText = content.trim().length > 0;
  const title = burn
    ? "Revealed once — this paste has been deleted"
    : hasText
      ? "Paste content"
      : "Shared files";
  const [wrap, setWrap] = useState(true);
  const [lineNumbers, setLineNumbers] = useState(false);
  // Set once the user has copied or downloaded the text of a burned paste.
  const [saved, setSaved] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  // The text filling the window (not browser fullscreen).
  const [expanded, setExpanded] = useState(false);
  // The Expand/Close button. Focus is put on it explicitly when the view
  // opens or closes, since some browsers (Safari) don't focus clicked buttons.
  const expandButtonRef = useRef<HTMLButtonElement>(null);

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

  // Opening adds a history entry so the Back button (what phone users reach
  // for) closes the view instead of leaving the page. Closing by button or
  // Esc goes back through that entry, so history stays as it was.
  function openExpanded() {
    history.pushState({ [EXPANDED_STATE]: true }, "");
    setExpanded(true);
    expandButtonRef.current?.focus();
  }
  const finishClose = useCallback(() => {
    setExpanded(false);
    expandButtonRef.current?.focus();
  }, []);
  const closeExpanded = useCallback(() => {
    // Leaves through the history entry; popstate then finishes the close.
    if (history.state?.[EXPANDED_STATE]) history.back();
    else finishClose();
  }, [finishClose]);

  useEffect(() => {
    if (!expanded) return;
    const onPopState = finishClose;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") closeExpanded();
    };
    window.addEventListener("popstate", onPopState);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("popstate", onPopState);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [expanded, closeExpanded, finishClose]);

  function downloadText() {
    saveBlob(
      new Blob([content], { type: "text/plain;charset=utf-8" }),
      `sdotat-${code}.txt`
    );
    setSaved(true);
  }

  // Views, expiry and password items. Hidden in the expanded view on phones,
  // which keeps just the title so the text gets the room (they still show in
  // the normal view and in the expanded view on wider screens).
  const metaItemClasses = `flex items-center gap-1.5 text-xs text-zinc-500 dark:text-zinc-400 ${
    expanded ? "max-sm:hidden" : ""
  }`;

  const textClasses = wrap
    ? "whitespace-pre-wrap wrap-break-word"
    : "whitespace-pre";
  // Shrinks to whatever height is left on the page and scrolls inside. Shrinks
  // 4x faster than the attachment list, so long text gives way first. When
  // expanded it grows to fill the window instead.
  const boxClasses = `min-h-16 w-full shrink-[4] overflow-auto rounded-lg border border-zinc-200 bg-zinc-50 p-4 text-left font-mono text-sm leading-relaxed sm:p-6 short:p-3 dark:border-zinc-800 dark:bg-zinc-950 ${
    expanded ? "flex-1" : ""
  }`;

  return (
    <div className="flex min-h-0 w-full flex-col">
      {/* The banner, header and text box. Normally `contents` (lays out as if
          this wrapper weren't there); expanded, the same elements become a
          window-filling layer, so scroll position and Wrap/Lines carry over.
          The theme toggle (fixed, z-50) stays on top: the right padding keeps
          the toolbar clear of it. */}
      <div
        className={
          expanded
            ? "fixed inset-0 z-40 flex flex-col bg-zinc-50 p-4 dark:bg-zinc-950"
            : "contents"
        }
        role={expanded ? "dialog" : undefined}
        aria-modal={expanded || undefined}
        aria-label={expanded ? "Paste content, expanded" : undefined}
      >
      {burn && hasText && (
        <div
          role="status"
          className={`mb-3 flex shrink-0 items-start gap-2 rounded-lg border p-3 text-sm short:mb-2 short:p-2 ${
            expanded ? "mr-12" : ""
          } ${
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
      {/* Expanded on wide screens: one row lined up with the theme toggle
          (pr-12 keeps clear of it). Expanded on phones: a reading mode with
          two left-aligned rows, just the title lined up with the toggle, then
          the tools with Close at the far right. */}
      <div
        className={`mb-3 flex shrink-0 flex-col items-center gap-2 text-center short:mb-2 short:gap-1 sm:flex-row sm:items-center sm:justify-between sm:text-left ${
          expanded ? "max-sm:items-stretch max-sm:text-left sm:min-h-9 sm:pr-12" : ""
        }`}
      >
        {/* No "·" separators: each item has its own icon, and separators
            would dangle at line ends when this wraps on phones. */}
        <div
          className={`flex flex-wrap items-center justify-center gap-x-3 gap-y-0.5 sm:justify-start ${
            expanded ? "max-sm:min-h-9 max-sm:justify-start max-sm:pr-12" : ""
          }`}
        >
          <h2 className="text-sm font-medium text-zinc-500 dark:text-zinc-400">
            {title}
          </h2>
          {!burn && (
            <p className={metaItemClasses}>
              <Eye size={14} aria-hidden />
              {views} view{views === 1 ? "" : "s"}
            </p>
          )}
          {!burn && expiresAt && (
            <p className={metaItemClasses}>
              <Clock size={12} aria-hidden />
              {expiresIn ? `Expires in ${expiresIn}` : "Expired"}
            </p>
          )}
          {passwordProtected && (
            <p className={metaItemClasses}>
              <Lock size={12} aria-hidden />
              Password protected
            </p>
          )}
        </div>
        {hasText && (
          <div
            className={`flex shrink-0 flex-wrap items-center justify-center gap-2 ${
              expanded ? "max-sm:justify-start" : ""
            }`}
          >
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
            <CopyButton
              text={content}
              onCopy={() => setSaved(true)}
              className="h-[34px]"
            />
            <button
              ref={expandButtonRef}
              type="button"
              onClick={expanded ? closeExpanded : openExpanded}
              title={expanded ? "Close expanded view (Esc)" : "Expand to fill the window"}
              className={`${TOOL_BUTTON} border-zinc-300 dark:border-zinc-700 ${
                expanded ? "max-sm:ml-auto" : ""
              }`}
            >
              {expanded ? (
                <Minimize2 size={14} aria-hidden />
              ) : (
                <Maximize2 size={14} aria-hidden />
              )}
              <span className="hidden sm:inline">
                {expanded ? "Close" : "Expand"}
              </span>
              <span className="sr-only sm:hidden">
                {expanded ? "Close expanded view" : "Expand text"}
              </span>
            </button>
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
      </div>
      <PasteFiles code={code} attachments={attachments} contentKey={contentKey} />
    </div>
  );
}
