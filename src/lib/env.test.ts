import { afterEach, describe, expect, it, vi } from "vitest";
import { assertServerEnv, checkEnv } from "./env";

const good = {
  POSTGRES_URL: "postgres://x",
  PASTE_MASTER_KEY: "a".repeat(64),
  APP_URL: "https://example.com",
  CRON_SECRET: "s",
  BLOB_READ_WRITE_TOKEN: "t",
};

afterEach(() => vi.restoreAllMocks());

describe("checkEnv", () => {
  it("passes a complete environment", () => {
    expect(checkEnv(good)).toEqual({ errors: [], warnings: [] });
  });

  it("reports missing required and recommended variables", () => {
    const { errors, warnings } = checkEnv({});
    expect(errors).toHaveLength(2);
    expect(warnings).toHaveLength(3);
  });

  it("warns when rate limiting has no trusted client IP", () => {
    const kv = { ...good, KV_REST_API_URL: "https://kv" };
    expect(checkEnv(kv).warnings[0]).toMatch(/TRUSTED_IP_HEADER/);
    expect(checkEnv({ ...kv, VERCEL: "1" }).warnings).toEqual([]);
    expect(checkEnv({ ...kv, TRUSTED_IP_HEADER: "cf-connecting-ip" }).warnings).toEqual([]);
  });

  it("warns (not errors) on a short master key", () => {
    const { errors, warnings } = checkEnv({ ...good, PASTE_MASTER_KEY: "short" });
    expect(errors).toEqual([]);
    expect(warnings[0]).toMatch(/PASTE_MASTER_KEY/);
  });
});

describe("assertServerEnv", () => {
  it("throws in production when required variables are missing", () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(() => assertServerEnv({ NODE_ENV: "production" })).toThrow(/POSTGRES_URL/);
  });

  it("only logs outside production", () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(() => assertServerEnv({ NODE_ENV: "development" })).not.toThrow();
    expect(error).toHaveBeenCalledOnce();
  });
});
