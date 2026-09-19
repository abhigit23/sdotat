"use client";

import { useRef, useState } from "react";

export type AttachmentMeta = {
  id: string;
  filename: string;
  mime: string;
  size: number;
};

type Props = {
  code: string;
  attachments: AttachmentMeta[];
  password?: string;
};

const DOWNLOAD_CONCURRENCY = 3;

function formatBytes(n: number): string {
  if (n >= 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MB`;
  if (n >= 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${n} B`;
}

export default function PasteFiles({ code, attachments, password }: Props) {
  const [busy, setBusy] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState<Record<string, number>>({});
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

  async function download(a: AttachmentMeta) {
    setBusyId(a.id, true);
    setError(null);
    try {
      const res = await fetch(`/api/pastes/${code}/files/${a.id}`, {
        headers: password ? { "X-Paste-Password": password } : undefined,
      });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        setError(data?.error ?? "Failed to download file");
        setProgress((prev) => ({ ...prev, [a.id]: 0 }));
        setBusyId(a.id, false);
        return;
      }
      const reader = (res.body as ReadableStream<Uint8Array>).getReader();
      const chunks: Uint8Array[] = [];
      let received = 0;
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value);
        received += value.byteLength;
        setProgress((prev) => ({
          ...prev,
          [a.id]: Math.min(100, Math.round((received / a.size) * 100)),
        }));
      }
      const blob = new Blob(chunks as unknown as BlobPart[], { type: a.mime });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = a.filename;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
    } catch {
      setError("Network error");
    }
    setProgress((prev) => ({ ...prev, [a.id]: 0 }));
    setBusyId(a.id, false);
  }

  if (attachments.length === 0) return null;

  return (
    <div className="mt-4 w-full">
      <h2 className="mb-2 text-sm font-medium text-zinc-500 dark:text-zinc-400">
        Attachments ({attachments.length})
      </h2>
      {error && <p className="mb-2 text-sm text-red-600">{error}</p>}
      <ul className="flex flex-col gap-2">
        {attachments.map((a) => (
          <li key={a.id} className="relative overflow-hidden rounded-md">
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
              <span className="relative min-w-0 truncate font-mono">
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