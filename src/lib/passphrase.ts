// No 0/O, 1/l/I, so a generated password can be read aloud or retyped.
const ALPHABET =
  "23456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";

const GROUPS = 4;
const GROUP_LENGTH = 4;

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
