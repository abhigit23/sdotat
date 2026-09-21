import { customAlphabet } from "nanoid";

// Base62 (uppercase + lowercase + digits), URL-safe and typable.
const alphabet =
  "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";

export const CODE_LENGTH = 6;

// ~56 bits of entropy at length 6.
export const shortId = customAlphabet(alphabet, CODE_LENGTH);

export function isValidCode(code: string): boolean {
  return code.length === CODE_LENGTH && /^[0-9A-Za-z]{6}$/.test(code);
}


