import { Ratelimit } from "@upstash/ratelimit";
import { Redis } from "@upstash/redis";
import type { NextRequest } from "next/server";
import { createHash, createHmac } from "node:crypto";

const UPS_ENABLED =
  !!process.env.KV_REST_API_URL && !!process.env.KV_REST_API_TOKEN;

if (!UPS_ENABLED && process.env.NODE_ENV === "production") {
  console.warn(
    "Rate limiting is disabled: KV_REST_API_URL / KV_REST_API_TOKEN are not set"
  );
}

let createLimiter: Ratelimit | null = null;
let readLimiter: Ratelimit | null = null;
let uploadLimiter: Ratelimit | null = null;
let redis: Redis | null = null;

function getRedis(): Redis | null {
  if (!UPS_ENABLED) return null;
  if (!redis) redis = Redis.fromEnv();
  return redis;
}

function getCreateLimiter(): Ratelimit | null {
  if (!UPS_ENABLED) return null;
  if (!createLimiter) {
    createLimiter = new Ratelimit({
      redis: Redis.fromEnv(),
      limiter: Ratelimit.slidingWindow(20, "10 s"),
      prefix: "rl:create",
      analytics: false,
    });
  }
  return createLimiter;
}

function getReadLimiter(): Ratelimit | null {
  if (!UPS_ENABLED) return null;
  if (!readLimiter) {
    readLimiter = new Ratelimit({
      redis: Redis.fromEnv(),
      limiter: Ratelimit.slidingWindow(60, "60 s"),
      prefix: "rl:read",
      analytics: false,
    });
  }
  return readLimiter;
}

let ipHashKey: Buffer | null = null;

/**
 * Resolves a stable identifier from an incoming request: an HMAC of the client
 * IP, so raw IPs are never sent to or stored in Redis. Keyed by a value derived
 * from the master key, so the hashes can't be reversed by hashing every IP.
 * Falls back to a constant when headers are unavailable (unlikely in practice).
 */
export function clientId(req: NextRequest): string {
  const ip =
    req.headers.get("x-real-ip") ??
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    "unknown";
  ipHashKey ??= createHash("sha256")
    .update(`ip-hash:${process.env.PASTE_MASTER_KEY ?? ""}`)
    .digest();
  return createHmac("sha256", ipHashKey)
    .update(ip)
    .digest("base64url")
    .slice(0, 22);
}

export type RateLimitResult = {
  success: boolean;
  limit: number;
  remaining: number;
};

const ALLOW: RateLimitResult = { success: true, limit: Infinity, remaining: Infinity };

/**
 * Enforces the creation rate limit. Returns a result plus whether limiting is
 * active (false means the service isn't configured, so allow everything).
 */
export async function checkCreateLimit(
  req: NextRequest
): Promise<{ result: RateLimitResult; active: boolean }> {
  const limiter = getCreateLimiter();
  if (!limiter) return { result: ALLOW, active: false };
  const { success, limit, remaining } = await limiter.limit(clientId(req));
  return { result: { success, limit, remaining }, active: true };
}

/**
 * Enforces the read rate limit.
 */
export async function checkReadLimit(
  req: NextRequest
): Promise<{ result: RateLimitResult; active: boolean }> {
  const limiter = getReadLimiter();
  if (!limiter) return { result: ALLOW, active: false };
  const { success, limit, remaining } = await limiter.limit(clientId(req));
  return { result: { success, limit, remaining }, active: true };
}

function getUploadLimiter(): Ratelimit | null {
  const r = getRedis();
  if (!r) return null;
  if (!uploadLimiter) {
    // One token per file: a full paste (20 files) fits, scripted floods don't.
    uploadLimiter = new Ratelimit({
      redis: r,
      limiter: Ratelimit.slidingWindow(30, "10 m"),
      prefix: "rl:upload",
      analytics: false,
    });
  }
  return uploadLimiter;
}

/**
 * Enforces the upload-token rate limit (one token per uploaded file).
 */
