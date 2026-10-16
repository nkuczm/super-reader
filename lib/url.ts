/**
 * One article, one URL.
 *
 * The same story arrives from a feed, from Reddit and from a search wrapper
 * with three different query strings, and every count in the ranking — and
 * every "is this the article I already have" check in the list — depends on
 * those collapsing to one key.
 */
/** Parameters that identify the reader or the referrer, not the story. */
const JUNK_PARAMS =
  /^(utm_|ito$|mod$|ref$|referrer$|smid$|partner$|cmpid$|cmp$|srnd$|taid$|at_|fbclid$|gclid$|mc_cid$|mc_eid$|sh$|s$|share|guccounter|__twitter|_ga$|igshid$|spm$|xtor)/i;

/**
 * Links already made canonical. The same few thousand links are asked about
 * again and again — every group of a refresh merges the whole list, and the
 * list's views key every story — and parsing each one afresh was most of
 * what a refresh cost on a phone: seconds of a frozen page while the stories
 * came in. The answer for a link never changes.
 */
const canonical = new Map<string, string>();

export function canonicalUrl(input: string) {
  const known = canonical.get(input);
  if (known !== undefined) return known;
  const made = plainCanonical(input) ?? canonicalOf(input);
  if (canonical.size >= 50_000) canonical.clear();
  canonical.set(input, made);
  return made;
}

/**
 * Most links are plain — a lowercase host, a path of ordinary characters, no
 * query, fragment or port — and for those the parser's answer can be written
 * directly, which on a phone is the difference between a list that opens at
 * once and one that waits on a few thousand parses. Anything else, including
 * an IP address, an internationalised name or a dot segment, is left to the
 * parser. test/url.test.ts holds the two to the same answer.
 */
const PLAIN = /^https?:\/\/((?:[a-z0-9-]+\.)+[a-z]{2,})(\/[A-Za-z0-9\-._~/]*)?$/;

export function plainCanonical(input: string): string | null {
  const match = PLAIN.exec(input);
  if (!match || match[1].includes("xn--")) return null;
  const path = match[2] ?? "/";
  if (/\/\.\.?(\/|$)/.test(path)) return null;
  const host = match[1].replace(/^www\./, "");
  const pathname = path.replace(/\/amp\/?$/i, "/").replace(/\.amp$/i, "");
  const text = `https://${host}${pathname}`;
  return text.endsWith("/") && pathname !== "/" ? text.slice(0, -1) : text;
}

export function canonicalOf(input: string) {
  try {
    const url = new URL(input.trim());
    url.hash = "";
    url.protocol = "https:";
    url.hostname = url.hostname.replace(/^www\./i, "").toLowerCase();
    // AMP copies are the same story as the page they mirror.
    url.pathname = url.pathname.replace(/\/amp\/?$/i, "/").replace(/\.amp$/i, "");
    for (const key of [...url.searchParams.keys()]) {
      if (JUNK_PARAMS.test(key)) url.searchParams.delete(key);
    }
    url.search = url.searchParams.toString();
    const text = url.toString();
    return text.endsWith("/") && url.pathname !== "/" ? text.slice(0, -1) : text;
  } catch {
    return input.trim();
  }
}


/**
 * The little square next to a source's name. Google's service rather than
 * fetching each site's own icon: a publisher that answers 403 to our server
 * has no icon we could read, and this works for every host either way.
 *
 * Here rather than in lib/feed.ts so the reader can ask for one without
 * pulling an XML parser into the browser bundle.
 */
export function faviconFor(siteUrl: string) {
  let domain = siteUrl;
  try {
    domain = new URL(siteUrl).hostname;
  } catch {
    /* fall back to the raw string */
  }
  return `https://www.google.com/s2/favicons?domain=${encodeURIComponent(domain)}&sz=64`;
}
