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
  const r = getRedis();
  if (!r) return null;
  if (!createLimiter) {
    createLimiter = new Ratelimit({
      redis: r,
      limiter: Ratelimit.slidingWindow(10, "60 s"),
      prefix: "rl:create",
      analytics: false,
    });
  }
  return createLimiter;
}

function getReadLimiter(): Ratelimit | null {
  const r = getRedis();
  if (!r) return null;
  if (!readLimiter) {
    readLimiter = new Ratelimit({
      redis: r,
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
 * Failed password attempts allowed per paste from one IP before the paste
 * locks for that IP for the rest of the window. Someone guessing can't lock
 * out the real recipient, who is on a different IP.
 */
const MAX_PASSWORD_FAILURES_PER_IP = 10;
/**
 * Failed attempts allowed per paste across all IPs before it locks for
 * everyone. Bounds online guessing when an attacker spreads guesses across
 * many IPs.
 */
const MAX_PASSWORD_FAILURES = 50;
const PASSWORD_WINDOW_SECONDS = 60 * 60;

/** Shown when a paste is locked; deliberately gives no count or timing. */
export const PASSWORD_LOCKED_MESSAGE = "Too many attempts. Try again later.";

function passwordFailureKeys(code: string, req: NextRequest): [string, string] {
  return [`pw:${code}:${clientId(req)}`, `pw:${code}`];
}

/**
 * True if the paste has had too many failed password attempts in the current
 * window, from this IP or from all IPs together. Always false when Redis isn't
 * configured.
 */
export async function isPasswordLocked(
  code: string,
  req: NextRequest
): Promise<boolean> {
  const r = getRedis();
  if (!r) return false;
  const [fromIp, total] = await r.mget<(number | null)[]>(
    ...passwordFailureKeys(code, req)
  );
  return (
    (fromIp ?? 0) >= MAX_PASSWORD_FAILURES_PER_IP ||
    (total ?? 0) >= MAX_PASSWORD_FAILURES
  );
}

/**
 * Counts a failed password attempt against the paste, for this IP and in
 * total. Each window starts at its first failure.
 */
export async function recordPasswordFailure(
  code: string,
  req: NextRequest
): Promise<void> {
  const r = getRedis();
  if (!r) return;
  // One round trip: INCR each key, starting its expiry on the first failure.
  await r.eval(
    "for _, key in ipairs(KEYS) do if redis.call('INCR', key) == 1 then redis.call('EXPIRE', key, ARGV[1]) end end return 1",
    passwordFailureKeys(code, req),
    [PASSWORD_WINDOW_SECONDS]
  );
}

/**
 * Atomically reserves bytes against a per-IP and a global daily counter, in
 * one round trip. With a third key, first records the declared upload size
 * there (once per key; see claimUpload).
 *
 * KEYS: IP counter, global counter, [size record]
 * ARGV: bytes, IP max, global max, counter TTL, [size record TTL]
 * Returns 1 if reserved, 0 if over a quota (nothing reserved), -1 if the size
 * record already exists.
 */
const RESERVE_BYTES_SCRIPT = `
local bytes = tonumber(ARGV[1])
if KEYS[3] and not redis.call('SET', KEYS[3], bytes, 'NX', 'EX', ARGV[5]) then
  return -1
end
local ip = redis.call('INCRBY', KEYS[1], bytes)
local all = redis.call('INCRBY', KEYS[2], bytes)
if ip == bytes then redis.call('EXPIRE', KEYS[1], ARGV[4]) end
if all == bytes then redis.call('EXPIRE', KEYS[2], ARGV[4]) end
if ip > tonumber(ARGV[2]) or all > tonumber(ARGV[3]) then
  redis.call('DECRBY', KEYS[1], bytes)
  redis.call('DECRBY', KEYS[2], bytes)
  return 0
end
return 1
`;

/** Daily counters live past their UTC day, then expire. */
const DAILY_COUNTER_TTL_SECONDS = 2 * 24 * 60 * 60;

function utcDay(): string {
  return new Date().toISOString().slice(0, 10);
}

/** Bytes one IP may reserve for uploads per UTC day. */
export const DAILY_UPLOAD_QUOTA_BYTES = 300 * 1024 * 1024;

/**
 * Bytes all clients together may upload per UTC day. Pastes live up to 3
 * days, so this keeps the Blob store under the 1 GB Hobby limit (exceeding it
 * blocks the store for the rest of the billing cycle).
 */
export const GLOBAL_DAILY_UPLOAD_QUOTA_BYTES = 300 * 1024 * 1024;

/**
 * How long a declared upload size is kept: comfortably longer than an upload
 * token stays valid (1 h), so a slow upload's size is still there at create.
 */
const UPLOAD_SIZE_TTL_SECONDS = 3 * 60 * 60;

/**
 * Claims an upload token for `pathname` (`files/<uuid>`, also where the blob
 * is stored), in one Redis round trip:
 *
 * - Records the declared size. Blob rejects any upload larger than this, so
 *   it's a trusted upper bound on the stored blob, and lets paste creation
 *   skip a slow Blob lookup per file. Each pathname can be claimed once
 *   ("taken" otherwise): a second token for the same pathname could overwrite
 *   the size recorded for a larger blob already uploaded under it. Clients
 *   use a fresh UUID per file, so this never affects real uploads.
 * - Reserves the bytes against the IP's and the global daily upload quota
 *   ("quota" if either would be exceeded). Bytes stay counted even if the
 *   upload later fails, which errs on the side of the store.
 *
 * Always succeeds without Redis.
 */
export async function claimUpload(
  req: NextRequest,
  pathname: string,
  bytes: number
): Promise<"ok" | "taken" | "quota"> {
  const r = getRedis();
  if (!r) return "ok";
  const day = utcDay();
  const res = await r.eval<(string | number)[], number>(
    RESERVE_BYTES_SCRIPT,
    [`uq:${clientId(req)}:${day}`, `uq:all:${day}`, `upsz:${pathname}`],
    [
      bytes,
      DAILY_UPLOAD_QUOTA_BYTES,
      GLOBAL_DAILY_UPLOAD_QUOTA_BYTES,
      DAILY_COUNTER_TTL_SECONDS,
      UPLOAD_SIZE_TTL_SECONDS,
    ]
  );
  return res === 1 ? "ok" : res === -1 ? "taken" : "quota";
}

/**
 * Stored (encrypted) paste text one IP may create per UTC day. Generous for
 * people, but stops one client from filling the database.
 */
const DAILY_TEXT_QUOTA_BYTES = 20 * 1024 * 1024;

/**
 * Stored paste text all clients together may create per UTC day. Pastes live
 * up to 3 days, so this keeps the database well under the 500 MB Supabase
 * free limit (past it the database goes read-only).
 */
const GLOBAL_DAILY_TEXT_QUOTA_BYTES = 100 * 1024 * 1024;

/**
 * Reserves `bytes` of stored paste text against the IP's and the global daily
 * quota. Returns false (reserving nothing) if either would be exceeded.
 * Always allows when Redis isn't configured.
 */
export async function reserveTextBytes(
  req: NextRequest,
  bytes: number
): Promise<boolean> {
  const r = getRedis();
  if (!r || bytes <= 0) return true;
  const day = utcDay();
  const res = await r.eval<number[], number>(
    RESERVE_BYTES_SCRIPT,
    [`tq:${clientId(req)}:${day}`, `tq:all:${day}`],
    [
      bytes,
      DAILY_TEXT_QUOTA_BYTES,
      GLOBAL_DAILY_TEXT_QUOTA_BYTES,
      DAILY_COUNTER_TTL_SECONDS,
    ]
  );
  return res === 1;
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
