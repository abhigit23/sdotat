"use client";

import { useRef, useState } from "react";
import { QrCode as QrCodeIcon, X } from "lucide-react";
import QrCode from "./qr-code";

/**
 * A "QR" button that opens the link's QR code in a modal. A native <dialog>
 * opened with showModal() sits in the browser's top layer, so it never adds
 * to the page's height, and it brings focus trapping, Esc to close and focus
 * return to this button with it.
 */
export default function QrButton({ url }: { url: string }) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  // Mounts the code (and loads the encoder) only while the dialog is open.
  const [open, setOpen] = useState(false);

  function show() {
    setOpen(true);
    dialogRef.current?.showModal();
  }

  function close() {
    dialogRef.current?.close();
  }

  return (
    <>
      <button
        type="button"
        onClick={show}
        aria-haspopup="dialog"
        title="Show a QR code to open the link on a phone"
        className="inline-flex items-center gap-1.5 rounded-md border border-zinc-300 px-3 py-1.5 text-sm font-medium transition hover:bg-zinc-50 dark:border-zinc-700 dark:hover:bg-zinc-800"
      >
        <QrCodeIcon size={14} aria-hidden />
        QR
      </button>
      <dialog
        ref={dialogRef}
        aria-labelledby="qr-dialog-title"
        onClose={() => setOpen(false)}
        // A click on the dialog element itself (not its content) is a click
        // on the backdrop: the content wrapper below fills the whole box.
        onClick={(e) => {
          if (e.target === e.currentTarget) close();
        }}
        className="m-auto max-h-[calc(100dvh-2rem)] w-[min(20rem,calc(100vw-2rem))] overflow-auto rounded-xl border border-zinc-200 bg-white p-0 text-zinc-900 shadow-xl backdrop:bg-black/50 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-100"
      >
        <div className="flex flex-col items-center gap-3 p-5 short:gap-2 short:p-3">
          <div className="flex w-full items-center justify-between">
            <h2 id="qr-dialog-title" className="text-base font-semibold">
              Scan to open
            </h2>
            <button
              type="button"
              onClick={close}
              autoFocus
              aria-label="Close"
              className="rounded-md p-1 text-zinc-500 transition hover:bg-zinc-100 hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-100"
            >
              <X size={18} aria-hidden />
            </button>
          </div>
          {open && (
            <QrCode
              text={url}
              label={`QR code linking to ${url}`}
              // Fits short and landscape screens: never taller than ~half
              // the viewport.
              className="w-[min(15rem,50dvh)] p-2"
            />
          )}
          <p
            className="w-full truncate text-center font-mono text-xs text-zinc-500 dark:text-zinc-400"
            title={url}
          >
            {url}
          </p>
        </div>
      </dialog>
    </>
  );
}
