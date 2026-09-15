"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowRight } from "lucide-react";
import { isValidCode } from "@/lib/ids";
import Spinner from "./spinner";

type ParseResult = { code: string } | { error: string };

function parseInput(input: string): ParseResult {
  const trimmed = input.trim();
  if (!trimmed) return { error: "Enter a paste code or link" };

  if (isValidCode(trimmed)) return { code: trimmed };

  if (/^[A-Za-z0-9]+$/.test(trimmed)) {
    return { error: "Paste codes are 6 characters long" };
  }

  let url: URL;
  try {
    url = new URL(trimmed.includes("://") ? trimmed : `https://${trimmed}`);
  } catch {
    return { error: "That doesn't look like a valid code or link" };
  }

  if (url.host !== window.location.host) {
    return { error: "That's not a link to this app" };
  }

  const segments = url.pathname.split("/").filter(Boolean);
  if (segments.length !== 1) {
    return { error: "That link doesn't include a paste code" };
  }

  const code = segments[0];
  if (!isValidCode(code)) {
    return { error: "That link's paste code is invalid" };
  }

  return { code };
}

export default function OpenPaste() {
  const router = useRouter();
  const [value, setValue] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  function handleSubmit(e: React.SubmitEvent<HTMLFormElement>) {
    e.preventDefault();
    const result = parseInput(value);
    if ("error" in result) {
      setError(result.error);
      return;
    }
    setError(null);
    setLoading(true);
    router.push(`/${result.code}`);
  }

  return (
    <form onSubmit={handleSubmit} className="flex w-full flex-col items-center gap-2">
      <fieldset disabled={loading} className="contents">
        <div className="flex w-full max-w-md overflow-hidden rounded-lg border border-zinc-300 dark:border-zinc-700">
          <input
            type="text"
            value={value}
            onChange={(e) => {
              setValue(e.target.value);
              setError(null);
            }}
            placeholder="Enter paste code or link"
            className="min-w-0 flex-1 bg-white px-4 py-2.5 text-sm outline-none placeholder:text-zinc-400 dark:bg-zinc-900 dark:placeholder:text-zinc-500"
            autoFocus
          />
          <button
            type="submit"
            disabled={loading}
            className="flex shrink-0 items-center gap-1 bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-blue-700 disabled:opacity-50"
          >
            Open
            {loading ? <Spinner /> : <ArrowRight size={14} />}
          </button>
        </div>
      </fieldset>
      {error && <p className="text-xs text-red-600">{error}</p>}
    </form>
  );
}
