"use client";

type Props = {
  pct: number;
  onCancel: () => void;
};

/** Upload progress bar with a Cancel action, shown while files upload. */
export default function UploadProgress({ pct, onCancel }: Props) {
  return (
    <div className="flex shrink-0 items-center gap-3">
      <div
        role="progressbar"
        aria-label="Upload progress"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={pct}
        className="h-2 flex-1 overflow-hidden rounded-full bg-zinc-200 dark:bg-zinc-800"
      >
        <div
          className="h-full rounded-full bg-blue-600 transition-[width] duration-200 ease-out"
          style={{ width: `${pct}%` }}
        />
      </div>
      <span className="w-10 text-right text-xs tabular-nums text-zinc-500 dark:text-zinc-400">
        {pct}%
      </span>
      <button
        type="button"
        onClick={onCancel}
        className="text-xs font-medium text-red-600 hover:underline dark:text-red-400"
      >
        Cancel
      </button>
    </div>
  );
}
