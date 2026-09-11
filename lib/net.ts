/**
 * The rule for every outbound request: the public web only.
 *
 * This app fetches URLs on behalf of whoever is using it — that is the whole
 * feature — and the deployment is public, with no login in front of it. So
 * anyone who has the URL can ask the server to make an HTTP request and hand
 * back what came out of it. If that request can reach the deployment's own
 * network, the app is an open proxy into it: cloud metadata endpoints
 * (169.254.169.254, which on most providers hands out credentials), anything
 * on localhost, and anything else inside the perimeter.
 *
 * There *was* a check, and it was not enough in three ways, each of which was
 * reproduced against the built app before this was written:
 *
 *  1. It lived in `/api/article` only. `/api/discover` and `/api/feed` fetch
 *     arbitrary URLs too, and had nothing. An internal service that serves
 *     XML came straight back through /api/feed, contents and all.
 *  2. It ran on the URL that was asked for, and `fetch` follows redirects.
 *     A public URL that 302s to an internal one was never re-checked.
 *  3. It matched IPv4 text and `::1`, so `[::ffff:a9fe:a9fe]` — the metadata
 *     address written as IPv4-mapped IPv6, which `new URL()` accepts and
 *     normalises — went straight through.
 *
 * So the check moved here, below every caller, and it resolves the hostname
 * rather than trusting how it is spelled. Redirects are followed by hand so
 * each hop is checked. Responses are capped, because a reader that can be
 * pointed at a 2GB file is a way to take the deployment down.
 *
 * Known residual: this resolves, validates, and then fetches, so a name whose
 * DNS answer changes between those two moments (DNS rebinding) is not
 * stopped. Closing that needs the connection pinned to the address that was
 * checked, which Node's fetch will not do without swapping in a custom
 * dispatcher. It is written down in HANDOFF rather than papered over.
 */

import { lookup } from "node:dns/promises";

/** Refused before any connection is made. Carries a message fit for the UI. */
export class BlockedHostError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BlockedHostError";
  }
}

/**
 * Fixtures live on 127.0.0.1, which is exactly what this blocks. The escape
 * hatch is read at call time and is never set in the deployed app.
 */
function privateHostsAllowed() {
  return process.env.ALLOW_PRIVATE_HOSTS === "1";
}

/** Suffixes that never name something on the public internet. */
const PRIVATE_SUFFIXES = [
  ".local",
  ".localhost",
  ".internal",
  ".intranet",
  ".lan",
  ".corp",
  ".home",
  ".home.arpa",
];

function isPrivateHostname(hostname: string) {
  const host = hostname.toLowerCase().replace(/\.$/, "");
  if (host === "localhost") return true;
  return PRIVATE_SUFFIXES.some((suffix) => host.endsWith(suffix));
}

/** Dotted-quad to four bytes, or null if it is not one. */
function ipv4Bytes(value: string): number[] | null {
  const match = value.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (!match) return null;
  const bytes = match.slice(1).map(Number);
  return bytes.every((byte) => byte >= 0 && byte <= 255) ? bytes : null;
}

/**
 * Ranges that are not the public internet.
 *
 * 169.254.0.0/16 is the one that matters most: every major cloud serves
 * instance credentials from 169.254.169.254. The rest are the private,
 * loopback, carrier-NAT, benchmarking, multicast and reserved blocks.
 */
function isPrivateIpv4(bytes: number[]) {
  const [a, b] = bytes;
  return (
    a === 0 || // "this network"
    a === 10 ||
    a === 127 ||
    (a === 169 && b === 254) || // link-local, and cloud metadata
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 192 && b === 0) || // 192.0.0.0/24 protocol assignments
    (a === 100 && b >= 64 && b <= 127) || // carrier-grade NAT
    (a === 198 && (b === 18 || b === 19)) || // benchmarking
    a >= 224 // multicast and reserved, up to 255.255.255.255
  );
}

/**
 * IPv6, including the forms that carry an IPv4 address inside them.
 *
 * `::ffff:169.254.169.254` is the same address as 169.254.169.254 and reaches
 * the same service; `new URL()` rewrites it to `[::ffff:a9fe:a9fe]`, which
 * looks nothing like an IPv4 address unless it is unpacked. 6to4 (2002::/16)
 * and NAT64 (64:ff9b::/96) embed one the same way.
 */
