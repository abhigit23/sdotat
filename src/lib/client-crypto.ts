/**
 * Browser-side (WebCrypto) helpers used to compress + encrypt file attachments
 * before they are uploaded to Vercel Blob directly from the client.
 *
 * Constants match the server-side crypto in `src/lib/crypto.ts` (AES-256-GCM,
 * 12-byte IV, 16-byte auth tag, PBKDF2-SHA256) so the server can decrypt with
 * the same key on download. Key coordination:
 *  - Password pastes: the client derives the key via PBKDF2 (matching the
 *    server) with a client-generated salt and sends the salt to the server so
 *    it derives the identical key for text, stores it wrapped, and can
 *    re-derive it to decrypt attachments when the password is supplied.
 *  - Non-password pastes: the client generates a random key, encrypts files
 *    with it, and sends the raw key to the server, which wraps it with the
 *    master key for later unwrapping.
 */

const ALGO = "AES-GCM";
const KEY_LEN = 32; // 256-bit
const IV_LEN = 12;
const TAG_LEN = 16;
const PBKDF2_ITERATIONS = 210_000;

type Bytes = Uint8Array<ArrayBuffer>;

/**
 * Compresses a Uint8Array using the browser-native "deflate" CompressionStream.
 * Falls back to returning the input unchanged if CompressionStream is
 * unavailable, in which case compression is reported as not applied.
 */
export async function compressDeflate(
  bytes: Bytes
): Promise<{ data: Bytes; compressed: boolean }> {
  if (typeof CompressionStream === "undefined") {
    return { data: bytes, compressed: false };
  }

  const stream = new Blob([bytes]).stream().pipeThrough(
    new CompressionStream("deflate")
  );
  const buf = await new Response(stream).arrayBuffer();
  return { data: new Uint8Array(buf), compressed: true };
}

function bytesToBase64(bytes: Bytes): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}
export { bytesToBase64 };

function base64ToBytes(base64: string): Bytes {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}
export { base64ToBytes };

/**
 * Generates a fresh random 256-bit content key.
 */
export async function generateContentKey(): Promise<Bytes> {
  return crypto.getRandomValues(new Uint8Array(KEY_LEN));
}

/**
 * Derives a 256-bit content key from a password using PBKDF2 (WebCrypto),
 * matching the server's PBKDF2-SHA256 derivation and iteration count.
 * Password-protected pastes send the salt (and iteration count) to the server
 * so it can derive the same key to decrypt attachments on download.
 */
export async function deriveKeyFromPassword(
  password: string,
  salt?: Bytes,
  iterations: number = PBKDF2_ITERATIONS
): Promise<{ key: Bytes; salt: Bytes }> {
  const s = salt ?? crypto.getRandomValues(new Uint8Array(16));
  const baseKey = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(password),
    "PBKDF2",
    false,
    ["deriveBits"]
  );
  const bits = await crypto.subtle.deriveBits(
    {
      name: "PBKDF2",
      hash: "SHA-256",
      salt: s,
      iterations,
    },
    baseKey,
    KEY_LEN * 8
  );
  return { key: new Uint8Array(bits), salt: s };
}

/**
 * Encrypts plaintext with AES-256-GCM using the given content key, matching
 * the server encryption layout.
 */
export async function encryptBytes(
  contentKey: Bytes,
  plaintext: Bytes
): Promise<{ ciphertext: Bytes; iv: Bytes; authTag: Bytes }> {
  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    contentKey,
    { name: ALGO, length: KEY_LEN * 8 },
    false,
    ["encrypt"]
  );
  const iv = crypto.getRandomValues(new Uint8Array(IV_LEN));
  const ciphertext = new Uint8Array(
    await crypto.subtle.encrypt(
      { name: ALGO, iv, tagLength: TAG_LEN * 8 },
      cryptoKey,
      plaintext
    )
  );
  // WebCrypto appends the auth tag to the ciphertext; server expects them
  // split (ciphertext + separate authTag).
  const data = ciphertext.subarray(0, ciphertext.length - TAG_LEN);
  const authTag = ciphertext.subarray(ciphertext.length - TAG_LEN);
  return { ciphertext: data, iv, authTag };
}

export type EncryptedFilePayload = {
  name: string;
  mime: string;
  size: number;
  ivB64: string;
  authTagB64: string;
  compression: "deflate" | "none";
};

/**
 * Runs the full client-side prep for a single file: read bytes, deflate
 * compress, AES-GCM encrypt with the shared content key.
 */
export async function prepareFileForUpload(
  contentKey: Bytes,
  file: File
): Promise<{ bytes: Bytes; meta: EncryptedFilePayload }> {
  const raw = new Uint8Array(await file.arrayBuffer());
  const { data, compressed } = await compressDeflate(raw);
  const { ciphertext, iv, authTag } = await encryptBytes(contentKey, data);

  return {
    bytes: ciphertext,
    meta: {
      name: file.name,
      mime: file.type || "application/octet-stream",
      size: raw.length,
      ivB64: bytesToBase64(iv),
      authTagB64: bytesToBase64(authTag),
      compression: compressed ? "deflate" : "none",
    },
  };
}