import { fetchText, parseFeed, looksLikeFeed, faviconFor } from "./feed";
import { scrapePage } from "./scrape";
import { enrichArticles } from "./enrich";
import { sortNewestFirst } from "./sort";
import type { DiscoverResult } from "./types";

/** Feed paths that cover Substack, WordPress, Ghost, Hugo, Jekyll and friends. */
const COMMON_PATHS = [
  "/feed",
  "/rss",
  "/feed.xml",
  "/rss.xml",
  "/atom.xml",
  "/index.xml",
  "/blog/feed",
  "/blog/rss.xml",
  "/news/feed",
  "/feeds/posts/default",
];

function isProbablyUrl(input: string) {
  const value = input.trim();
  if (/\s/.test(value)) return false;
  if (/^https?:\/\//i.test(value)) return true;
  return /^[a-z0-9-]+(\.[a-z0-9-]+)+(\/|$)/i.test(value);
}

function normalizeUrl(input: string) {
  const value = input.trim();
  return /^https?:\/\//i.test(value) ? value : `https://${value}`;
}

function topicFeedUrl(topic: string) {
  const query = encodeURIComponent(topic.trim());
  return `https://news.google.com/rss/search?q=${query}&hl=en-US&gl=US&ceid=US:en`;
}

/** Pull <link rel="alternate" type="application/rss+xml"> targets out of a page. */
function feedLinksInHtml(html: string, base: string) {
  const found: string[] = [];
  const linkTags = html.match(/<link\b[^>]*>/gi) ?? [];
  for (const tag of linkTags) {
    if (!/rel=["']?[^"'>]*alternate/i.test(tag)) continue;
    if (!/type=["']?application\/(rss|atom)\+xml/i.test(tag)) continue;
    const href = tag.match(/href=["']([^"']+)["']/i)?.[1];
    if (!href) continue;
    try {
      found.push(new URL(href, base).toString());
    } catch {
      /* skip malformed hrefs */
    }
  }
  return found;
}

async function tryFeed(url: string, limit: number) {
  const { body, finalUrl } = await fetchText(url);
  if (!looksLikeFeed(body)) throw new Error("Response was not a feed");
  const { meta, articles } = parseFeed(body, finalUrl);
  return { meta, total: articles.length, articles: articles.slice(0, limit) };
}

export async function discover(
  input: string,
  limit = 12,
): Promise<DiscoverResult> {
  const raw = input.trim();
  if (!raw) throw new Error("Nothing to look up");

  if (!isProbablyUrl(raw)) {
    // A plain topic: search-backed feed so any subject becomes a source.
    const { meta, total, articles } = await tryFeed(topicFeedUrl(raw), limit);
    return {
      ...meta,
      total,
      kind: "topic",
      title: raw,
      description: `Latest stories about “${raw}”`,
      siteUrl: "https://news.google.com",
      favicon: faviconFor("news.google.com"),
      articles,
    };
  }

  const url = normalizeUrl(raw);

  // 1. The URL may already be a feed.
  try {
    const { meta, total, articles } = await tryFeed(url, limit);
    return {
      ...meta,
      kind: "feed",
      total,
      favicon: faviconFor(meta.siteUrl),
      articles,
    };
  } catch {
    /* not a feed itself — treat it as a web page below */
  }

  // 2. Look for a declared feed in the page's <head>.
  let candidates: string[] = [];
  let pageBase = url;
  try {
    const { body, finalUrl } = await fetchText(url);
    pageBase = finalUrl;
    candidates = feedLinksInHtml(body, finalUrl);
  } catch {
    /* page unreachable — still try the conventional paths */
  }

  // 3. Fall back to conventional feed paths on the same origin.
  const origin = new URL(pageBase).origin;
  for (const path of COMMON_PATHS) {
    const guess = `${origin}${path}`;
    if (!candidates.includes(guess)) candidates.push(guess);
  }

  for (const candidate of candidates) {
    try {
      const { meta, total, articles } = await tryFeed(candidate, limit);
      if (articles.length === 0) continue;
      return {
        ...meta,
        kind: "feed",
        total,
        favicon: faviconFor(meta.siteUrl || origin),
        articles,
      };
    } catch {
      /* try the next candidate */
    }
  }

  // 4. No feed anywhere. Read the page itself, the way Feedly does for sites
  //    that never published one.
  try {
    const { body, finalUrl } = await fetchText(pageBase);
    const { meta, articles } = scrapePage(body, finalUrl);
    // A listing page gives titles and links; summaries and exact dates come
    // from each article's own metadata.
    const enriched = sortNewestFirst(
      await enrichArticles(articles.slice(0, limit)),
    );
    return {
      ...meta,
      kind: "page",
      total: articles.length,
      favicon: faviconFor(meta.siteUrl),
      articles: enriched,
    };
  } catch (error) {
    throw new Error(
      error instanceof Error && /article links|list of articles/.test(error.message)
        ? error.message
        : "No feed found for that site, and its articles could not be read.",
    );
  }
}
