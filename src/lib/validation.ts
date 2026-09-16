import { z } from "zod";

z.config({ jitless: true });

export const EXPIRY_OPTIONS = [
  "5min",
  "10min",
  "30min",
  "1h",
  "3h",
  "6h",
  "12h",
  "1d",
  "3d",
] as const;
export type ExpiryOption = (typeof EXPIRY_OPTIONS)[number];

export const MAX_CONTENT_BYTES = 1_000_000; // 1 MB
export const MAX_PASSWORD_LENGTH = 256;

export const MAX_FILE_BYTES = 50 * 1024 * 1024; // 50 MB per file
export const MAX_FILES_PER_PASTE = 20;
export const MAX_PASTE_TOTAL_BYTES = 100 * 1024 * 1024; // 100 MB per paste

const SAFE_FILENAME = /^[^/\\\0]+$/;

const fileEntrySchema = z.object({
  pathname: z.string().min(1).max(512),
  filename: z
    .string()
    .min(1)
    .max(255)
    .refine((v) => SAFE_FILENAME.test(v), "invalid filename"),
  mime: z.string().min(1).max(128),
  size: z.number().int().positive().max(MAX_FILE_BYTES),
  iv: z.string().min(1),
  authTag: z.string().min(1),
  compression: z.enum(["deflate", "none"]).default("deflate"),
});

export const createPasteSchema = z.object({
  content: z
    .string()
    .min(1, "content cannot be empty")
    .refine((v) => Buffer.byteLength(v, "utf8") <= MAX_CONTENT_BYTES, {
      message: `content exceeds ${MAX_CONTENT_BYTES / 1000} KB limit`,
    }),
  password: z
    .string()
    .max(MAX_PASSWORD_LENGTH, "password too long")
    .optional()
    .default(""),
  burnAfterRead: z.boolean().optional().default(false),
  expiresIn: z.enum(EXPIRY_OPTIONS).optional().default("1h"),
  // Base64 of the 32-byte content key (non-password pastes with files) so the
  // server wraps and reuses the same key the client encrypted files with.
  contentKey: z
    .string()
    .refine((v) => Buffer.from(v, "base64").length === 32, "invalid content key")
    .optional(),
  // Base64 of the 16-byte PBKDF2 salt (password pastes with files) so the
  // server derives the identical key the client used for files.
  salt: z
    .string()
    .refine((v) => Buffer.from(v, "base64").length === 16, "invalid salt")
    .optional(),
  files: z
    .array(fileEntrySchema)
    .max(MAX_FILES_PER_PASTE, `at most ${MAX_FILES_PER_PASTE} files per paste`)
    .optional()
    .default([]),
});

export const createPasteFilesSchema = z
  .array(fileEntrySchema)
  .max(MAX_FILES_PER_PASTE, `at most ${MAX_FILES_PER_PASTE} files per paste`)
  .refine(
    (files) =>
      files.reduce((sum, f) => sum + f.size, 0) <= MAX_PASTE_TOTAL_BYTES,
    { message: `total file size exceeds ${MAX_PASTE_TOTAL_BYTES / 1_000_000} MB` }
  );

export type CreatePasteInput = z.infer<typeof createPasteSchema>;

export function htmlToText(html: string): string {
  // Basic HTML-to-text for pasted rich content; never trust raw HTML at render.
  return html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|li|h[1-6]|tr)>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .trim();
}
