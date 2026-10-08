"use client";

import { useRef, useState } from "react";
import { Download } from "lucide-react";
import FileIcon from "./file-icon";
import { saveBlob } from "@/lib/download";
import { formatBytes, formatFileCount } from "@/lib/format";
import { mapWithConcurrency } from "@/lib/map-concurrency";
import { createZip, dedupeNames } from "@/lib/zip";

export type AttachmentMeta = {
  id: string;
  filename: string;
  mime: string;
  size: number;
};

type Props = {
  code: string;
  attachments: AttachmentMeta[];
  contentKey?: string;
};

const DOWNLOAD_CONCURRENCY = 3;

export default function PasteFiles({ code, attachments, contentKey }: Props) {
  const [busy, setBusy] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState<Record<string, number>>({});
  const [zipping, setZipping] = useState(false);
  const [zipProgress, setZipProgress] = useState(0);
  const activeRef = useRef(0);
  const pendingRef = useRef<Array<() => void>>([]);

  function setBusyId(id: string, value: boolean) {
    setBusy((prev) => {
      const next = new Set(prev);
      if (value) next.add(id);
      else next.delete(id);
      return next;
    });
  }

  function runWhenReady(run: () => Promise<void>) {
    const start = () => {
      activeRef.current += 1;
      run().finally(() => {
        activeRef.current -= 1;
        const next = pendingRef.current.shift();
        if (next) next();
      });
    };
    if (activeRef.current < DOWNLOAD_CONCURRENCY) start();
    else pendingRef.current.push(start);
  }

  // Fetches one attachment, reporting received bytes. Throws Error(message) on
  // failure so callers decide how to surface it.
  async function fetchAttachment(
    a: AttachmentMeta,
    onBytes: (received: number) => void
  ): Promise<Blob> {
    const res = await fetch(`/api/pastes/${code}/files/${a.id}`, {
      headers: contentKey ? { "X-Paste-Key": contentKey } : undefined,
    });
    if (!res.ok) {
      const data = await res.json().catch(() => null);
      throw new Error(data?.error ?? "Failed to download file");
    }
    const body = res.body;
    if (!body) throw new Error("No response body");

    let received = 0;
    const progressStream = body.pipeThrough(
      new TransformStream<Uint8Array, Uint8Array>({
        transform(chunk, controller) {
          received += chunk.byteLength;
          onBytes(received);
          controller.enqueue(chunk);
        },
      })
    );
    return new Response(progressStream, {
      headers: { "Content-Type": a.mime },
    }).blob();
  }

  async function download(a: AttachmentMeta) {
    setBusyId(a.id, true);
    setError(null);
    try {
      // Throttle progress updates to integer percent changes — a per-chunk
      // setState on a 50 MB file would trigger hundreds of React renders.
      let lastPct = -1;
      const blob = await fetchAttachment(a, (received) => {
        const pct = Math.min(100, Math.round((received / a.size) * 100));
        if (pct !== lastPct) {
          lastPct = pct;
          setProgress((prev) => ({ ...prev, [a.id]: pct }));
        }
      });
      saveBlob(blob, a.filename);
    } catch (e) {
      setError(e instanceof Error && e.message ? e.message : "Network error");
    }
    setProgress((prev) => ({ ...prev, [a.id]: 0 }));
    setBusyId(a.id, false);
  }

  async function downloadAll() {
    setZipping(true);
    setZipProgress(0);
    setError(null);
    const totalSize = attachments.reduce((sum, a) => sum + a.size, 0);
    const receivedById: Record<string, number> = {};
    let lastPct = -1;
    const report = (id: string, received: number) => {
      receivedById[id] = received;
      const got = Object.values(receivedById).reduce((s, n) => s + n, 0);
      const pct = Math.min(
        100,
        Math.round((got / Math.max(totalSize, 1)) * 100)
      );
      if (pct !== lastPct) {
        lastPct = pct;
        setZipProgress(pct);
      }
    };

    const results = await mapWithConcurrency(
      attachments,
      DOWNLOAD_CONCURRENCY,
      async (a) => {
        try {
          const blob = await fetchAttachment(a, (n) => report(a.id, n));
          return { a, data: new Uint8Array(await blob.arrayBuffer()) };
        } catch {
          return { a, data: null };
        }
      }
    );

    const ok = results.filter((r) => r.data !== null);
    const failed = results.filter((r) => r.data === null);
    if (ok.length > 0) {
      const names = dedupeNames(ok.map((r) => r.a.filename));
      const zip = createZip(
        ok.map((r, i) => ({ name: names[i], data: r.data as Uint8Array }))
      );
      saveBlob(zip, `sdotat-${code}.zip`);
    }
    if (failed.length > 0) {
      setError(
        `${formatFileCount(failed.length)} failed: ${failed
          .map((r) => r.a.filename)
          .join(", ")}`
      );
    }
    setZipping(false);
    setZipProgress(0);
  }

  if (attachments.length === 0) return null;

  const totalSize = attachments.reduce((sum, a) => sum + a.size, 0);

  return (
    // Takes part in the page's one-screen layout: grows to show every file
    // that fits and only scrolls when the page runs out of room. The text box
    // shrinks 4x faster (PasteContent), so a long paste mostly scrolls in its
    // own box rather than squeezing the file list. (Shrink factors stay >= 1:
    // a lone item with a factor below 1 absorbs only that share of overflow.)
    <div className="mt-3 flex min-h-0 w-full flex-col short:mt-2">
      <div className="mb-2 flex shrink-0 flex-wrap items-center justify-between gap-x-3 gap-y-2 short:mb-1">
        <h2 className="text-sm font-medium text-zinc-500 dark:text-zinc-400">
          Attachments ({attachments.length})
        </h2>
        {attachments.length > 1 && (
          <button
            type="button"
            onClick={downloadAll}
            disabled={zipping}
            className="relative flex shrink-0 items-center gap-1.5 overflow-hidden whitespace-nowrap rounded-md border border-zinc-200 bg-white px-3 py-1.5 text-xs transition hover:bg-zinc-50 disabled:opacity-50 dark:border-zinc-800 dark:bg-zinc-900 dark:hover:bg-zinc-800"
          >
            {zipping && zipProgress > 0 ? (
              <span
                aria-hidden
                className="absolute inset-y-0 left-0 bg-sky-500/25 transition-[width] duration-200 ease-out"
                style={{ width: `${zipProgress}%` }}
              />
            ) : null}
            <Download className="relative size-3.5" aria-hidden />
            <span className="relative">
              {zipping ? `Zipping… ${zipProgress}%` : "Download all (.zip)"}
            </span>
            {!zipping && (
              <span className="relative text-zinc-500 dark:text-zinc-400">
                · {formatBytes(totalSize)}
              </span>
            )}
          </button>
        )}
      </div>
      {error && (
        <p role="alert" className="mb-2 shrink-0 text-sm text-red-600 dark:text-red-400">
          {error}
        </p>
      )}
      {/* Scrolls only once the list outgrows the space left on the page. */}
      <ul className="flex min-h-0 flex-col gap-2 overflow-y-auto">
        {attachments.map((a) => (
          <li key={a.id} className="relative shrink-0 overflow-hidden rounded-md">
            <button
              type="button"
              onClick={() => runWhenReady(() => download(a))}
              disabled={busy.has(a.id)}
              className="relative flex w-full items-center justify-between gap-3 overflow-hidden rounded-md border border-zinc-200 bg-white px-3 py-2 text-left text-sm transition hover:bg-zinc-50 disabled:opacity-50 dark:border-zinc-800 dark:bg-zinc-900 dark:hover:bg-zinc-800"
            >
              {progress[a.id] ? (
                <span
                  aria-hidden
                  className="absolute inset-y-0 left-0 bg-sky-500/25 transition-[width] duration-200 ease-out"
                  style={{ width: `${progress[a.id]}%` }}
                />
              ) : null}
              <FileIcon
                name={a.filename}
                mime={a.mime}
                className="relative shrink-0 text-zinc-500 dark:text-zinc-400"
              />
              <span className="relative min-w-0 flex-1 truncate font-mono">
                {a.filename}
              </span>
              <span className="relative shrink-0 text-xs text-zinc-500 dark:text-zinc-400">
                {formatBytes(a.size)}
              </span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}