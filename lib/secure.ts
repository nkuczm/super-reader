/**
 * The small set of cryptographic pieces the account system stands on.
 *
 * - Data at rest: AES-256-GCM with DATA_KEY. A database dump, or a leaked
 *   backup of it, yields ciphertext. Each value carries its own random IV and
 *   is authenticated, so tampering fails rather than decrypting to garbage.
 * - Signed values: HMAC-SHA256 with AUTH_SECRET, for the short-lived cookie
 *   that carries an OAuth login across the round trip to Google.
 * - Session tokens: random, handed to the browser once, and stored only as a
 *   hash — a stolen sessions table cannot be replayed.
 *
 * Server-only. Both secrets come from the deployment's environment; without
 * them the account features stay off rather than running with weak defaults.
 */

import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";

export function dataKey(): Buffer | null {
  const raw = process.env.DATA_KEY;
  if (!raw) return null;
  const key = Buffer.from(raw, "base64");
  return key.length === 32 ? key : null;
}

export function authSecret(): string | null {
  const secret = process.env.AUTH_SECRET;
  return secret && secret.length >= 32 ? secret : null;
}

const PREFIX = "v1.";

/** Encrypt a string for storage. */
export function seal(plain: string, key = dataKey()): string {
  if (!key) throw new Error("DATA_KEY is not configured");
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const body = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return PREFIX + Buffer.concat([iv, tag, body]).toString("base64");
}

/** Decrypt something sealed above; throws if it was altered. */
export function open(sealed: string, key = dataKey()): string {
  if (!key) throw new Error("DATA_KEY is not configured");
  if (!sealed.startsWith(PREFIX)) throw new Error("Unknown sealed format");
  const raw = Buffer.from(sealed.slice(PREFIX.length), "base64");
  const iv = raw.subarray(0, 12);
  const tag = raw.subarray(12, 28);
  const body = raw.subarray(28);
  const decipher = createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(body), decipher.final()]).toString("utf8");
}

export function sealJson(value: unknown, key = dataKey()) {
  return seal(JSON.stringify(value), key);
}

export function openJson<T>(sealed: string, key = dataKey()): T {
  return JSON.parse(open(sealed, key)) as T;
}

export function randomToken(bytes = 32) {
  return randomBytes(bytes).toString("base64url");
}

export function sha256(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

/** value.signature, for a cookie the browser holds but must not be able to forge. */
export function sign(value: string, secret = authSecret()): string {
  if (!secret) throw new Error("AUTH_SECRET is not configured");
  const mac = createHmac("sha256", secret).update(value).digest("base64url");
  return `${value}.${mac}`;
}

export function unsign(signed: string, secret = authSecret()): string | null {
  if (!secret || !signed) return null;
  const at = signed.lastIndexOf(".");
  if (at <= 0) return null;
  const value = signed.slice(0, at);
  const expected = Buffer.from(createHmac("sha256", secret).update(value).digest("base64url"));
  const given = Buffer.from(signed.slice(at + 1));
  return given.length === expected.length && timingSafeEqual(given, expected) ? value : null;
}

/** PKCE: the verifier stays with us, its challenge goes to Google. */
export function pkce() {
  const verifier = randomToken(48);
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  return { verifier, challenge };
}

/** One cookie out of a request's Cookie header. */
export function cookieFrom(request: Request, name: string): string | null {
  const header = request.headers.get("cookie") ?? "";
  for (const part of header.split(/;\s*/)) {
    const eq = part.indexOf("=");
    if (eq > 0 && part.slice(0, eq) === name) {
      try {
        return decodeURIComponent(part.slice(eq + 1));
      } catch {
        return null;
      }
    }
  }
  return null;
}

/**
 * Whether a state-changing request came from this site's own pages.
 *
 * The session cookie is SameSite=Lax, which already keeps it off cross-site
 * POSTs in current browsers; this is the second lock, so a request forged
 * from another origin is refused even where a browser is lax about cookies.
 */
export function sameOrigin(request: Request): boolean {
  const origin = request.headers.get("origin");
  if (!origin) {
    // No Origin on a POST means a non-browser client or an old browser;
    // the Sec-Fetch-Site header, where present, still says where it came from.
    const site = request.headers.get("sec-fetch-site");
    return site === null || site === "same-origin" || site === "none";
  }
  try {
    return new URL(origin).host === new URL(request.url).host;
  } catch {
    return false;
  }
}
