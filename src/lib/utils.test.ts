import { describe, expect, it } from "vitest";
import { generatePassphrase, isWeakPassword } from "./passphrase";
import { isValidCode, shortId } from "./ids";
import { mapWithByteBudget, mapWithConcurrency } from "./map-concurrency";

describe("passphrase", () => {
  it("generates 4 groups of 4 unambiguous characters", () => {
    for (let i = 0; i < 50; i++) {
      const p = generatePassphrase();
      expect(p).toMatch(/^[2-9A-HJ-NP-Za-km-z]{4}(-[2-9A-HJ-NP-Za-km-z]{4}){3}$/);
      expect(isWeakPassword(p)).toBe(false);
    }
  });

  it("flags weak passwords", () => {
    expect(isWeakPassword("short1A")).toBe(true);
    expect(isWeakPassword("123456789012")).toBe(true);
    expect(isWeakPassword("aaaaaaaaaaaaaaaaaaaa")).toBe(true);
    expect(isWeakPassword("correcthorsebatterystaple")).toBe(false);
    expect(isWeakPassword("Tr0ub4dor&3x")).toBe(false);
  });
});

describe("ids", () => {
  it("generates valid 6-character codes", () => {
    for (let i = 0; i < 100; i++) expect(isValidCode(shortId())).toBe(true);
    expect(isValidCode("abc")).toBe(false);
    expect(isValidCode("abc-12")).toBe(false);
  });
});

const tick = () => new Promise((r) => setTimeout(r, 1));

describe("mapWithConcurrency", () => {
  it("keeps order and respects the limit", async () => {
    let active = 0;
    let peak = 0;
    const out = await mapWithConcurrency([1, 2, 3, 4, 5], 2, async (n) => {
      peak = Math.max(peak, ++active);
      await tick();
      active--;
      return n * 2;
    });
    expect(out).toEqual([2, 4, 6, 8, 10]);
    expect(peak).toBe(2);
  });
});

describe("mapWithByteBudget", () => {
  it("caps bytes in flight but always runs one oversized item", async () => {
    let activeBytes = 0;
    let peakBytes = 0;
    const sizes = [60, 60, 200, 10, 10, 10];
    const out = await mapWithByteBudget(
      sizes,
      100,
      (s) => s,
      async (s, i) => {
        activeBytes += s;
        peakBytes = Math.max(peakBytes, activeBytes);
        await tick();
        activeBytes -= s;
        return i;
      },
    );
    expect(out).toEqual([0, 1, 2, 3, 4, 5]);
    // Only the 200-byte item, running alone, may exceed the budget.
    expect(peakBytes).toBe(200);
  });

  it("rejects on the first failure and starts nothing after it", async () => {
    const started: number[] = [];
    await expect(
      mapWithByteBudget([1, 2, 3, 4], 1, () => 1, async (n) => {
        started.push(n);
        await tick();
        if (n === 2) throw new Error("boom");
        return n;
      }),
    ).rejects.toThrow("boom");
    await tick();
    expect(started).toEqual([1, 2]);
  });

  it("resolves an empty list", async () => {
    expect(await mapWithByteBudget([], 1, () => 1, async () => 1)).toEqual([]);
  });
});

describe("expiry", () => {
  it("has a duration for every option, longest 3 days", async () => {
    const { EXPIRY_OPTIONS, expiryMs } = await import("./expiry");
    for (const o of EXPIRY_OPTIONS) expect(expiryMs(o.value)).toBeGreaterThan(0);
    expect(expiryMs("3d")).toBe(3 * 24 * 60 * 60 * 1000);
    expect(expiryMs("1y")).toBeNull();
  });
});
