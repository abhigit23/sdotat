import { describe, expect, it } from "vitest";
import { clientIp, trustedIpHeader } from "./client-ip";

const req = (headers: Record<string, string>) => ({ headers: new Headers(headers) });

describe("trustedIpHeader", () => {
  it("uses x-real-ip on Vercel", () => {
    expect(trustedIpHeader({ VERCEL: "1" })).toBe("x-real-ip");
  });

  it("prefers an explicitly configured header", () => {
    expect(trustedIpHeader({ VERCEL: "1", TRUSTED_IP_HEADER: " CF-Connecting-IP " })).toBe(
      "cf-connecting-ip"
    );
  });

  it("trusts nothing off Vercel without configuration", () => {
    expect(trustedIpHeader({})).toBeNull();
  });
});

describe("clientIp", () => {
  it("ignores forgeable headers when nothing is trusted", () => {
    const r = req({ "x-real-ip": "1.2.3.4", "x-forwarded-for": "5.6.7.8" });
    expect(clientIp(r, {})).toBe("unknown");
  });

  it("reads the trusted header", () => {
    expect(clientIp(req({ "x-real-ip": "1.2.3.4" }), { VERCEL: "1" })).toBe("1.2.3.4");
  });

  it("takes the proxy-added (last) entry of an appended list", () => {
    const r = req({ "x-forwarded-for": "6.6.6.6, 1.2.3.4" });
    expect(clientIp(r, { TRUSTED_IP_HEADER: "x-forwarded-for" })).toBe("1.2.3.4");
  });

  it("falls back to unknown when the trusted header is missing", () => {
    expect(clientIp(req({}), { VERCEL: "1" })).toBe("unknown");
  });
});
