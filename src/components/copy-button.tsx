"use client";

import { useState } from "react";
import { Check, Copy } from "lucide-react";

export default function CopyButton({
  text,
  label = "Copy",
  onCopy,
}: {
  text: string;
  label?: string;
  onCopy?: () => void;
}) {
  const [copied, setCopied] = useState(false);

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
      className="inline-flex items-center gap-1.5 rounded-md border border-zinc-300 px-3 py-1.5 text-sm font-medium transition hover:bg-zinc-50 dark:border-zinc-700 dark:hover:bg-zinc-800"
    >
      {copied ? <Check size={14} aria-hidden /> : <Copy size={14} aria-hidden />}
      {/* Both labels share one grid cell so the button keeps the wider
          width and neighbours don't shift when the text swaps. */}
      <span className="grid">
        <span aria-live="polite" className="[grid-area:1/1]">
          {copied ? "Copied!" : label}
        </span>
        <span aria-hidden className="invisible [grid-area:1/1]">
          {copied ? label : "Copied!"}
        </span>
      </span>
    </button>
  );
}
