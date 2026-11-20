export async function register() {
  // register() also runs for the edge runtime if any route uses it; the
  // checks only need to run once, in Node.js.
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { assertServerEnv } = await import("./lib/env");
  assertServerEnv();
}
