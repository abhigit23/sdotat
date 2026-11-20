import { describe, expect, it } from "vitest";
import { Buffer } from "node:buffer";
import {
  decryptContent,
  decryptPasteText,
  encryptContent,
  encryptPasteText,
  generateContentKey,
  generateDeleteToken,
  hashDeleteToken,
  openAttachmentMeta,
  sealAttachmentMeta,
  unwrapKey,
  wrapKey,
} from "./crypto";
import {
  base64ToBytes,
  bytesToBase64,
  decryptFile,
  deriveKeyFromPassword,
  prepareFileForUpload,
} from "./client-crypto";

describe("server crypto", () => {
  it("wraps and unwraps a content key", () => {
    const key = generateContentKey();
    const wrapped = wrapKey(key);
    expect(wrapped.equals(key)).toBe(false);
    expect(unwrapKey(wrapped).equals(key)).toBe(true);
  });

  it("rejects a tampered wrapped key", () => {
    const wrapped = wrapKey(generateContentKey());
    wrapped[wrapped.length - 1] ^= 1;
    expect(() => unwrapKey(wrapped)).toThrow();
  });

  it("round-trips paste text, compressing when it helps", () => {
    const key = generateContentKey();
    const text = "hello ".repeat(1000);
    const enc = encryptPasteText(key, text);
    expect(enc.compression).toBe("deflate");
    expect(enc.ciphertext.length).toBeLessThan(text.length);
    expect(decryptPasteText(key, enc)).toBe(text);
  });

  it("stores short incompressible text as-is", () => {
    const key = generateContentKey();
    const enc = encryptPasteText(key, "a");
    expect(enc.compression).toBe("none");
    expect(decryptPasteText(key, enc)).toBe("a");
  });

  it("fails to decrypt with the wrong key or a bad tag", () => {
    const key = generateContentKey();
    const enc = encryptPasteText(key, "secret");
    expect(() => decryptPasteText(generateContentKey(), enc)).toThrow();
    const badTag = Buffer.from(enc.authTag);
    badTag[0] ^= 1;
    expect(() => decryptPasteText(key, { ...enc, authTag: badTag })).toThrow();
  });

  it("seals attachment metadata", () => {
    const key = generateContentKey();
    const meta = { filename: "résumé.pdf", mime: "application/pdf" };
    const sealed = sealAttachmentMeta(key, meta);
    expect(sealed.includes(Buffer.from("pdf"))).toBe(false);
    expect(openAttachmentMeta(key, { meta: sealed })).toEqual(meta);
  });

  it("hashes delete tokens deterministically", () => {
    const { token, hash } = generateDeleteToken();
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(hashDeleteToken(token).equals(hash)).toBe(true);
  });
});

describe("browser <-> server interop", () => {
  it("server decrypts a file the browser encrypted", async () => {
    const key = crypto.getRandomValues(new Uint8Array(32));
    const content = new TextEncoder().encode("file body ".repeat(500));
    const file = new File([content], "a.txt", { type: "text/plain" });
    const { bytes, meta } = await prepareFileForUpload(key, file);
    expect(meta.compression).toBe("deflate");

    const plain = decryptContent(Buffer.from(key), {
      ciphertext: Buffer.from(bytes),
      iv: Buffer.from(base64ToBytes(meta.ivB64)),
      authTag: Buffer.from(base64ToBytes(meta.authTagB64)),
    });
    const { inflateSync } = await import("node:zlib");
    expect(Buffer.from(inflateSync(plain)).equals(Buffer.from(content))).toBe(true);
  });

  it("browser decrypts what the server encrypted", async () => {
    const key = generateContentKey();
    const data = Buffer.from("downloaded bytes");
    const enc = encryptContent(key, data);
    // decryptFile expects TAG_LEN spare bytes after the ciphertext.
    const sealed = new Uint8Array(enc.ciphertext.length + 16);
    sealed.set(enc.ciphertext);
    const out = await decryptFile(new Uint8Array(key), sealed, {
      ivB64: enc.iv.toString("base64"),
      authTagB64: enc.authTag.toString("base64"),
      compression: "none",
      size: data.length,
    });
    expect(Buffer.from(out).equals(data)).toBe(true);
  });

  it("derives the same key from the same password and salt", async () => {
    const a = await deriveKeyFromPassword("correct horse");
    const b = await deriveKeyFromPassword("correct horse", a.salt);
    const c = await deriveKeyFromPassword("wrong horse", a.salt);
    expect(bytesToBase64(a.key)).toBe(bytesToBase64(b.key));
    expect(bytesToBase64(a.key)).not.toBe(bytesToBase64(c.key));
    expect(bytesToBase64(a.key)).toHaveLength(44);
  });
});
