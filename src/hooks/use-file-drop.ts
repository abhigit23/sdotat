"use client";

import { useEffect, useState } from "react";

function isFileDrag(dataTransfer: DataTransfer | null | undefined): boolean {
  return !!dataTransfer && Array.from(dataTransfer.types).includes("Files");
}

/**
 * Accepts files dragged anywhere onto the page or pasted from the clipboard,
 * passing them to `onFiles`. Returns whether a file drag is over the page.
 * `onFiles` should be stable (useCallback): the listeners are re-attached
 * whenever it changes.
 */
export function useFileDrop(onFiles: (files: File[]) => void): boolean {
  const [isDragging, setIsDragging] = useState(false);

  useEffect(() => {
    // Depth counter avoids flicker as the pointer moves between nested nodes.
    let dragDepth = 0;

    function onDragEnter(e: DragEvent) {
      if (!isFileDrag(e.dataTransfer)) return;
      dragDepth += 1;
      setIsDragging(true);
    }

    function onDragOver(e: DragEvent) {
      // Swallows the browser's default of navigating to a dropped file even
      // when it lands outside the form.
      if (isFileDrag(e.dataTransfer)) e.preventDefault();
    }

    function onDragLeave(e: DragEvent) {
      if (!isFileDrag(e.dataTransfer)) return;
      dragDepth = Math.max(0, dragDepth - 1);
      if (dragDepth === 0) setIsDragging(false);
    }

    function onDrop(e: DragEvent) {
      dragDepth = 0;
      setIsDragging(false);
      if (!e.dataTransfer || e.dataTransfer.files.length === 0) return;
      e.preventDefault();
      onFiles(Array.from(e.dataTransfer.files));
    }

    function onPaste(e: ClipboardEvent) {
      const items = e.clipboardData?.items;
      if (!items || items.length === 0) return;
      const pasted: File[] = [];
      for (const item of items) {
        if (item.kind === "file") {
          const f = item.getAsFile();
          if (f) pasted.push(f);
        }
      }
      if (pasted.length === 0) return;
      e.preventDefault();
      onFiles(pasted);
    }

    document.addEventListener("dragenter", onDragEnter);
    document.addEventListener("dragover", onDragOver);
    document.addEventListener("dragleave", onDragLeave);
    document.addEventListener("drop", onDrop);
    document.addEventListener("paste", onPaste);
    return () => {
      document.removeEventListener("dragenter", onDragEnter);
      document.removeEventListener("dragover", onDragOver);
      document.removeEventListener("dragleave", onDragLeave);
      document.removeEventListener("drop", onDrop);
      document.removeEventListener("paste", onPaste);
    };
  }, [onFiles]);

  return isDragging;
}
