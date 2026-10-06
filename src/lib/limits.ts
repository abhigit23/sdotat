// Size limits shared by the browser and the server. Kept free of imports so
// the editor can use them without pulling Zod (validation.ts) into the bundle.

export const MAX_CONTENT_BYTES = 1_000_000; // 1 MB

export const MAX_FILE_BYTES = 50 * 1024 * 1024; // 50 MB per file
export const MAX_FILES_PER_PASTE = 20;
export const MAX_PASTE_TOTAL_BYTES = 100 * 1024 * 1024; // 100 MB per paste
