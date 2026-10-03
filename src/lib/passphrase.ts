// No 0/O, 1/l/I, so a generated password can be read aloud or retyped.
const ALPHABET =
  "23456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";

const GROUPS = 4;
const GROUP_LENGTH = 4;

/**
 * Rough local check for passwords that are easy to guess: under 12
 * characters, a single character type (e.g. only digits) unless it is a long
 * passphrase (16+), or one repeated character. Only drives a warning; the hard
 * minimum is enforced separately.
 */
export function isWeakPassword(password: string): boolean {
  const classes = [/[a-z]/, /[A-Z]/, /[0-9]/, /[^a-zA-Z0-9]/].filter((re) =>
    re.test(password)
  ).length;
  return (
    password.length < 12 ||
    (classes < 2 && password.length < 16) ||
    /^(.)\1*$/.test(password)
  );
}

/**
 * Random password like `k7Qm-Xe3P-vN9c-Tr4W` (16 characters, about 93 bits).
 * Uses rejection sampling so every character is equally likely.
 */
export function generatePassphrase(): string {
  const limit = 256 - (256 % ALPHABET.length);
  const chars: string[] = [];
  const needed = GROUPS * GROUP_LENGTH;
  while (chars.length < needed) {
    for (const byte of crypto.getRandomValues(new Uint8Array(needed * 2))) {
      if (byte < limit && chars.length < needed) {
        chars.push(ALPHABET[byte % ALPHABET.length]);
      }
    }
  }
  const groups: string[] = [];
  for (let i = 0; i < needed; i += GROUP_LENGTH) {
    groups.push(chars.slice(i, i + GROUP_LENGTH).join(""));
  }
  return groups.join("-");
}
