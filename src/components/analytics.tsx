"use client";

import { Analytics as VercelAnalytics } from "@vercel/analytics/next";
import { SpeedInsights } from "@vercel/speed-insights/next";

/** A paste page, `/<code>` (same pattern as PASTE_PAGE in proxy.ts). */
const PASTE_PAGE = /^\/[0-9A-Za-z]{6}$/;

/**
 * Paste codes are effectively secrets, so they never reach Vercel: paste
 * pages are reported as `/[code]`, and query strings and hashes are dropped.
 */
function redact<T extends { url: string }>(event: T): T {
  const url = new URL(event.url);
  if (PASTE_PAGE.test(url.pathname)) url.pathname = "/[code]";
  url.search = "";
  url.hash = "";
  return { ...event, url: url.toString() };
}

/** Vercel Web Analytics and Speed Insights, with URLs redacted. */
export default function Analytics() {
  return (
    <>
      <VercelAnalytics beforeSend={redact} />
      <SpeedInsights beforeSend={redact} />
    </>
  );
}
