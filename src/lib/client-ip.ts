import type { NextRequest } from "next/server";

/**
 * The header holding the real client IP, or null if none can be trusted.
 * Clients can send any header, so it has to be one a proxy in front of the
 * app overwrites. On Vercel that's `x-real-ip`. Elsewhere TRUSTED_IP_HEADER
 * must name the header the deployment's own proxy sets (e.g.
 * `cf-connecting-ip` behind Cloudflare).
 */
export function trustedIpHeader(
  env: Record<string, string | undefined> = process.env
): string | null {
  const configured = env.TRUSTED_IP_HEADER?.trim().toLowerCase();
  if (configured) return configured;
  return env.VERCEL ? "x-real-ip" : null;
}

/**
 * The client's IP from the trusted header, or "unknown" when there is none.
 * With no trusted header every client shares one rate-limit bucket: limits
 * get stricter overall, but can't be dodged by forging a header.
 */
export function clientIp(
  req: Pick<NextRequest, "headers">,
  env: Record<string, string | undefined> = process.env
): string {
  const header = trustedIpHeader(env);
  // Proxies that append (x-forwarded-for) keep whatever the client sent at
  // the front, so only the last entry, added by the proxy nearest the app,
  // can be trusted. Single-value headers (x-real-ip) are unaffected.
  const value = header
    ? req.headers.get(header)?.split(",").at(-1)?.trim()
    : null;
  return value || "unknown";
}
