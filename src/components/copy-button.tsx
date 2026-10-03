"use client";

import { useState } from "react";
import { Check, Copy } from "lucide-react";

const VARIANT_CLASS = {
  button:
    "gap-1.5 rounded-md border border-zinc-300 px-3 py-1.5 text-sm font-medium transition hover:bg-zinc-50 dark:border-zinc-700 dark:hover:bg-zinc-800",
  // Inline text link for secondary actions inside a sentence. Its color
  // depends on the copied state, so it's set at render time. align-top keeps
  // the line steady: otherwise the check icon, as the label's first item,
  // would shift the baseline the link sits on.
  link: "align-top font-medium underline-offset-2",
};

export default function CopyButton({
  text,
  label = "Copy",
  copiedLabel = "Copied!",
  onCopy,
  variant = "button",
  labelClassName = "",
}: {
  text: string;
  label?: string;
  copiedLabel?: string;
  onCopy?: () => void;
  variant?: keyof typeof VARIANT_CLASS;
  /** Extra classes for the label grid, e.g. to change its alignment. */
  labelClassName?: string;
}) {
  const [copied, setCopied] = useState(false);
  const isLink = variant === "link";

  // The link variant has no leading icon, so its copied label starts with a
  // check instead (and turns green, below).
  const renderLabel = (showCopied: boolean) => (
    <>
      {isLink && showCopied && <Check size={12} aria-hidden />}
      {showCopied ? copiedLabel : label}
    </>
  );

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      onCopy?.();
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard API may be unavailable; ignore.
    }
  }

  return (
    <button
      type="button"
      onClick={handleCopy}
      className={`inline-flex items-center ${VARIANT_CLASS[variant]} ${
        !isLink
          ? ""
          : copied
            ? "text-emerald-600 dark:text-emerald-400"
            : "text-blue-600 hover:underline dark:text-blue-400"
      }`}
    >
      {!isLink &&
        (copied ? <Check size={14} aria-hidden /> : <Copy size={14} aria-hidden />)}
      {/* Both labels share one grid cell so the button keeps the wider
          width and neighbours don't shift when the text swaps. Buttons center
          the label in that width (matching ShareButton, whose plain text is
          centered by the button); links start-align it so the link follows
          the text before it with no gap. */}
      <span
        className={`grid ${isLink ? "" : "justify-items-center"} ${labelClassName}`}
      >
        <span
          aria-live="polite"
          className="inline-flex items-center gap-1 [grid-area:1/1]"
        >
          {renderLabel(copied)}
        </span>
        <span
          aria-hidden
          className="invisible inline-flex items-center gap-1 [grid-area:1/1]"
        >
          {renderLabel(!copied)}
        </span>
      </span>
    </button>
  );
}
