import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

export function proxy(request: NextRequest) {
  const nonce = Buffer.from(crypto.randomUUID()).toString("base64");
  const isDev = process.env.NODE_ENV === "development";

  const contentSecurityPolicyHeaderValue = [
    "default-src 'self'",
    `script-src 'nonce-${nonce}' 'strict-dynamic'${isDev ? " 'unsafe-eval'" : ""}`,
    "script-src-attr 'none'",
    `style-src 'self' ${isDev ? "'unsafe-inline'" : `'nonce-${nonce}'`}`,
    "img-src 'self' blob: data:",
    "font-src 'self'",
    "connect-src 'self' blob: https://vercel.com",
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
        "/((?!api|_next/static|_next/image|favicon.ico|robots.txt|sitemap.xml).*)",
      missing: [
        { type: "header", key: "next-router-prefetch" },
        { type: "header", key: "purpose", value: "prefetch" },
      ],
    },
  ],
};