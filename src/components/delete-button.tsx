"use client";

import { useSyncExternalStore } from "react";
import { Trash2 } from "lucide-react";
import { getDeleteToken, subscribeDeleteTokens } from "@/lib/delete-tokens";
import { OPEN_DELETE_EVENT } from "./delete-gate";

/**
 * "Delete" action shown only in the browser that created the paste (it holds
 * the delete token). Opens DeleteGate's confirmation.
 */
export default function DeleteButton({ code }: { code: string }) {
  const token = useSyncExternalStore(
    subscribeDeleteTokens,
    () => getDeleteToken(code),
    () => null
  );
  if (!token) return null;

  return (
    <button
      type="button"
      onClick={() => window.dispatchEvent(new Event(OPEN_DELETE_EVENT))}
      className="inline-flex items-center gap-1 text-sm font-medium text-red-600 hover:underline dark:text-red-400"
    >
      <Trash2 size={14} aria-hidden />
      Delete
    </button>
  );
}
