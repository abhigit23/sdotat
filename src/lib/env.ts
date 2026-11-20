/**
 * Startup check of the server's environment (run from instrumentation.ts).
 * Without it a missing POSTGRES_URL makes every paste a silent 404, and a
 * missing PASTE_MASTER_KEY only fails on the first create or read.
 */

type Env = Record<string, string | undefined>;

/** The app can't store or read pastes without these. */
const REQUIRED = ["POSTGRES_URL", "PASTE_MASTER_KEY"] as const;

/** Features degrade (or links break) without these, so they only warn. */
const RECOMMENDED: Record<string, string> = {
  APP_URL: "share links will be relative",
  CRON_SECRET: "the cleanup cron endpoint rejects every call",
  BLOB_READ_WRITE_TOKEN: "file attachments are disabled",
};

/** `openssl rand -hex 32` gives 64; anything shorter than this is suspect. */
const MIN_MASTER_KEY_LENGTH = 32;

export function checkEnv(env: Env): { errors: string[]; warnings: string[] } {
  const errors = REQUIRED.filter((k) => !env[k]).map((k) => `${k} is not set`);
  const warnings = Object.entries(RECOMMENDED)
    .filter(([k]) => !env[k])
    .map(([k, effect]) => `${k} is not set: ${effect}`);
  const key = env.PASTE_MASTER_KEY;
  if (key && key.length < MIN_MASTER_KEY_LENGTH) {
    // Only a warning: changing the key would make every stored paste
    // unreadable, so an existing short key must keep working.
    warnings.push(
      `PASTE_MASTER_KEY is shorter than ${MIN_MASTER_KEY_LENGTH} characters; use a long random value for new deployments`
    );
  }
  return { errors, warnings };
}

/**
 * Logs problems with the environment; in production, throws on missing
 * required variables so a misconfigured deployment fails loudly.
 */
export function assertServerEnv(env: Env = process.env): void {
  const { errors, warnings } = checkEnv(env);
  for (const w of warnings) console.warn(`[env] ${w}`);
  if (errors.length === 0) return;
  const message = `[env] ${errors.join("; ")}`;
  if (env.NODE_ENV === "production") throw new Error(message);
  console.error(message);
}
