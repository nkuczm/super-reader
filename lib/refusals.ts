/**
 * Hosts measured refusing every server request, and how a credential's site
 * is written. Apart from lib/subscriptions.ts, which re-exports both, so the
 * reader can ask without loading what reading a page needs — that module
 * reads structured data from pages, and with it the feed parser, which the
 * browser never otherwise uses.
 */

/** The site a credential belongs to, as it is stored: bare, lowercase, no www. */
export function normaliseHost(input: string): string {
  const raw = input.trim().toLowerCase();
  if (!raw) return "";
  let host = raw;
  try {
    host = new URL(/^https?:\/\//.test(raw) ? raw : `https://${raw}`).hostname;
  } catch {
    return "";
  }
  return host.replace(/^www\./, "");
}

/**
 * Sites that refuse a request from this app's server whatever it carries.
 *
 * Measured from the deployment on 16 Sep 2026, because the build sandbox
 * cannot reach the internet (docs/COLLECTION.md §5). nytimes.com serves its
 * homepage to us happily — 1.25 MB, HTTP 200 — and answers **403 to every
 * article**. Five header shapes were tried against the same story:
 *
 *   plain · browser-like sec-ch-ua + sec-fetch · with a nytimes.com referer ·
 *   as Googlebot · as mobile Safari        → 403, every one
 *
 * So the refusal is not about the shape of the request. It is the source: a
 * datacentre address, and the TLS fingerprint of a server's HTTP client. The
 * block lands *before* any cookie is looked at, which is why a subscription
 * cannot lift it — there is no authentication step to reach.
 *
 * Getting past it would mean impersonating a residential browser. That is
 * evading an access-control decision the publisher has deliberately made, and
 * this app does not do it, however good the reader's reason. What the reader
 * gets instead is the truth and one tap to the site, where their subscription
 * works exactly as they paid for.
 *
 * This list is for saying so up front. It is not a guess: add a host only
 * after measuring it, and record the measurement in §8 next to the others.
 */
export const REFUSES_SERVER_FETCH: Record<string, string> = {
  "nytimes.com":
    "The New York Times refuses article requests from any server, measured 16 Sep 2026 — " +
    "its homepage answers, every article returns 403, and no combination of headers changes that. " +
    "The refusal happens before a cookie is read, so a subscription cannot help here. " +
    "NYT stories still appear in your lists; opening one goes to nytimes.com, where you are signed in.",
};

/** What we already know about sending a credential to this host, if anything. */
export function knownRefusal(host: string): string | null {
  const wanted = normaliseHost(host);
  for (const [known, note] of Object.entries(REFUSES_SERVER_FETCH)) {
    if (wanted === known || wanted.endsWith(`.${known}`)) return note;
  }
  return null;
}
