// Expiry choices, shared by the editor (labels) and the server (validation
// and expiry dates). Kept free of imports so it adds nothing to the client
// bundle.

const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

export const EXPIRY_OPTIONS = [
  { value: "5min", label: "5 minutes", ms: 5 * MINUTE },
  { value: "10min", label: "10 minutes", ms: 10 * MINUTE },
  { value: "30min", label: "30 minutes", ms: 30 * MINUTE },
  { value: "1h", label: "1 hour", ms: HOUR },
  { value: "3h", label: "3 hours", ms: 3 * HOUR },
  { value: "6h", label: "6 hours", ms: 6 * HOUR },
  { value: "12h", label: "12 hours", ms: 12 * HOUR },
  { value: "1d", label: "1 day", ms: DAY },
  { value: "3d", label: "3 days", ms: 3 * DAY },
] as const;

type ExpiryValue = (typeof EXPIRY_OPTIONS)[number]["value"];

/** The option values alone, as the non-empty tuple `z.enum` expects. */
export const EXPIRY_VALUES = EXPIRY_OPTIONS.map((o) => o.value) as [
  ExpiryValue,
  ...ExpiryValue[],
];

/** Display label for an expiry value, e.g. "1h" → "1 hour". */
export function expiryLabel(value: string): string {
  return EXPIRY_OPTIONS.find((o) => o.value === value)?.label ?? value;
}

/** Lifetime of an expiry value in milliseconds, or null if unknown. */
export function expiryMs(value: string): number | null {
  return EXPIRY_OPTIONS.find((o) => o.value === value)?.ms ?? null;
}
