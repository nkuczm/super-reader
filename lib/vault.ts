/**
 * The API-key vault.
 *
 * Keys are encrypted in the browser with a passphrase and only then allowed to
 * sync, so the server stores ciphertext it has no way to read. A stolen sync
 * code, or a dump of the database, yields nothing without the passphrase —
 * which is the point: this deployment is public, and anything the server can
 * read is readable by whoever holds the URL.
 *
 * AES-GCM with a PBKDF2 key. Both sides of this run in the browser; Node has
 * the same WebCrypto API, which is what lets it be tested.
 */

export type VaultBlob = {
  /** Format version, so a future change can be recognised rather than guessed. */
  v: 1;
  salt: string;
  iv: string;
  ct: string;
};

export type Secrets = Record<string, string>;

/**
 * Deliberately slow: the passphrase is the only thing standing between a
 * stolen blob and the keys, so guessing has to cost something.
 */
const ITERATIONS = 310_000;

const encoder = new TextEncoder();
const decoder = new TextDecoder();

function toBase64(bytes: ArrayBuffer | Uint8Array) {
  const view = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let binary = "";
  for (const byte of view) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function fromBase64(value: string) {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

async function keyFrom(passphrase: string, salt: Uint8Array) {
  const material = await crypto.subtle.importKey(
    "raw",
    encoder.encode(passphrase),
    "PBKDF2",
    false,
    ["deriveKey"],
  );
  return crypto.subtle.deriveKey(
    { name: "PBKDF2", salt: salt as BufferSource, iterations: ITERATIONS, hash: "SHA-256" },
    material,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

export async function encryptVault(
  secrets: Secrets,
  passphrase: string,
): Promise<VaultBlob> {
  if (!passphrase) throw new Error("A passphrase is required.");
  // A fresh salt and IV every time: reusing either would leak that two
  // versions of the vault share a key, and GCM fails badly on IV reuse.
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await keyFrom(passphrase, salt);
  const ct = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv: iv as BufferSource },
    key,
    encoder.encode(JSON.stringify(secrets)),
  );
  return { v: 1, salt: toBase64(salt), iv: toBase64(iv), ct: toBase64(ct) };
}

export class WrongPassphrase extends Error {
  constructor() {
    super("That passphrase does not unlock these keys.");
    this.name = "WrongPassphrase";
  }
}

export async function decryptVault(
  blob: VaultBlob,
  passphrase: string,
): Promise<Secrets> {
  if (blob?.v !== 1) throw new Error("This vault was written by a newer version.");
  const key = await keyFrom(passphrase, fromBase64(blob.salt));
  let plain: ArrayBuffer;
  try {
    plain = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: fromBase64(blob.iv) as BufferSource },
      key,
      fromBase64(blob.ct),
    );
  } catch {
    // GCM cannot tell a wrong passphrase from tampering, and neither can we:
    // both mean these bytes are not ours to read.
    throw new WrongPassphrase();
  }
  const parsed = JSON.parse(decoder.decode(plain));
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new WrongPassphrase();
  }
  return parsed as Secrets;
}

export function isVaultBlob(value: unknown): value is VaultBlob {
  const blob = value as VaultBlob | null;
  return (
    !!blob &&
    typeof blob === "object" &&
    blob.v === 1 &&
    typeof blob.salt === "string" &&
    typeof blob.iv === "string" &&
    typeof blob.ct === "string"
  );
}

/**
 * How the browser hands keys to our server for one request: a header, not a
 * query parameter, so a key never lands in a URL, a log line or a referrer.
 * The server uses them for that request and keeps nothing.
 */
export const KEYS_HEADER = "x-sr-api-keys";

export function encodeKeysHeader(secrets: Secrets): string {
  return toBase64(encoder.encode(JSON.stringify(secrets)));
}

export function decodeKeysHeader(value: string | null): Secrets {
  if (!value) return {};
  try {
    const parsed = JSON.parse(decoder.decode(fromBase64(value)));
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    const secrets: Secrets = {};
    for (const [id, key] of Object.entries(parsed)) {
      if (typeof key === "string" && key.trim()) secrets[id] = key.trim();
    }
    return secrets;
  } catch {
    return {};
  }
}
