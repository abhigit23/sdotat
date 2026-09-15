"use client";

import { useState } from "react";
import CopyButton from "./copy-button";
import PasteFiles, { type AttachmentMeta } from "./paste-files";
import Spinner from "./spinner";

type Props = {
  code: string;
  burnAfterRead: boolean;
};

type ViewState =
  | { status: "waiting" }
  | { status: "success"; content: string; burn: boolean; attachments: AttachmentMeta[]; password?: string }
  | { status: "error"; message: string };

export default function PasteReveal({ code, burnAfterRead }: Props) {
  const [view, setView] = useState<ViewState>({ status: "waiting" });
  const [loading, setLoading] = useState(false);

  async function reveal() {
    setLoading(true);
    setView({ status: "waiting" });
    try {
      const res = await fetch(`/api/pastes/${code}/reveal`, {
        method: "POST",
      });
      const data = await res.json();
      if (!res.ok) {
        setView({ status: "error", message: data.error ?? "Failed to load" });
        setLoading(false);
        return;
      }
      setView({
        status: "success",
        content: data.content,
        burn: data.burnAfterRead,
        attachments: data.attachments ?? [],
      });
    } catch {
      setView({ status: "error", message: "Network error" });
      setLoading(false);
    }
  }

  if (view.status === "success") {
    return (
      <div className="w-full">
        <div className="mb-4 flex flex-col items-center gap-2 text-center sm:flex-row sm:justify-between sm:text-left">
          <h2 className="text-sm font-medium text-zinc-500 sm:mr-4 dark:text-zinc-400">
            {view.burn ? "Revealed once — this paste has been deleted" : "Paste content"}
          </h2>
          <div className="shrink-0">
            <CopyButton text={view.content} />
          </div>
        </div>
        <pre className="max-h-[70vh] w-full overflow-auto whitespace-pre-wrap wrap-break-word rounded-lg border border-zinc-200 bg-zinc-50 p-4 text-left font-mono text-sm leading-relaxed sm:p-6 dark:border-zinc-800 dark:bg-zinc-950">
          {view.content}
        </pre>
        <PasteFiles code={code} attachments={view.attachments} />
      </div>
    );
  }

  return (
    <div className="mx-auto flex w-full max-w-md flex-col items-center gap-4 rounded-xl border border-zinc-200 bg-white p-6 text-center shadow-sm sm:p-8 dark:border-zinc-800 dark:bg-zinc-900">
      <h2 className="text-lg font-semibold">
        {burnAfterRead
          ? "This paste can only be viewed once"
          : "View this paste"}
      </h2>
      {burnAfterRead && (
        <p className="text-sm text-zinc-500 dark:text-zinc-400">
          Once you view the content, it will be permanently deleted and
          unrecoverable.
        </p>
      )}
      {view.status === "error" && (
        <p className="text-sm text-red-600">{view.message}</p>
      )}
      <button
        type="button"
        onClick={reveal}
        disabled={loading}
        className="flex w-full items-center justify-center gap-2 rounded-md bg-blue-600 px-5 py-2 text-sm font-medium text-white transition hover:bg-blue-700 disabled:opacity-50 sm:w-auto"
      >
        {loading && <Spinner />}
        {loading ? "Revealing..." : burnAfterRead ? "I understand, reveal it" : "View"}
      </button>
    </div>
  );
}