function isPrivateIpv6(value: string) {
  const host = value.toLowerCase().replace(/^\[|\]$/g, "").split("%")[0];
  const groups = expandIpv6(host);
  if (!groups) return false;

  if (groups.every((group) => group === 0)) return true; // ::
  if (groups.slice(0, 7).every((group) => group === 0) && groups[7] === 1) return true; // ::1

  const first = groups[0];
  if ((first & 0xfe00) === 0xfc00) return true; // fc00::/7, unique local
  if ((first & 0xffc0) === 0xfe80) return true; // fe80::/10, link-local
  if ((first & 0xff00) === 0xff00) return true; // ff00::/8, multicast

  // An IPv4 address embedded in an IPv6 one is that IPv4 address.
  const embedded =
    groups.slice(0, 5).every((group) => group === 0) && groups[5] === 0xffff
      ? [groups[6], groups[7]] // ::ffff:a.b.c.d
      : first === 0x2002
        ? [groups[1], groups[2]] // 2002:a.b.c.d::/16
        : groups[0] === 0x0064 && groups[1] === 0xff9b
          ? [groups[6], groups[7]] // 64:ff9b::a.b.c.d
          : null;
  if (embedded) {
    const bytes = [embedded[0] >> 8, embedded[0] & 0xff, embedded[1] >> 8, embedded[1] & 0xff];
    if (isPrivateIpv4(bytes)) return true;
  }

  return false;
}

/** An IPv6 string to its eight 16-bit groups, "::" and trailing v4 expanded. */
function expandIpv6(value: string): number[] | null {
  if (!/^[0-9a-f:.]+$/.test(value) || !value.includes(":")) return null;

  let text = value;
  // A trailing dotted-quad is two groups.
  const tail = text.match(/(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/);
  if (tail) {
    const bytes = ipv4Bytes(tail[1]);
    if (!bytes) return null;
    const hex = [
      ((bytes[0] << 8) | bytes[1]).toString(16),
      ((bytes[2] << 8) | bytes[3]).toString(16),
    ].join(":");
    text = `${text.slice(0, -tail[1].length)}${hex}`;
  }

  const [head, rest, extra] = text.split("::");
  if (extra !== undefined) return null; // only one "::" is legal

  const parse = (part: string) =>
    part
      .split(":")
      .filter(Boolean)
      .map((group) => Number.parseInt(group, 16));

  const left = parse(head ?? "");
  const right = rest === undefined ? [] : parse(rest);
  if ([...left, ...right].some((group) => Number.isNaN(group) || group > 0xffff)) {
    return null;
  }

  if (rest === undefined) return left.length === 8 ? left : null;
  const missing = 8 - left.length - right.length;
  if (missing < 0) return null;
  return [...left, ...Array(missing).fill(0), ...right];
}

/** Is this address one we must never connect to? */
export function isPrivateAddress(value: string) {
  const bare = value.replace(/^\[|\]$/g, "");
  const v4 = ipv4Bytes(bare);
  if (v4) return isPrivateIpv4(v4);
  if (bare.includes(":")) return isPrivateIpv6(bare);
  return false;
}

/**
 * Check a URL before connecting to it.
 *
 * The hostname is *resolved*, not just read: a name an attacker controls can
 * be pointed at 169.254.169.254 as easily as typed, and a check on the
 * spelling would never see it.
 */
export async function assertPublicUrl(input: string | URL): Promise<URL> {
  let url: URL;
  try {
    url = input instanceof URL ? input : new URL(input);
  } catch {
    throw new BlockedHostError("That is not a valid URL");
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new BlockedHostError("Only http and https addresses can be fetched");
  }
  if (privateHostsAllowed()) return url;

  const hostname = url.hostname;
  if (isPrivateHostname(hostname)) {
    throw new BlockedHostError("That host is not reachable");
  }
  // A literal address needs no lookup, and must not get the benefit of one.
  if (isPrivateAddress(hostname)) {
    throw new BlockedHostError("That host is not reachable");
  }
  if (ipv4Bytes(hostname.replace(/^\[|\]$/g, "")) || hostname.includes(":")) {
    return url;
  }

  let addresses: { address: string }[];
  try {
    addresses = await lookup(hostname, { all: true });
  } catch {
    // Unresolvable: the fetch could not have succeeded either, and failing
    // closed is the only safe answer when the address cannot be checked.
    throw new BlockedHostError("That host could not be looked up");
  }
  if (addresses.length === 0 || addresses.some((entry) => isPrivateAddress(entry.address))) {
    throw new BlockedHostError("That host is not reachable");
  }

  return url;
}

/** Redirect hops followed. Enough for real sites, short enough to bound. */
const MAX_HOPS = 5;
/**
 * The most of a response that is read.
 *
 * Everything here is text meant to be parsed — a feed, a page, a sitemap.
 * Eight megabytes is far past any of them and well short of what it takes to
 * exhaust a serverless function, which is the point: without a cap, one
 * request pointed at a large file is a way to take the deployment down.
 */
export const MAX_RESPONSE_BYTES = 8 * 1024 * 1024;

export type SafeResponse = {
  body: string;
  finalUrl: string;
  status: number;
  contentType: string;
  /** True when the response was longer than the cap and was cut. */
  truncated: boolean;
};

/**
 * Fetch a public URL as text, checking every hop and capping what is read.
 *
 * Redirects are followed by hand rather than by `fetch`, which is the whole
 * reason this exists: `redirect: "follow"` would take a checked public URL to
 * an unchecked internal one without ever asking again.
 */
export async function safeFetchText(
  input: string,
  {
    timeoutMs = 12000,
    maxBytes = MAX_RESPONSE_BYTES,
    headers = {},
  }: { timeoutMs?: number; maxBytes?: number; headers?: Record<string, string> } = {},
): Promise<SafeResponse> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    let target = await assertPublicUrl(input);

    for (let hop = 0; hop <= MAX_HOPS; hop += 1) {
      const res = await fetch(target, {
        headers,
        redirect: "manual",
        signal: controller.signal,
      });

      if (res.status >= 300 && res.status < 400) {
        const location = res.headers.get("location");
        if (!location) throw new Error(`${res.status} ${res.statusText}`);
        // Drain the redirect body so the socket is not left hanging.
        await res.body?.cancel().catch(() => {});
        if (hop === MAX_HOPS) throw new Error("Too many redirects");
        target = await assertPublicUrl(new URL(location, target));
        continue;
      }

      if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);

      const { text, truncated } = await readCapped(res, maxBytes);
      return {
        body: text,
        finalUrl: res.url || target.toString(),
        status: res.status,
        contentType: res.headers.get("content-type") ?? "",
        truncated,
      };
    }

    throw new Error("Too many redirects");
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Read a body, stopping at the cap.
 *
 * `res.text()` buffers whatever arrives, so a declared content-length is no
 * protection — a server can simply keep sending. Reading the stream is the
 * only way to stop at a size.
 */
