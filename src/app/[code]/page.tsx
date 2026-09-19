import { notFound } from "next/navigation";
import Link from "next/link";
import type { Metadata } from "next";
import { ArrowLeft } from "lucide-react";
import {
  getPasteByCode,
  deletePaste,
  deleteAttachmentsBlobs,
} from "@/lib/paste-service";
import PasswordGate from "@/components/password-gate";
import PasteReveal from "@/components/paste-reveal";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  robots: { index: false, follow: false },
};

function Card({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center px-4 py-8 sm:px-6">
      <div className="w-full max-w-3xl">{children}</div>
    </div>
  );
}

export default async function PastePage({
  params,
}: {
  params: Promise<{ code: string }>;
}) {
  const { code } = await params;

  const paste = await getPasteByCode(code);
  if (!paste) notFound();

  if (paste.expiresAt && paste.expiresAt.getTime() < Date.now()) {
    await deleteAttachmentsBlobs(code);
    await deletePaste(code);
    notFound();
  }

  if (paste.burnAfterRead && paste.consumed) {
    return (
      <Card>
        <div className="rounded-xl border border-zinc-200 bg-white p-6 text-center shadow-sm sm:p-8 dark:border-zinc-800 dark:bg-zinc-900">
          <h1 className="text-xl font-semibold">This paste has been burned</h1>
          <p className="mt-2 text-sm text-zinc-500 dark:text-zinc-400">
            It was already viewed and permanently deleted.
          </p>
        </div>
      </Card>
    );
  }

  return (
    <Card>
      <div className="mb-4 flex items-center justify-between pr-12 lg:pr-0">
        <Link
          href="/"
          className="inline-flex items-center gap-1.5 text-sm font-medium text-blue-600 hover:underline"
        >
          <ArrowLeft size={16} aria-hidden />
          New paste
        </Link>
        <span className="font-mono text-sm text-zinc-500">/{code}</span>
      </div>
      {paste.salt ? (
        <PasswordGate code={code} />
      ) : (
        <PasteReveal code={code} burnAfterRead={paste.burnAfterRead} />
      )}
    </Card>
  );
}
