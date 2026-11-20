import { describe, expect, it } from "vitest";
import { randomBytes, randomUUID } from "node:crypto";
import { contentKeySchema, createPasteSchema } from "./validation";

const b64 = (n: number) => randomBytes(n).toString("base64");

function file(overrides: Record<string, unknown> = {}) {
  return {
    pathname: `files/${randomUUID()}`,
    filename: "a.txt",
    mime: "text/plain",
    size: 10,
    iv: b64(12),
    authTag: b64(16),
    ...overrides,
  };
}

describe("contentKeySchema", () => {
  it("accepts exactly 32 bytes of padded base64", () => {
    expect(contentKeySchema.safeParse(b64(32)).success).toBe(true);
  });

  it.each([
    ["too short", b64(31)],
    ["too long", b64(33)],
    ["junk that still decodes to 32 bytes", `${b64(32)}!!!!`],
    ["invalid characters", `${b64(32).slice(0, 40)}$$$=`],
    ["unpadded", b64(32).replace(/=+$/, "")],
  ])("rejects %s", (_label, value) => {
    expect(contentKeySchema.safeParse(value).success).toBe(false);
  });
});

describe("createPasteSchema", () => {
  it("applies defaults", () => {
    const parsed = createPasteSchema.parse({ content: "hi" });
    expect(parsed).toMatchObject({
      burnAfterRead: false,
      expiresIn: "1h",
      files: [],
    });
  });

  it("requires text or a file", () => {
    expect(createPasteSchema.safeParse({ content: "   " }).success).toBe(false);
    expect(createPasteSchema.safeParse({ files: [file()] }).success).toBe(true);
  });

  it("rejects unknown expiry values", () => {
    const r = createPasteSchema.safeParse({ content: "x", expiresIn: "1y" });
    expect(r.success).toBe(false);
  });

  it("rejects content over 1 MB", () => {
    const r = createPasteSchema.safeParse({ content: "x".repeat(1_000_001) });
    expect(r.success).toBe(false);
  });

  it("validates file entries", () => {
    const bad = [
      file({ pathname: "files/../etc" }),
      file({ filename: "a/b" }),
      file({ iv: b64(16) }),
      file({ authTag: `${b64(16)}AAAA` }),
      file({ size: 0 }),
    ];
    for (const f of bad) {
      expect(createPasteSchema.safeParse({ files: [f] }).success).toBe(false);
    }
  });

  it("caps file count and total size", () => {
    const many = Array.from({ length: 21 }, () => file());
    expect(createPasteSchema.safeParse({ files: many }).success).toBe(false);
    const big = Array.from({ length: 3 }, () => file({ size: 40 * 1024 * 1024 }));
    expect(createPasteSchema.safeParse({ files: big }).success).toBe(false);
  });

  it("validates salt length", () => {
    const base = { content: "x", contentKey: b64(32) };
    expect(createPasteSchema.safeParse({ ...base, salt: b64(16) }).success).toBe(true);
    expect(createPasteSchema.safeParse({ ...base, salt: b64(8) }).success).toBe(false);
  });
});
