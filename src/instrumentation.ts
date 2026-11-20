export async function register() {
  // The checks read Node's process.env; the proxy's edge runtime needs none.
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { assertServerEnv } = await import("./lib/env");
  assertServerEnv();
}
