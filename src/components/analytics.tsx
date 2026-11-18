"use client";

import { Analytics as VercelAnalytics } from "@vercel/analytics/next";
import type { BeforeSendEvent } from "@vercel/analytics/next";

/** A paste page, `/<code>` (same pattern as PASTE_PAGE in proxy.ts). */
const PASTE_PAGE = /^\/[0-9A-Za-z]{6}$/;

/**
 * Paste codes are effectively secrets, so they never reach analytics: paste
 * pages are reported as `/[code]`, and query strings and hashes are dropped.
 */
function redact(event: BeforeSendEvent): BeforeSendEvent {
  const url = new URL(event.url);
  if (PASTE_PAGE.test(url.pathname)) url.pathname = "/[code]";
  url.search = "";
  url.hash = "";
  return { ...event, url: url.toString() };
}

export default function Analytics() {
  return <VercelAnalytics beforeSend={redact} />;
}
