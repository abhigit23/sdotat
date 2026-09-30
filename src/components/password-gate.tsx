"use client";

import { useState } from "react";
import PasteContent from "./paste-content";
import type { AttachmentMeta } from "./paste-files";
import PasswordInput from "./password-input";
import Spinner from "./spinner";
import {
  deriveKeyFromPassword,
  base64ToBytes,
  bytesToBase64,
} from "@/lib/client-crypto";

type ViewState =
  | { status: "locked" }
  | { status: "success"; content: string; burn: boolean; attachments: AttachmentMeta[]; views: number; expiresAt?: string }
  | { status: "error"; message: string };

type Props = {
  code: string;
  salt: string;
};

export default function PasswordGate({ code, salt }: Props) {
  const [password, setPassword] = useState("");
  const [view, setView] = useState<ViewState>({ status: "locked" });
  const [loading, setLoading] = useState(false);
  const [keyB64, setKeyB64] = useState("");

  async function handleSubmit(e: React.SubmitEvent<HTMLFormElement>) {
    e.preventDefault();
    setLoading(true);
    setView({ status: "locked" });
    try {
      // Trim to match the editor, which trims before deriving the key.
      const derived = await deriveKeyFromPassword(
        password.trim(),
        base64ToBytes(salt)
      );
      const key = bytesToBase64(derived.key);
      setKeyB64(key);
      const res = await fetch(`/api/pastes/${code}/verify`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ contentKey: key }),
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
        views: data.views ?? 0,
        expiresAt: data.expiresAt ?? undefined,
      });
    } catch {
      setView({ status: "error", message: "Network error" });
      setLoading(false);
    }
  }

  if (view.status === "success") {
    return (
      <PasteContent
        title="Revealed securely"
        burn={view.burn}
        views={view.views}
        content={view.content}
        code={code}
        attachments={view.attachments}
        contentKey={keyB64}
        expiresAt={view.expiresAt}
      />
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
        <p role="alert" className="text-sm text-red-600">
          {view.message}
        </p>
      )}
      <button
        type="submit"
        disabled={loading || !password.trim()}
        className="flex items-center justify-center gap-2 rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-blue-700 disabled:opacity-50"
      >
        {loading && <Spinner />}
        {loading ? "Unlocking..." : "View paste"}
      </button>
    </form>
  );
}
