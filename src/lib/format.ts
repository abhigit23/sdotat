export function formatBytes(n: number): string {
  if (n >= 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MB`;
  if (n >= 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${n} B`;
}

export function formatFileCount(n: number): string {
  return `${n} file${n === 1 ? "" : "s"}`;
}

export function formatTimeUntil(
  iso: string,
  now: number = Date.now()
): string | null {
  const ms = new Date(iso).getTime() - now;
  if (!Number.isFinite(ms) || ms <= 0) return null;
  if (ms < 60_000) return "less than a minute";

  // Each tier rounds, then falls through on the next unit's guard, so a value
  // that rounds up to the next unit (59m59.6s -> 60) reports as "1 hour".
  const minutes = Math.round(ms / 60_000);
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? "" : "s"}`;

  const hours = Math.round(ms / 3_600_000);
  if (hours < 24) return `${hours} hour${hours === 1 ? "" : "s"}`;

  const days = Math.round(ms / 86_400_000);
  return `${days} day${days === 1 ? "" : "s"}`;
}