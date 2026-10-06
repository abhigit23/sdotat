"use client";

import { Clock, Flame, Lock } from "lucide-react";
import CopyButton from "./copy-button";
import ShareButton from "./share-button";

export type PasteResultData = {
  code: string;
  url: string;
  deleteUrl: string;
  expiresLabel: string;
  burn: boolean;
  passwordProtected: boolean;
};

const CHIP_CLASS =
  "inline-flex items-center gap-1 rounded-full border border-zinc-200 bg-zinc-50 px-2.5 py-1 text-zinc-600 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-300";

/** The "Your paste is ready!" card shown after a paste is created. */
export default function PasteResult({
  result,
  onCreateAnother,
}: {
  result: PasteResultData;
  onCreateAnother: () => void;
}) {
  return (
    <div className="mx-auto my-auto flex w-full max-w-md flex-col gap-4 rounded-xl border border-zinc-200 bg-white p-4 shadow-sm sm:gap-5 sm:p-6 short:gap-3 short:p-3 tiny:max-w-2xl tiny:gap-2 tiny:p-2 dark:border-zinc-800 dark:bg-zinc-900">
      <h2 className="text-center text-lg font-semibold short:text-base tiny:sr-only">Your paste is ready!</h2>
      <div className="flex flex-col gap-4 short:gap-3 tiny:grid tiny:grid-cols-2 tiny:items-start tiny:gap-3">
      <div className="flex flex-col gap-2 rounded-md border border-zinc-300 bg-zinc-50 p-3 short:p-2 dark:border-zinc-700 dark:bg-zinc-800">
        <span className="truncate text-center font-mono text-sm" title={result.url}>
          {result.url}
        </span>
        <div className="flex shrink-0 items-center justify-center gap-2">
          <ShareButton url={result.url} title="New paste on sdotat" />
          <CopyButton text={result.url} />
        </div>
      </div>
      <div className="flex flex-col gap-4 short:gap-3 tiny:gap-2">
      <ul className="flex flex-wrap items-center justify-center gap-2 text-xs short:gap-1.5">
        <li className={CHIP_CLASS}>
          <Clock size={12} aria-hidden />
          Expires in {result.expiresLabel}
        </li>
        {result.burn && (
          <li className={CHIP_CLASS}>
            <Flame size={12} aria-hidden />
            Burns after reading
          </li>
        )}
        {result.passwordProtected && (
          <li className={CHIP_CLASS}>
            <Lock size={12} aria-hidden />
            Password protected
          </li>
        )}
      </ul>
      <div className="@container flex flex-col gap-1 text-center text-sm text-zinc-500 short:text-xs dark:text-zinc-400">
        {result.passwordProtected ? (
          <p>
            The password is <strong>not</strong> part of the link. Send it
            separately, ideally over a different channel.
          </p>
        ) : (
          <p>Anyone with this link can read the paste.</p>
        )}
        {result.burn && (
          <p>The first person to open it will delete it for everyone.</p>
        )}
        <p className="text-xs">
          {/* One line where it fits (360px-wide phones and up; expiry is
              already shown in the chip above). Narrower, or with enlarged
              text, it would wrap into a misaligned second row, so below
              17.5rem (rem, so it tracks text size) the link stacks on its
              own centered line instead. */}
          Delete it later from this browser.{" "}
          <span className="whitespace-nowrap @max-[17.5rem]:block">
            <CopyButton
              text={result.deleteUrl}
              label="Copy delete link"
              copiedLabel="Delete link copied"
              variant="link"
              labelClassName="@max-[17.5rem]:justify-items-center"
            />
          </span>
        </p>
      </div>
      </div>
      </div>
      <button
        type="button"
        onClick={onCreateAnother}
        className="rounded-md border border-zinc-300 px-4 py-2 text-sm font-medium short:py-1.5 transition hover:bg-zinc-50 dark:border-zinc-700 dark:hover:bg-zinc-800"
      >
        Create another paste
      </button>
    </div>
  );
}
