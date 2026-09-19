"use client";

import { useState } from "react";
import CopyButton from "./copy-button";
import PasswordInput from "./password-input";
import PasteFiles, { type AttachmentMeta } from "./paste-files";
import Spinner from "./spinner";

type ViewState =
  | { status: "locked" }
  | { status: "success"; content: string; burn: boolean; attachments: AttachmentMeta[] }
  | { status: "error"; message: string };

export default function PasswordGate({ code }: { code: string }) {
  const [password, setPassword] = useState("");
  const [view, setView] = useState<ViewState>({ status: "locked" });
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.SubmitEvent<HTMLFormElement>) {
    e.preventDefault();
    setLoading(true);
    setView({ status: "locked" });
    try {
      const res = await fetch(`/api/pastes/${code}/verify`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });
      const data = await res.json();
      if (!res.ok) {
        setView({ status: "error", message: data.error ?? "Failed to unlock" });
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
            Revealed securely
          </h2>
          <div className="shrink-0">
            <CopyButton text={view.content} />
          </div>
        </div>
        <pre className="max-h-[70vh] w-full overflow-auto whitespace-pre-wrap wrap-break-word rounded-lg border border-zinc-200 bg-zinc-50 p-4 text-left font-mono text-sm leading-relaxed sm:p-6 dark:border-zinc-800 dark:bg-zinc-950">
          {view.content}
        </pre>
        <PasteFiles code={code} attachments={view.attachments} password={password} />
      </div>
    );
  }

  return (
    <form
      onSubmit={handleSubmit}
      autoComplete="off"
      className="mx-auto flex w-full max-w-md flex-col gap-4 rounded-xl border border-zinc-200 bg-white p-6 shadow-sm sm:p-8 dark:border-zinc-800 dark:bg-zinc-900"
    >
      <h2 className="text-center text-lg font-semibold">This paste is password protected</h2>
      <p className="text-center text-sm text-zinc-500 dark:text-zinc-400">
        Enter the password to view the content.
      </p>
      <fieldset disabled={loading} className="contents">
        <PasswordInput
          value={password}
          onChange={setPassword}
          placeholder="Password"
          autoFocus
          className="dark:bg-zinc-800"
        />
      </fieldset>
      {view.status === "error" && (
        <p className="text-sm text-red-600">{view.message}</p>
      )}
      <button
        type="submit"
        disabled={loading || !password}
        className="flex items-center justify-center gap-2 rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-blue-700 disabled:opacity-50"
      >
        {loading && <Spinner />}
        {loading ? "Unlocking..." : "View paste"}
      </button>
    </form>
  );
}