async function readCapped(res: Response, maxBytes: number) {
  const declared = Number(res.headers.get("content-length") ?? "");
  if (Number.isFinite(declared) && declared > maxBytes) {
    await res.body?.cancel().catch(() => {});
    throw new Error("That response is too large to read");
  }

  if (!res.body) return { text: await res.text(), truncated: false };

  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  let truncated = false;

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      total += value.byteLength;
      if (total > maxBytes) {
        chunks.push(value.subarray(0, value.byteLength - (total - maxBytes)));
        truncated = true;
        break;
      }
      chunks.push(value);
    }
  } finally {
    await reader.cancel().catch(() => {});
  }

  const joined = new Uint8Array(chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0));
  let offset = 0;
  for (const chunk of chunks) {
    joined.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return { text: new TextDecoder("utf-8").decode(joined), truncated };
}

/**
 * The same rules, for a response that is bytes rather than text.
 *
 * `fetchFile` used to declare the size limit and then call `arrayBuffer()`,
 * which buffers whatever arrives before anything can check it — so the limit
 * only held for servers that told the truth in content-length. Reading the
 * stream and stopping is what actually bounds it.
 */
export async function safeFetchBytes(
  input: string,
  {
    timeoutMs = 20000,
    maxBytes,
    headers = {},
  }: { timeoutMs?: number; maxBytes: number; headers?: Record<string, string> },
): Promise<{ bytes: Uint8Array; contentType?: string; finalUrl: string }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    let target = await assertPublicUrl(input);

    for (let hop = 0; hop <= MAX_HOPS; hop += 1) {
      const res = await fetch(target, {
        headers,
        redirect: "manual",
        signal: controller.signal,
      });

      if (res.status >= 300 && res.status < 400) {
        const location = res.headers.get("location");
        if (!location) throw new Error(`${res.status} ${res.statusText}`);
        await res.body?.cancel().catch(() => {});
        if (hop === MAX_HOPS) throw new Error("Too many redirects");
        target = await assertPublicUrl(new URL(location, target));
        continue;
      }

      if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);

      const declared = Number(res.headers.get("content-length") ?? "");
      if (Number.isFinite(declared) && declared > maxBytes) {
        await res.body?.cancel().catch(() => {});
        throw new Error("That file is too large to open here.");
      }

      const bytes = await readBytesCapped(res, maxBytes);
      return {
        bytes,
        contentType: res.headers.get("content-type") ?? undefined,
        finalUrl: res.url || target.toString(),
      };
    }

    throw new Error("Too many redirects");
  } finally {
    clearTimeout(timer);
  }
}

async function readBytesCapped(res: Response, maxBytes: number) {
  if (!res.body) return new Uint8Array(await res.arrayBuffer());

  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      total += value.byteLength;
      // Unlike a page, a truncated file is not worth having: half a PDF does
      // not parse, so the honest answer is that it is too big.
      if (total > maxBytes) throw new Error("That file is too large to open here.");
      chunks.push(value);
    }
  } finally {
    await reader.cancel().catch(() => {});
  }

  const joined = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    joined.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return joined;
}
