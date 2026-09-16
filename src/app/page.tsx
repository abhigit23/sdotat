import { connection } from "next/server";
import PasteEditor from "@/components/paste-editor";
import OpenPaste from "@/components/open-paste";

export default async function Home() {
  await connection();

  return (
    <main className="flex flex-1 flex-col items-center px-4 py-4 sm:px-6">
      <div className="w-full max-w-3xl">
        <header className="mb-4 pt-2 text-center sm:mb-6">
          <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">s.at</h1>
          <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
            Share short, self-destructing pastes
          </p>
        </header>
        <div className="mb-4 flex justify-center">
          <OpenPaste />
        </div>
        <div className="flex items-center gap-3 text-xs text-zinc-500 dark:text-zinc-400">
          <span className="flex-1 border-t border-zinc-300 dark:border-zinc-700" />
          or create a new paste
          <span className="flex-1 border-t border-zinc-300 dark:border-zinc-700" />
        </div>
        <div className="mt-4">
          <PasteEditor />
        </div>
      </div>
    </main>
  );
}
