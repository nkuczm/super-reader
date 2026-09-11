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

