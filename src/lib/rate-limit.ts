import { Ratelimit } from "@upstash/ratelimit";
import { Redis } from "@upstash/redis";
import type { NextRequest } from "next/server";

const UPS_ENABLED =
  !!process.env.KV_REST_API_URL && !!process.env.KV_REST_API_TOKEN;

if (!UPS_ENABLED && process.env.NODE_ENV === "production") {
  console.warn(
    "Rate limiting is disabled: KV_REST_API_URL / KV_REST_API_TOKEN are not set"
  );
}

let createLimiter: Ratelimit | null = null;
let readLimiter: Ratelimit | null = null;

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

/**
 * Resolves a stable identifier from an incoming request (client IP). Falls
 * back to a constant when headers are unavailable (unlikely in practice).
 */
export function getIp(req: NextRequest): string {
  return (
    req.headers.get("x-real-ip") ??
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    "unknown"
  );
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
  const { success, limit, remaining } = await limiter.limit(getIp(req));
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
  const { success, limit, remaining } = await limiter.limit(getIp(req));
  return { result: { success, limit, remaining }, active: true };
}
