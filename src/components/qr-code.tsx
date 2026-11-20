"use client";

import { useEffect, useState } from "react";
import Spinner from "./spinner";

/** Quiet zone in modules; the QR spec asks for 4 so scanners find the code. */
const BORDER = 4;

/**
 * SVG path covering the dark modules, one rectangle per horizontal run, so
 * even a dense code is a single small element.
 */
export function qrPath(data: boolean[][]): string {
  let d = "";
  data.forEach((row, y) => {
    let x = 0;
    while (x < row.length) {
      if (!row[x]) {
        x++;
        continue;
      }
      const start = x;
      while (x < row.length && row[x]) x++;
      d += `M${start + BORDER} ${y + BORDER}h${x - start}v1h${start - x}z`;
    }
  });
  return d;
}

/**
 * A QR code for `text`, drawn as SVG elements (not markup injected as HTML,
 * so the CSP needs nothing extra). The encoder is loaded on first render,
 * keeping it out of the main bundle. Always dark on white, even in dark mode,
 * since that's what scanners read most reliably.
 */
export default function QrCode({
  text,
  label,
  className = "",
}: {
  text: string;
  /** Accessible description of what the code links to. */
  label: string;
  className?: string;
}) {
  const [qr, setQr] = useState<{ text: string; size: number; path: string } | null>(null);

  useEffect(() => {
    let cancelled = false;
    import("uqr").then(({ encode }) => {
      if (cancelled) return;
      // Medium error correction: still scans with a smudge or glare, without
      // making short links needlessly dense.
      const { data, size } = encode(text, { ecc: "M", border: 0 });
      setQr({ text, size, path: qrPath(data) });
    });
    return () => {
      cancelled = true;
    };
  }, [text]);

  // Stale while a new text encodes: show the spinner rather than a code for
  // the previous link.
  const ready = qr?.text === text ? qr : null;
  const viewBox = ready ? ready.size + BORDER * 2 : 0;

  return (
    <div
      className={`flex aspect-square items-center justify-center rounded-md bg-white text-zinc-900 ${className}`}
    >
      {ready ? (
        <svg
          viewBox={`0 0 ${viewBox} ${viewBox}`}
          role="img"
          aria-label={label}
          shapeRendering="crispEdges"
          className="h-full w-full"
        >
          <path d={ready.path} fill="currentColor" />
        </svg>
      ) : (
        <Spinner />
      )}
    </div>
  );
}
