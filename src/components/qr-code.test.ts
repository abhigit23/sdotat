import { describe, expect, it } from "vitest";
import { encode } from "uqr";
import jsQR from "jsqr";
import { qrPath } from "./qr-code";

const BORDER = 4;
const SCALE = 4;

/**
 * Rasterises the path the component draws (it only uses `M x y h w v1 h -w z`
 * runs) into RGBA pixels, so a real decoder can check the code scans.
 */
function rasterise(path: string, modules: number) {
  const side = (modules + BORDER * 2) * SCALE;
  const pixels = new Uint8ClampedArray(side * side * 4).fill(255);
  for (const [, x, y, w] of path.matchAll(/M(\d+) (\d+)h(\d+)v1h-\d+z/g)) {
    for (let py = +y * SCALE; py < (+y + 1) * SCALE; py++) {
      for (let px = +x * SCALE; px < (+x + +w) * SCALE; px++) {
        const i = (py * side + px) * 4;
        pixels[i] = pixels[i + 1] = pixels[i + 2] = 0;
      }
    }
  }
  return { pixels, side };
}

describe("QR code", () => {
  it.each([
    "https://sdotat.vercel.app/RcmR6m",
    "http://localhost:3000/aB3dE9",
  ])("draws a code that decodes back to %s", (url) => {
    const { data, size } = encode(url, { ecc: "M", border: 0 });
    const { pixels, side } = rasterise(qrPath(data), size);
    expect(jsQR(pixels, side, side)?.data).toBe(url);
  });

  it("merges horizontal runs into one rectangle each", () => {
    expect(qrPath([[true, true, false, true]])).toBe("M4 4h2v1h-2zM7 4h1v1h-1z");
  });
});
