"use client";

import { Plus, X } from "lucide-react";
import FileIcon from "./file-icon";
import { formatBytes, formatFileCount } from "@/lib/format";

type Props = {
  files: File[];
  totalBytes: number;
  isDragging: boolean;
  disabled: boolean;
  onAdd: (files: File[]) => void;
  onRemove: (index: number) => void;
};

/** The editor's attachments box: file picker, selected files and totals. */
export default function AttachmentsField({
  files,
  totalBytes,
  isDragging,
  disabled,
  onAdd,
  onRemove,
}: Props) {
  function onSelectFiles(e: React.ChangeEvent<HTMLInputElement>) {
    const list = e.target.files;
    if (!list) return;
    const next = Array.from(list);
    // Reset the native input immediately so its "N files" label doesn't keep
    // a stale count after files are removed from the list below.
    e.target.value = "";
    onAdd(next);
  }

  return (
    <div
      className={`flex shrink-0 flex-col gap-1.5 rounded-xl border border-dashed p-3 transition-colors short:gap-1 short:p-2 tiny:p-1.5 ${
        isDragging
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
          disabled={disabled}
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
                  onClick={() => onRemove(i)}
                  className="flex h-6 w-6 shrink-0 items-center justify-center rounded text-zinc-500 transition hover:text-red-500 dark:text-zinc-400 dark:hover:text-red-400"
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
  );
}

/** Full-page hint shown while files are dragged over the page. */
export function DropOverlay() {
  return (
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
  );
}
