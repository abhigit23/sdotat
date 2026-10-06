// Expiry choices, shared by the editor (labels) and the server's validation
// (values). Kept free of imports so it adds nothing to the client bundle.

export const EXPIRY_OPTIONS = [
  { value: "5min", label: "5 minutes" },
  { value: "10min", label: "10 minutes" },
  { value: "30min", label: "30 minutes" },
  { value: "1h", label: "1 hour" },
  { value: "3h", label: "3 hours" },
  { value: "6h", label: "6 hours" },
  { value: "12h", label: "12 hours" },
  { value: "1d", label: "1 day" },
  { value: "3d", label: "3 days" },
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
