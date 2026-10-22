import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { checkPageLimit } from "@/lib/rate-limit";

/** A paste page, `/<code>` (see isValidCode). */
const PASTE_PAGE = /^\/[0-9A-Za-z]{6}$/;

/**
 * Origin of this deployment's private Blob store, which serves the presigned
 * attachment downloads. The store ID is the public part of the read-write
 * token (`vercel_blob_rw_<storeId>_<secret>`); the secret never leaves here.
 * Null when Blob isn't configured (attachments are disabled then).
 */
const BLOB_STORE_ORIGIN = (() => {
  const storeId = process.env.BLOB_READ_WRITE_TOKEN?.split("_")[3];
  return storeId && /^[A-Za-z0-9]+$/.test(storeId)
    ? `https://${storeId.toLowerCase()}.private.blob.vercel-storage.com`
    : null;
})();

export async function proxy(request: NextRequest) {
  const nonce = Buffer.from(crypto.randomUUID()).toString("base64");
  const isDev = process.env.NODE_ENV === "development";

  const contentSecurityPolicyHeaderValue = [
    "default-src 'self'",
    `script-src 'nonce-${nonce}' 'strict-dynamic'${isDev ? " 'unsafe-eval'" : ""}`,
    "script-src-attr 'none'",
    `style-src 'self' ${isDev ? "'unsafe-inline'" : `'nonce-${nonce}'`}`,
    "img-src 'self' blob: data:",
    "font-src 'self'",
    // vercel.com: Blob uploads. The store origin: attachment downloads via
    // presigned URLs (encrypted; decrypted in the browser).
    `connect-src 'self' blob: https://vercel.com${BLOB_STORE_ORIGIN ? ` ${BLOB_STORE_ORIGIN}` : ""}`,
    "media-src 'self' blob:",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    "frame-src 'none'",
    "upgrade-insecure-requests",
  ].join("; ");

  const securityHeaders = {
    "Content-Security-Policy": contentSecurityPolicyHeaderValue,
    "Referrer-Policy": "no-referrer",
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    "X-DNS-Prefetch-Control": "off",
    "Permissions-Policy": "camera=(), microphone=(), geolocation=(), payment=()",
    "Cross-Origin-Opener-Policy": "same-origin",
    "Cross-Origin-Resource-Policy": "same-origin",
  };

  // Paste pages tell anyone whether a code exists and each costs a function
  // run plus a database query, so they're rate limited like the read APIs.
  if (PASTE_PAGE.test(request.nextUrl.pathname)) {
    const retryAfter = await checkPageLimit(request);
    if (retryAfter !== null) {
      return new NextResponse("Too many requests. Please slow down.", {
        status: 429,
        headers: {
          ...securityHeaders,
          "Content-Type": "text/plain; charset=utf-8",
          "Retry-After": String(retryAfter),
        },
      });
    }
  }

  const response = NextResponse.next({
    request: {
      headers: new Headers([
        ...request.headers,
        ["x-nonce", nonce],
        ...Object.entries(securityHeaders),
      ]),
    },
  });

  for (const [key, value] of Object.entries(securityHeaders)) {
    response.headers.set(key, value);
  }

  return response;
}

export const config = {
  matcher: [
    {
      source:
        // Static files are skipped so they don't each cost a proxy run.
        "/((?!api|_next/static|_next/image|favicon.ico|icon.svg|apple-icon.png|opengraph-image.png|robots.txt|sitemap.xml).*)",
      missing: [
        { type: "header", key: "next-router-prefetch" },
        { type: "header", key: "purpose", value: "prefetch" },
      ],
    },
  ],
};