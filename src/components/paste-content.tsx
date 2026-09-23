"use client";

import { Eye } from "lucide-react";
import CopyButton from "./copy-button";
import PasteFiles, { type AttachmentMeta } from "./paste-files";

type Props = {
  title: string;
  burn: boolean;
  views: number;
  content: string;
  code: string;
  attachments: AttachmentMeta[];
  contentKey?: string;
};

export default function PasteContent({
  title,
  burn,
  views,
  content,
  code,
  attachments,
  contentKey,
}: Props) {
  return (
    <div className="w-full">
      <div className="mb-4 flex flex-col items-center gap-2 text-center sm:flex-row sm:items-center sm:justify-between sm:text-left">
        <div className="flex flex-wrap items-center justify-center gap-x-2 gap-y-0.5 sm:justify-start">
          <h2 className="text-sm font-medium text-zinc-500 dark:text-zinc-400">
            {title}
          </h2>
          {!burn && (
            <span aria-hidden className="text-xs text-zinc-400 dark:text-zinc-500">
              ·
            </span>
          )}
          {!burn && (
            <p className="flex items-center gap-1.5 text-xs text-zinc-500 dark:text-zinc-400">
              <Eye size={14} aria-hidden />
              {views} view{views === 1 ? "" : "s"}
            </p>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <CopyButton text={content} />
        </div>
      </div>
      <pre className="max-h-[70vh] w-full overflow-auto whitespace-pre-wrap wrap-break-word rounded-lg border border-zinc-200 bg-zinc-50 p-4 text-left font-mono text-sm leading-relaxed sm:p-6 dark:border-zinc-800 dark:bg-zinc-950">
        {content}
      </pre>
      <PasteFiles code={code} attachments={attachments} contentKey={contentKey} />
    </div>
  );
}