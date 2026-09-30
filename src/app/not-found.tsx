import Link from "next/link";

export default function NotFound() {
  return (
    <div
      data-page-scroll
      className="flex min-h-0 flex-1 flex-col items-center justify-center overflow-y-auto p-6 short:p-3"
    >
      <div className="flex w-full max-w-md flex-col items-center gap-4 rounded-xl border border-zinc-200 bg-white p-6 text-center shadow-sm sm:p-8 dark:border-zinc-800 dark:bg-zinc-900">
        <h1 className="text-xl font-semibold">Paste not found</h1>
        <p className="text-sm text-zinc-500 dark:text-zinc-400">
          This paste doesn&apos;t exist, has expired, or was deleted.
        </p>
        <Link
          href="/"
          className="rounded-md bg-blue-600 px-5 py-2 text-sm font-medium text-white transition hover:bg-blue-700"
        >
          Create a new paste
        </Link>
      </div>
    </div>
  );
}
