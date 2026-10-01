"use client";

import { useState } from "react";
import { Share2 } from "lucide-react";

export default function ShareButton({
  url,
  title,
  text,
  label = "Share",
}: {
  url?: string;
  title?: string;
  text?: string;
  label?: string;
}) {
  const [copied, setCopied] = useState(false);

  async function handleShare() {
    const target = url ?? window.location.href;
    try {
      if (navigator.share) {
        await navigator.share({
          url: target,
          title: title ?? document.title,
          text,
        });
        return;
      }
      try {
        await navigator.clipboard.writeText(target);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      } catch {
        // Clipboard API may be unavailable; ignore.
      }
    } catch {
      // User dismissed the share sheet; ignore.
    }
  }

  return (
    <button
      type="button"
      onClick={handleShare}
      className="inline-flex items-center gap-1.5 rounded-md border border-zinc-300 px-3 py-1.5 text-sm font-medium transition hover:bg-zinc-50 dark:border-zinc-700 dark:hover:bg-zinc-800"
    >
      <Share2 size={14} aria-hidden />
      {/* See CopyButton: reserve the wider label's width to avoid shifts. */}
      <span className="grid">
        <span className="[grid-area:1/1]">{copied ? "Copied!" : label}</span>
        <span aria-hidden className="invisible [grid-area:1/1]">
          {copied ? label : "Copied!"}
        </span>
      </span>
    </button>
  );
}