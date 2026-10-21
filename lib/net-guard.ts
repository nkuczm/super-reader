/**
 * 4 or 6 for an IP address, 0 for a name — as node:net's isIP, which is not
 * imported because this module reaches the browser bundle through lib/files.
 */
function isIP(host: string) {
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host)) return 4;
  if (host.includes(":") && /^[0-9a-f:.]+$/i.test(host)) return 6;
  return 0;
}

/**
 * Keeping the server's own fetches on the public web.
 *
 * Several routes fetch whatever address they are handed — an article, a
 * feed, a file to download. Without a check, anyone could use the deployed
 * app to reach hosts only it can see: a cloud metadata address, a database
 * on a private network, a dev server on loopback. The check lives here so
 * every route asks the same question the same way.
 *
 * ALLOW_PRIVATE_HOSTS=1 exists so tests can read local fixtures; it is never
 * set in the deployed app.
 */

const allowPrivate = () => process.env.ALLOW_PRIVATE_HOSTS === "1";

/** An IPv4 address in a range that is not the public internet. */
function privateV4(address: string) {
  const parts = address.split(".").map(Number);
  if (parts.length !== 4 || parts.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return false;
  const [a, b] = parts;
  return (
    a === 0 || // "this network", and 0.0.0.0 reaches loopback on most systems
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) || // carrier-grade NAT, used inside clouds
    (a === 169 && b === 254) || // link-local, where cloud metadata lives
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 192 && b === 0 && parts[2] === 0) ||
    (a === 198 && (b === 18 || b === 19)) ||
    a >= 224 // multicast and reserved
  );
}

/** An IPv6 address that is not the public internet, including IPv4 dressed as IPv6. */
function privateV6(address: string) {
  const host = address.toLowerCase();
  if (host === "::" || host === "::1") return true;
  // ::ffff:127.0.0.1 — which the URL parser writes as ::ffff:7f00:1.
  const mapped = host.match(/^(?:0*:)*:?ffff:(?:0+:)?([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
  if (mapped) {
    const hi = parseInt(mapped[1], 16);
    const lo = parseInt(mapped[2], 16);
    return privateV4(`${hi >> 8}.${hi & 255}.${lo >> 8}.${lo & 255}`);
  }
  const dotted = host.match(/^(?:0*:)*:?(?:ffff:)?(\d+\.\d+\.\d+\.\d+)$/);
  if (dotted) return privateV4(dotted[1]);
  return (
    /^f[cd]/.test(host) || // unique local
    /^fe[89ab]/.test(host) || // link-local
    /^ff/.test(host) // multicast
  );
}

/** An IP address, of either family, that is not on the public internet. */
export function isPrivateAddress(address: string) {
  const kind = isIP(address);
  if (kind === 4) return privateV4(address);
  if (kind === 6) return privateV6(address);
  return false;
}

/** A hostname that names the private network, judged from the name alone. */
export function isPrivateHost(hostname: string) {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, "").replace(/\.$/, "");
  if (!host) return true;
  if (host === "localhost" || host.endsWith(".localhost")) return true;
  if (host.endsWith(".local") || host.endsWith(".internal") || host.endsWith(".home.arpa")) return true;
  return isPrivateAddress(host);
}

/**
 * Why this address may not be fetched, or null if it may.
 *
 * Judged from the URL alone: cheap enough for every address in a refresh.
 */
export function refuseUrl(raw: string | URL): string | null {
  let url: URL;
  try {
    url = typeof raw === "string" ? new URL(raw) : raw;
  } catch {
    return "That is not a valid URL";
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return "Unsupported URL scheme";
  if (!allowPrivate() && isPrivateHost(url.hostname)) return "That host is not reachable";
  return null;
}

/**
 * The same, and the name looked up too: a public-looking name can point at a
 * private address. Used where the response is handed back byte for byte.
 */
export async function refuseResolvedUrl(raw: string | URL): Promise<string | null> {
  const refused = refuseUrl(raw);
  if (refused || allowPrivate()) return refused;
  const host = new URL(raw).hostname.replace(/^\[|\]$/g, "");
  if (isIP(host)) return null;
  try {
    // Loaded here, on the server, for the same reason as isIP above.
    const { lookup } = await import("node:dns/promises");
    const answers = await lookup(host, { all: true });
    if (answers.some(({ address }) => isPrivateAddress(address))) return "That host is not reachable";
  } catch {
    return "That host could not be found";
  }
  return null;
}

/**
 * fetch, following redirects one hop at a time so that a public address
 * cannot bounce the request onto a private one.
 */
export async function fetchPublic(
  url: string | URL,
  init: RequestInit = {},
  /** Replaceable only so a test can let its own loopback fixture through. */
  refuse: (url: URL) => Promise<string | null> | string | null = refuseResolvedUrl,
  maxHops = 8,
): Promise<Response> {
  let next = new URL(url);
  for (let hop = 0; hop <= maxHops; hop++) {
    const refused = await refuse(next);
    if (refused) throw new BlockedUrlError(refused);
    const res = await fetch(next, { ...init, redirect: "manual" });
    const location = res.headers.get("location");
    if (res.status >= 300 && res.status < 400 && location) {
      await res.body?.cancel().catch(() => {});
      next = new URL(location, next);
      continue;
    }
    // Callers read the final address from res.url; a manual fetch leaves it
    // as the first, so say where the bytes actually came from.
    if (res.url !== next.toString()) Object.defineProperty(res, "url", { value: next.toString() });
    return res;
  }
  throw new Error("Too many redirects");
}

export class BlockedUrlError extends Error {
  name = "BlockedUrlError";
}
