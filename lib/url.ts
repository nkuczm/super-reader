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

export function canonicalUrl(input: string) {
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
 * A URL that is safe to put in an href, or to hand to the server to fetch.
 *
 * Everything the app links comes out of a feed, which is third-party text: an
 * enclosure URL, a link in an item's body, the destination of a Reddit post.
 * `javascript:` and `data:` belong to none of them, and a feed is free to
 * contain either.
 *
 * React 19 does refuse to render a `javascript:` href, which is a real
 * backstop and not one to lean on: it covers exactly one scheme, in exactly
 * one place, and these URLs are also passed to the server to fetch. Keeping
 * them out of the data model in the first place is cheaper than remembering
 * every place they come out of it.
 */
export function httpUrlOrNull(input: string | undefined | null): string | null {
  if (!input) return null;
  const value = String(input).trim();
  if (!value) return null;
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:" ? url.toString() : null;
  } catch {
    // Not absolute: a relative href is resolved against its feed before it
    // gets here, so anything still relative at this point is unusable.
    return null;
  }
}
