import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
  createHash,
} from "node:crypto";

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
 * Wraps a random content key with the master key so it can be stored at rest.
 * Output layout: [iv, authTag, encryptedKey] (self-contained).
 */
export function wrapKey(contentKey: Buffer): Buffer {
  const key = getMasterKey();
  const iv = randomBytes(IV_LEN);
  const cipher = createCipheriv(ALGO, key, iv);
  const encrypted = Buffer.concat([cipher.update(contentKey), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, encrypted]);
}

/**
 * Unwraps a content key produced by wrapKey().
 */
export function unwrapKey(wrapped: Buffer): Buffer {
  const key = getMasterKey();
  if (wrapped.length < IV_LEN + TAG_LEN) {
    throw new Error("Invalid wrapped key");
  }
  const iv = wrapped.subarray(0, IV_LEN);
  const tag = wrapped.subarray(IV_LEN, IV_LEN + TAG_LEN);
  const data = wrapped.subarray(IV_LEN + TAG_LEN);
  const decipher = createDecipheriv(ALGO, key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(data), decipher.final()]);
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
