"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Trash2 } from "lucide-react";
import Spinner from "./spinner";
import { getDeleteToken, removeDeleteToken } from "@/lib/delete-tokens";

type Props = {
  code: string;
  children: React.ReactNode;
};

type State =
  | { status: "idle" }
  | { status: "deleted" }
  | { status: "error"; message: string };

/** Dispatched by DeleteButton to open the confirmation with the saved token. */
export const OPEN_DELETE_EVENT = "open-delete-gate";

/**
 * Shows a delete confirmation instead of the paste when the page is opened
 * from the creator's delete link (`/<code>#delete=<token>`), or when the
 * creator clicks Delete in the browser that saved the token. A link's token is
 * read from the fragment, which the browser never sends to the server.
 */
export default function DeleteGate({ code, children }: Props) {
  const [token, setToken] = useState<string | null>(null);
  const [state, setState] = useState<State>({ status: "idle" });
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    // The fragment only exists after hydration, so this can't be initial
    // state. Also re-checked on hashchange: opening the delete link in a tab
    // already on this paste changes only the fragment, without a reload.
    const fromHash = () => {
      const match = /^#delete=([A-Za-z0-9_-]+)$/.exec(window.location.hash);
      if (!match) return;
      setState({ status: "idle" });
      setToken(match[1]);
    };
    fromHash();

    const open = () => {
      setState({ status: "idle" });
      setToken(getDeleteToken(code));
    };
    window.addEventListener("hashchange", fromHash);
    window.addEventListener(OPEN_DELETE_EVENT, open);
    return () => {
      window.removeEventListener("hashchange", fromHash);
      window.removeEventListener(OPEN_DELETE_EVENT, open);
    };
  }, [code]);

  function cancel() {
    // Drop the token from the address bar so it isn't left in history.
    history.replaceState(null, "", window.location.pathname);
    setToken(null);
  }

  async function confirmDelete() {
    setLoading(true);
    try {
      const res = await fetch(`/api/pastes/${code}/delete`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token }),
      });
      const data = await res.json().catch(() => ({}));
      // Gone either way: drop the saved token so the Delete button disappears.
      if (res.ok || res.status === 404) removeDeleteToken(code);
      if (!res.ok) {
        setState({ status: "error", message: data.error ?? "Failed to delete" });
      } else {
        history.replaceState(null, "", window.location.pathname);
        setState({ status: "deleted" });
      }
    } catch {
      setState({ status: "error", message: "Network error" });
    }
    setLoading(false);
  }

  const confirmation = token && (
    <div className="mx-auto flex w-full max-w-md flex-col items-center gap-4 rounded-xl border border-zinc-200 bg-white p-6 text-center shadow-sm sm:p-8 dark:border-zinc-800 dark:bg-zinc-900">
      {state.status === "deleted" ? (
        <>
          <h2 className="text-lg font-semibold">Paste deleted</h2>
          <p className="text-sm text-zinc-500 dark:text-zinc-400">
            The paste and its files are gone. Its link no longer works.
          </p>
          <Link
            href="/"
            className="rounded-md bg-blue-600 px-5 py-2 text-sm font-medium text-white transition hover:bg-blue-700"
          >
            Create a new paste
          </Link>
        </>
      ) : (
        <>
          <h2 className="text-lg font-semibold">Delete this paste?</h2>
          <p className="text-sm text-zinc-500 dark:text-zinc-400">
            This permanently deletes the paste and any attached files for
            everyone. It can&apos;t be undone.
          </p>
          {state.status === "error" && (
            <p role="alert" className="text-sm text-red-600 dark:text-red-400">
              {state.message}
            </p>
          )}
          <div className="flex w-full flex-col-reverse gap-2 sm:w-auto sm:flex-row">
            <button
              type="button"
              onClick={cancel}
              disabled={loading}
              className="rounded-md border border-zinc-300 px-5 py-2 text-sm font-medium transition hover:bg-zinc-50 disabled:opacity-50 dark:border-zinc-700 dark:hover:bg-zinc-800"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={confirmDelete}
              disabled={loading}
              className="flex items-center justify-center gap-2 rounded-md bg-red-600 px-5 py-2 text-sm font-medium text-white transition hover:bg-red-700 disabled:opacity-50"
            >
              {loading ? <Spinner /> : <Trash2 size={14} aria-hidden />}
              {loading ? "Deleting..." : "Delete paste"}
            </button>
          </div>
        </>
      )}
    </div>
  );

  return (
    <>
      {/* Kept mounted (just hidden) while confirming, so Cancel returns to an
          already-revealed paste instead of the "View" step. */}
      {state.status !== "deleted" && (
        <div className={token ? "hidden" : "contents"}>{children}</div>
      )}
      {confirmation}
    </>
  );
}
