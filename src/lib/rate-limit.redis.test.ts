/**
 * Tests the Redis Lua scripts behind the quotas and password lockout against
 * a real Redis, through Upstash's REST protocol (serverless-redis-http). CI
 * runs both as service containers; locally these are skipped unless
 * TEST_KV_REST_API_URL and TEST_KV_REST_API_TOKEN point at such a setup.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";

const url = process.env.TEST_KV_REST_API_URL;
const token = process.env.TEST_KV_REST_API_TOKEN;

import type { ClientRequest } from "./rate-limit";

type RateLimit = typeof import("./rate-limit");
let rl: RateLimit;

/** A request from its own IP, so each test gets fresh per-IP counters. */
function fromNewIp(): ClientRequest {
  return { headers: new Headers({ "x-test-ip": randomUUID() }) };
}

const MB = 1024 * 1024;

describe.skipIf(!url || !token)("rate-limit Redis scripts", () => {
  beforeAll(async () => {
    // rate-limit reads these once at import.
    process.env.KV_REST_API_URL = url;
    process.env.KV_REST_API_TOKEN = token;
    process.env.TRUSTED_IP_HEADER = "x-test-ip";
    rl = await import("./rate-limit");
  });

  describe("text quota", () => {
    it("reserves up to the per-IP quota and refunds on release", async () => {
      const req = fromNewIp();
      expect(await rl.reserveTextBytes(req, 15 * MB)).toBe(true);
      // 15 + 10 MB is over the 20 MB per-IP quota: nothing is reserved.
      expect(await rl.reserveTextBytes(req, 10 * MB)).toBe(false);
      expect(await rl.reserveTextBytes(req, 5 * MB)).toBe(true);
      expect(await rl.reserveTextBytes(req, 1)).toBe(false);
      await rl.releaseTextBytes(req, 5 * MB);
      expect(await rl.reserveTextBytes(req, 5 * MB)).toBe(true);
    });

    it("counts each IP separately", async () => {
      expect(await rl.reserveTextBytes(fromNewIp(), 19 * MB)).toBe(true);
      expect(await rl.reserveTextBytes(fromNewIp(), 19 * MB)).toBe(true);
    });
  });

  describe("upload claims", () => {
    it("records the declared size once per pathname", async () => {
      const req = fromNewIp();
      const path = `files/${randomUUID()}`;
      expect(await rl.claimUpload(req, path, 1234)).toBe("ok");
      expect(await rl.claimUpload(req, path, 99)).toBe("taken");
      const other = `files/${randomUUID()}`;
      expect(await rl.getUploadSizes([path, other])).toEqual([1234, null]);
    });

    it("refuses uploads past the daily quota", async () => {
      const req = fromNewIp();
      expect(await rl.claimUpload(req, `files/${randomUUID()}`, 200 * MB)).toBe("ok");
      expect(await rl.claimUpload(req, `files/${randomUUID()}`, 150 * MB)).toBe("quota");
      expect(await rl.claimUpload(req, `files/${randomUUID()}`, 50 * MB)).toBe("ok");
    });
  });

  describe("password attempts", () => {
    it("locks an IP after 10 failures, and a refund frees a slot", async () => {
      const code = randomUUID().slice(0, 6);
      const req = fromNewIp();
      for (let i = 0; i < 10; i++) {
        expect(await rl.beginPasswordAttempt(code, req)).toBe(true);
      }
      expect(await rl.beginPasswordAttempt(code, req)).toBe(false);
      await rl.refundPasswordAttempt(code, req);
      expect(await rl.beginPasswordAttempt(code, req)).toBe(true);
      expect(await rl.beginPasswordAttempt(code, req)).toBe(false);
    });

    it("lets exactly 10 of 30 concurrent guesses through", async () => {
      const code = randomUUID().slice(0, 6);
      const req = fromNewIp();
      const results = await Promise.all(
        Array.from({ length: 30 }, () => rl.beginPasswordAttempt(code, req))
      );
      expect(results.filter(Boolean)).toHaveLength(10);
    });

    it("locks the paste for everyone after 50 failures across IPs", async () => {
      const code = randomUUID().slice(0, 6);
      for (let ip = 0; ip < 5; ip++) {
        const req = fromNewIp();
        for (let i = 0; i < 10; i++) await rl.beginPasswordAttempt(code, req);
      }
      expect(await rl.beginPasswordAttempt(code, fromNewIp())).toBe(false);
      // Other pastes are unaffected.
      expect(await rl.beginPasswordAttempt(`${code}x`, fromNewIp())).toBe(true);
    });
  });
});
