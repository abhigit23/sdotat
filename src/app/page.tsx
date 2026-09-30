import { connection } from "next/server";
import PasteEditor from "@/components/paste-editor";
import OpenPaste from "@/components/open-paste";

export default async function Home() {
  await connection();

  return (
    // min-h-0 + overflow-y-auto make this the one place that scrolls, and only
    // when even the compact layout cannot fit (e.g. a phone held sideways).
    <main
      data-page-scroll
      className="flex min-h-0 flex-1 flex-col items-center overflow-y-auto px-4 py-3 sm:px-6 short:py-2 tiny:pr-14"
    >
      <div className="flex w-full max-w-3xl flex-1 flex-col">
        <header className="mb-3 shrink-0 text-center short:mb-2 tiny:hidden">
          <h1 className="text-2xl font-bold tracking-tight sm:text-3xl short:text-xl tiny:text-base">
            s.at
          </h1>
          <p className="mt-1 text-sm text-zinc-500 short:hidden dark:text-zinc-400">
            Share short, self-destructing pastes
          </p>
        </header>
        <PasteEditor />
        <div className="mt-3 flex shrink-0 items-center gap-3 text-xs text-zinc-500 short:mt-2 tiny:hidden dark:text-zinc-400">
          <span className="flex-1 border-t border-zinc-300 dark:border-zinc-700" />
          have a paste code or link?
          <span className="flex-1 border-t border-zinc-300 dark:border-zinc-700" />
        </div>
        <div className="mt-2 flex shrink-0 justify-center tiny:mt-1">
          <OpenPaste />
        </div>
      </div>
    </main>
  );
}