export async function checkUploadLimit(
  req: NextRequest
): Promise<{ result: RateLimitResult; active: boolean }> {
  const limiter = getUploadLimiter();
  if (!limiter) return { result: ALLOW, active: false };
  const { success, limit, remaining } = await limiter.limit(clientId(req));
  return { result: { success, limit, remaining }, active: true };
}

/**
 * Failed password attempts allowed per paste, from any IP, before it locks for
 * the rest of the window. Bounds online guessing even when an attacker spreads
 * guesses across many IPs.
 */
const MAX_PASSWORD_FAILURES = 10;
const PASSWORD_WINDOW_SECONDS = 60 * 60;

/** Shown when a paste is locked; deliberately gives no count or timing. */
export const PASSWORD_LOCKED_MESSAGE = "Too many attempts. Try again later.";

/**
 * True if the paste has had too many failed password attempts in the current
 * window. Always false when Redis isn't configured.
 */
export async function isPasswordLocked(code: string): Promise<boolean> {
  const r = getRedis();
  if (!r) return false;
  const failures = await r.get<number>(`pw:${code}`);
  return (failures ?? 0) >= MAX_PASSWORD_FAILURES;
}

/**
 * Counts a failed password attempt against the paste. The window starts at
 * the first failure.
 */
export async function recordPasswordFailure(code: string): Promise<void> {
  const r = getRedis();
  if (!r) return;
  const key = `pw:${code}`;
  const failures = await r.incr(key);
  if (failures === 1) await r.expire(key, PASSWORD_WINDOW_SECONDS);
}

/** Bytes one IP may reserve for uploads per UTC day. */
export const DAILY_UPLOAD_QUOTA_BYTES = 300 * 1024 * 1024;

/**
 * Reserves `bytes` against the IP's daily upload quota. Returns false (and
 * reserves nothing) if that would exceed the quota. Bytes stay counted even if
 * the upload later fails, which errs on the side of the store. Always allows
 * when Redis isn't configured.
 */
export async function reserveUploadBytes(
  req: NextRequest,
  bytes: number
): Promise<boolean> {
  const r = getRedis();
  if (!r) return true;
  const day = new Date().toISOString().slice(0, 10);
  const key = `uq:${clientId(req)}:${day}`;
  const total = await r.incrby(key, bytes);
  if (total === bytes) await r.expire(key, 2 * 24 * 60 * 60);
  if (total > DAILY_UPLOAD_QUOTA_BYTES) {
    await r.decrby(key, bytes);
    return false;
  }
  return true;
}

/**
 * How long a declared upload size is kept: comfortably longer than an upload
 * token stays valid (1 h), so a slow upload's size is still there at create.
 */
const UPLOAD_SIZE_TTL_SECONDS = 3 * 60 * 60;

/**
 * Records the size a client declared for an upload token. Blob rejects any
 * upload larger than this, so it's a trusted upper bound on the stored blob,
 * and lets paste creation skip a slow Blob lookup per file. `pathname` is the
 * token's pathname (`files/<uuid>`), which is also where the blob is stored.
 *
 * Each pathname can be claimed once (returns false if already taken): a second
 * token for the same pathname could otherwise overwrite the size recorded for
 * a larger blob already uploaded under it. Clients use a fresh UUID per file,
 * so this never affects real uploads. Always succeeds without Redis.
 */
export async function claimUploadSize(
  pathname: string,
  bytes: number
): Promise<boolean> {
  const r = getRedis();
  if (!r) return true;
  const res = await r.set(`upsz:${pathname}`, bytes, {
    nx: true,
    ex: UPLOAD_SIZE_TTL_SECONDS,
  });
  return res === "OK";
}

/**
 * Declared sizes for the given token pathnames, in one Redis round trip;
 * null entries were never recorded or have expired. Returns null when Redis
 * isn't configured.
 */
export async function getUploadSizes(
  pathnames: string[]
): Promise<(number | null)[] | null> {
  const r = getRedis();
  if (!r || pathnames.length === 0) return r ? [] : null;
  return r.mget<(number | null)[]>(...pathnames.map((p) => `upsz:${p}`));
}
