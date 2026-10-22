import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  poweredByHeader: false,
  // The proxy (src/proxy.ts) sets security headers on pages but skips /api,
  // so API responses get theirs here, which costs no function invocation.
  // They are JSON or downloads, never rendered: a locked-down CSP (as strict
  // as the one the download route sets itself) and CORP stop other sites
  // from embedding or framing them.
  async headers() {
    return [
      {
        source: "/api/:path*",
        headers: [
          {
            key: "Content-Security-Policy",
            value: "default-src 'none'; frame-ancestors 'none'; sandbox",
          },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "no-referrer" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Cross-Origin-Resource-Policy", value: "same-origin" },
        ],
      },
    ];
  },
};

export default nextConfig;
