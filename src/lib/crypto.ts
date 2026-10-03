import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
  createHash,
} from "node:crypto";
import { deflateSync, inflateSync } from "node:zlib";
import { MAX_CONTENT_BYTES } from "./validation";

const ALGO = "aes-256-gcm";
const KEY_LEN = 32; // 256-bit
const IV_LEN = 12;
const TAG_LEN = 16;

function getMasterKey(): Buffer {
  const raw = process.env.PASTE_MASTER_KEY;
  if (!raw) {
    throw new Error("PASTE_MASTER_KEY is not set");
  }
  return createHash("sha256").update(raw).digest();
}

export type EncryptedPayload = {
  ciphertext: Buffer;
  iv: Buffer;
  authTag: Buffer;
};

/**
 * Encrypts `plaintext` into a self-contained buffer laid out as
 * [iv, authTag, ciphertext].
 */
function seal(key: Buffer, plaintext: Buffer): Buffer {
  const iv = randomBytes(IV_LEN);
  const cipher = createCipheriv(ALGO, key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), encrypted]);
}

/**
 * Decrypts a buffer produced by seal(). Throws on auth failure.
 */
function open(key: Buffer, sealed: Buffer): Buffer {
  if (sealed.length < IV_LEN + TAG_LEN) {
    throw new Error("Invalid sealed payload");
  }
  const iv = sealed.subarray(0, IV_LEN);
  const tag = sealed.subarray(IV_LEN, IV_LEN + TAG_LEN);
  const data = sealed.subarray(IV_LEN + TAG_LEN);
  const decipher = createDecipheriv(ALGO, key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(data), decipher.final()]);
}

/**
 * Wraps a random content key with the master key so it can be stored at rest.
 */
export function wrapKey(contentKey: Buffer): Buffer {
  return seal(getMasterKey(), contentKey);
}

/**
 * Unwraps a content key produced by wrapKey().
 */
export function unwrapKey(wrapped: Buffer): Buffer {
  return open(getMasterKey(), wrapped);
}

export type AttachmentMeta = { filename: string; mime: string };

/**
 * Encrypts an attachment's filename and MIME type with the paste's content
 * key so they aren't readable from the database alone.
 */
export function sealAttachmentMeta(
  contentKey: Buffer,
  meta: AttachmentMeta
): Buffer {
  return seal(contentKey, Buffer.from(JSON.stringify(meta), "utf8"));
}

/**
 * Decrypts an attachment's filename and MIME type from its `meta` column.
 */
export function openAttachmentMeta(
  contentKey: Buffer,
  row: { meta: Buffer }
): AttachmentMeta {
  return JSON.parse(
    open(contentKey, Buffer.from(row.meta)).toString("utf8")
  ) as AttachmentMeta;
}

export type PasteCompression = "deflate" | "none";

/**
 * Deflates paste text (when that makes it smaller) and encrypts it.
 */
export function encryptPasteText(
  contentKey: Buffer,
  text: string
): EncryptedPayload & { compression: PasteCompression } {
  const raw = Buffer.from(text, "utf8");
  const deflated = deflateSync(raw);
  const useDeflate = deflated.length < raw.length;
  return {
    ...encryptContent(contentKey, useDeflate ? deflated : raw),
    compression: useDeflate ? "deflate" : "none",
  };
}

/**
 * Decrypts paste text produced by encryptPasteText(). Throws on auth failure.
 */
export function decryptPasteText(
  contentKey: Buffer,
  payload: EncryptedPayload & { compression: string }
): string {
  const data = decryptContent(contentKey, payload);
  const raw =
    payload.compression === "deflate"
      ? inflateSync(data, { maxOutputLength: MAX_CONTENT_BYTES })
      : data;
  return raw.toString("utf8");
}

/**
 * Creates a one-time delete token for a new paste. Only the hash is stored, so
 * a database leak doesn't hand out delete links.
 */
export function generateDeleteToken(): { token: string; hash: Buffer } {
  const token = randomBytes(32).toString("base64url");
  return { token, hash: hashDeleteToken(token) };
}

export function hashDeleteToken(token: string): Buffer {
  return createHash("sha256").update(token).digest();
}

/**
 * Generates a fresh random 256-bit content key.
 */
export function generateContentKey(): Buffer {
  return randomBytes(KEY_LEN);
}

/**
 * Encrypts plaintext with AES-256-GCM using the given content key.
 */
export function encryptContent(
  contentKey: Buffer,
  plaintext: Buffer
): EncryptedPayload {
  const iv = randomBytes(IV_LEN);
  const cipher = createCipheriv(ALGO, contentKey, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  return { ciphertext, iv, authTag: cipher.getAuthTag() };
}

/**
 * Decrypts ciphertext produced by encryptContent(). Throws on auth failure.
 */
export function decryptContent(
  contentKey: Buffer,
  payload: EncryptedPayload
): Buffer {
  const decipher = createDecipheriv(ALGO, contentKey, payload.iv);
  decipher.setAuthTag(payload.authTag);
  return Buffer.concat([decipher.update(payload.ciphertext), decipher.final()]);
}
