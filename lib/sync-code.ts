import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

/**
 * A sync code is a bearer secret: whoever holds it can read and write that
 * feed list. It is 160 bits of randomness, far beyond guessing, and shown in
 * Crockford base32 groups so it can be read aloud or retyped without
 * confusing 0/O or 1/I.
 */
const ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
const CODE_LENGTH = 20;

export function newSyncCode() {
  // 32 evenly divides 256, so mapping bytes to the alphabet stays uniform.
  const bytes = randomBytes(CODE_LENGTH);
  let out = "";
  for (const byte of bytes) out += ALPHABET[byte % ALPHABET.length];
  return out.match(/.{1,5}/g)!.join("-");
}

/** Accept a code however the user pasted it: spaces, dashes, lower case. */
export function normalizeCode(input: string) {
  return input
    .toUpperCase()
    .replace(/[^0-9A-Z]/g, "")
    .replace(/O/g, "0")
    .replace(/[IL]/g, "1");
}

export function isValidCode(input: string) {
  return normalizeCode(input).length === CODE_LENGTH;
}

/**
 * Rows are keyed by a hash, never the code itself, so a leak of the database
 * does not hand out access to anyone's feeds.
 */
export function hashCode(input: string) {
  return createHash("sha256").update(normalizeCode(input)).digest("hex");
}

export function codesMatch(a: string, b: string) {
  const bufA = Buffer.from(hashCode(a), "hex");
  const bufB = Buffer.from(hashCode(b), "hex");
  return bufA.length === bufB.length && timingSafeEqual(bufA, bufB);
}
