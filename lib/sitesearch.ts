/**
 * Asking a publisher's own archive a question.
 *
 * A general search engine knows a little about every site. A publisher's own
 * search knows everything about one site, including the pieces filed years
 * ago that no feed and no sitemap still carries. For a reader who wants
 * "everything this outlet has written about export controls", that archive is
 * the only complete answer there is.
 *
 * Measured from the deployment: asking TechCrunch's own search for "openai"
 * as a feed returned 20 articles spanning roughly a year. Its news sitemap
 * held 11 items from the last two days, and its RSS feed held 20 from the
 * last week — neither of which can answer a question about the archive.
 *
 * Two ways in, in order of how much we can trust them:
 *
 *   1. The site tells us. schema.org's SearchAction, in the JSON-LD most
 *      publishers ship, names the search URL in their own words.
 *   2. The platform gives it away. WordPress runs a large share of the
 *      publishing web and answers `?s=query&feed=rss2` with a proper RSS feed
 *      of search results — a real feed, with dates and summaries, no scraping.
 *
 * Both are then read as ordinary feeds, which is the point: nothing
 * downstream has to know this is a search rather than a section.
 */

const PLACEHOLDER = /\{\s*(search_term_string|search_term|query|q|s|keyword[s]?)\s*\}/i;

/** Fill a schema.org urlTemplate with the query. */
export function fillTemplate(template: string, query: string): string | null {
  if (!PLACEHOLDER.test(template)) return null;
  const filled = template.replace(PLACEHOLDER, encodeURIComponent(query));
  try {
    const url = new URL(filled);
    return /^https?:$/.test(url.protocol) ? url.toString() : null;
  } catch {
    return null;
  }
}

/**
 * Turn a site's search page URL into a feed of the same search, where the
 * platform offers one.
 *
 * Only WordPress is handled, and deliberately so: it is the one platform
 * where the feed form is a documented, stable part of the software rather
 * than a quirk of one site's theme. A guess that returns an HTML page is
 * harmless — the feed parser rejects it and the caller moves on.
 */
export function asFeedUrl(searchUrl: string): string | null {
  try {
    const url = new URL(searchUrl);
    if (!url.searchParams.has("s")) return null;
    url.searchParams.set("feed", "rss2");
    return url.toString();
  } catch {
    return null;
  }
}

/** The WordPress search feed for a site, which is worth trying on any site. */
export function wordpressSearchFeed(origin: string, query: string): string | null {
  try {
    const url = new URL(origin);
    url.pathname = "/";
    url.search = "";
    url.searchParams.set("s", query);
    url.searchParams.set("feed", "rss2");
    return url.toString();
  } catch {
    return null;
  }
}

/**
 * Every way we know to ask this site about this query, best first.
 *
 * `declaredTemplate` is the SearchAction from the page, when it had one.
 * Returned as a list rather than a choice because they cost one request each
 * and they find different things: the declared search is authoritative, the
 * WordPress feed is often richer, and a site may honour both.
 */
export function searchRoutes(
  origin: string,
  query: string,
  declaredTemplate?: string,
): { url: string; how: string }[] {
  const routes: { url: string; how: string }[] = [];
  const seen = new Set<string>();
  const push = (url: string | null, how: string) => {
    if (!url || seen.has(url)) return;
    seen.add(url);
    routes.push({ url, how });
  };

  if (declaredTemplate) {
    const filled = fillTemplate(declaredTemplate, query);
    push(filled, "the site's declared search");
    // A declared search that happens to be WordPress-shaped also has a feed.
    if (filled) push(asFeedUrl(filled), "the site's declared search, as a feed");
  }
  push(wordpressSearchFeed(origin, query), "the site's search feed");
  return routes;
}

/**
 * A general search engine, scoped to one site.
 *
 * The backstop for the sites that offer nothing of their own. Bing rather
 * than Google News because Google wraps every result in a link that only a
 * browser running its JavaScript can resolve, so those articles could not be
 * opened in the app at all.
 */
export function webSearchFeed(query: string, site?: string): string {
  const scoped = site ? `${query} site:${hostOf(site)}` : query;
  return `https://www.bing.com/news/search?q=${encodeURIComponent(scoped)}&format=RSS`;
}

function hostOf(input: string): string {
  try {
    return new URL(input).hostname.replace(/^www\./i, "");
  } catch {
    return input;
  }
}
