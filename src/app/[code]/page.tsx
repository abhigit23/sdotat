import { notFound } from "next/navigation";
import Link from "next/link";
import type { Metadata } from "next";
import { after } from "next/server";
import { ArrowLeft } from "lucide-react";
import {
  getPasteGateByCode,
  deletePaste,
  deleteAttachmentsBlobs,
} from "@/lib/paste-service";
import { isValidCode } from "@/lib/ids";
import PasswordGate from "@/components/password-gate";
import PasteReveal from "@/components/paste-reveal";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  robots: { index: false, follow: false },
};

function Shell({
  header,
  children,
}: {
  header?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    // This root is the one last-resort scroller (see the home page).
    <div
      data-page-scroll
      className="flex min-h-0 flex-1 flex-col overflow-y-auto px-4 py-4 sm:px-6 short:py-2 tiny:py-1"
    >
      {header}
      {/* Centered while small (auto margins). When tall, min-h-0 lets the
          content shrink to fit and its text area scrolls inside itself. */}
      <div className="flex min-h-0 flex-1 flex-col">
        <div className="mx-auto my-auto flex min-h-0 w-full max-w-3xl flex-col">
          {children}
        </div>
      </div>
    </div>
  );
}

export default async function PastePage({
  params,
}: {
  params: Promise<{ code: string }>;
}) {
  const { code } = await params;

  const paste = isValidCode(code) ? await getPasteGateByCode(code) : null;
  if (!paste) notFound();

  if (paste.expiresAt && paste.expiresAt.getTime() < Date.now()) {
    after(async () => {
      await deleteAttachmentsBlobs(code);
      await deletePaste(code);
    });
    notFound();
  }

  if (paste.burnAfterRead && paste.consumed) {
    return (
      <Shell>
        <div className="rounded-xl border border-zinc-200 bg-white p-6 text-center shadow-sm sm:p-8 dark:border-zinc-800 dark:bg-zinc-900">
          <h1 className="text-xl font-semibold">This paste has been burned</h1>
          <p className="mt-2 text-sm text-zinc-500 dark:text-zinc-400">
            It was already viewed and permanently deleted.
          </p>
        </div>
      </Shell>
    );
  }

  return (
    <Shell
      header={
        <div className="mb-3 flex shrink-0 items-center justify-between pr-12 short:mb-1 tiny:mb-0">
          <Link
            href="/"
            className="inline-flex items-center gap-1.5 text-sm font-medium text-blue-600 hover:underline"
          >
            <ArrowLeft size={16} aria-hidden />
            New paste
          </Link>
          <span className="font-mono text-sm text-zinc-500">/{code}</span>
        </div>
      }
    >
      {paste.salt ? (
        <PasswordGate
          code={code}
          salt={Buffer.from(paste.salt).toString("base64")}
        />
      ) : (
        <PasteReveal code={code} burnAfterRead={paste.burnAfterRead} />
      )}
    </Shell>
  );
}
