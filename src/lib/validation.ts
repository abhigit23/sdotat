import { z } from "zod";
import {
  MAX_CONTENT_BYTES,
  MAX_FILE_BYTES,
  MAX_FILES_PER_PASTE,
  MAX_PASTE_TOTAL_BYTES,
} from "./limits";
import { EXPIRY_VALUES } from "./expiry";

// Server-only: the browser imports limits from ./limits so Zod stays out of
// the client bundle.
export {
  MAX_CONTENT_BYTES,
  MAX_FILE_BYTES,
  MAX_FILES_PER_PASTE,
  MAX_PASTE_TOTAL_BYTES,
};

const SAFE_FILENAME = /^[^/\\\0]+$/;

const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";

/**
 * Pathname of an uploaded file: `files/<uuid>`. The client requests its upload
 * token for this path and the blob is stored at exactly it (no random suffix).
 */
export const UPLOAD_PATHNAME = new RegExp(`^files/${UUID}$`);

export const ATTACHMENT_ID = new RegExp(`^${UUID}$`);

const fileEntrySchema = z.object({
  pathname: z.string().regex(UPLOAD_PATHNAME, "invalid file path"),
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
    .refine((v) => Buffer.byteLength(v, "utf8") <= MAX_CONTENT_BYTES, {
      message: `content exceeds ${MAX_CONTENT_BYTES / 1000} KB limit`,
    })
    .optional()
    .default(""),
  burnAfterRead: z.boolean().optional().default(false),
  expiresIn: z.enum(EXPIRY_VALUES).optional().default("1h"),
  // Base64 of the 32-byte content key, sent for password-protected pastes and
  // for pastes with file attachments so the server wraps/reuses the key the
  // client generated.
  contentKey: z
    .string()
    .refine((v) => Buffer.from(v, "base64").length === 32, "invalid content key")
    .optional(),
  // Base64 of the 16-byte PBKDF2 salt (password-protected pastes). Stored as
  // metadata so the client can re-derive the key on reveal; the server never
  // derives itself.
  salt: z
    .string()
    .refine((v) => Buffer.from(v, "base64").length === 16, "invalid salt")
    .optional(),
  files: z
    .array(fileEntrySchema)
    .max(MAX_FILES_PER_PASTE, `at most ${MAX_FILES_PER_PASTE} files per paste`)
    .refine(
      (files) =>
        files.reduce((sum, f) => sum + f.size, 0) <= MAX_PASTE_TOTAL_BYTES,
      { message: `total file size exceeds ${MAX_PASTE_TOTAL_BYTES / 1_000_000} MB` }
    )
    .optional()
    .default([]),
})
  // Text is optional for files-only pastes, but a paste needs one or the other.
  .refine((p) => p.content.trim().length > 0 || p.files.length > 0, {
    message: "Add some text or attach at least one file",
    path: ["content"],
  });
