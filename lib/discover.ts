import { fetchText, parseFeed, looksLikeFeed, faviconFor } from "./feed";
import { scrapePage } from "./scrape";
import { enrichArticles } from "./enrich";
import { xHandleFrom, fetchXFeed } from "./x";
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
  /** "site" forces the whole-site feed even when a section was pasted. */
  scope: "auto" | "site" = "auto",
): Promise<DiscoverResult> {
  const raw = input.trim();
  if (!raw) throw new Error("Nothing to look up");

  // An X account is neither a feed nor a scrapable page: x.com serves
  // logged-out visitors a login wall, so it goes through the API instead.
  const handle = xHandleFrom(raw);
  if (handle) {
    const { meta, articles } = await fetchXFeed(handle, limit);
    return { ...meta, kind: "x", scope: "site", total: articles.length, articles };
  }

  if (!isProbablyUrl(raw)) {
    // A plain topic: search-backed feed so any subject becomes a source.
    const { meta, total, articles } = await tryFeed(topicFeedUrl(raw), limit);
    return {
      ...meta,
      total,
      kind: "topic",
      scope: "site",
      title: raw,
      description: `Latest stories about “${raw}”`,
      siteUrl: "https://news.google.com",
      favicon: faviconFor("news.google.com"),
      articles,
    };
  }

  const url = normalizeUrl(raw);
  const asUrl = new URL(url);
  // Anything deeper than the domain root is a section the user asked for by
  // name — "just the Gemini posts", not the whole blog.
  const sectionPath = asUrl.pathname.replace(/\/$/, "");
  const hasSection = sectionPath !== "";
  const wantsSection = hasSection && scope !== "site";

  // 1. The URL may already be a feed.
  try {
    const { meta, total, articles } = await tryFeed(url, limit);
    return {
      ...meta,
      kind: "feed",
      scope: hasSection ? "section" : "site",
      total,
      favicon: faviconFor(meta.siteUrl),
      // Plenty of feeds ship no images at all; fill those in from each post.
      articles: await enrichArticles(articles, {
        siteDescription: meta.description,
      }),
    };
  } catch {
    /* not a feed itself — treat it as a web page below */
  }

  // 2. Read the page, both for its declared feeds and to scrape if needed.
  let declared: string[] = [];
  let pageBase = url;
  let pageBody: string | null = null;
  try {
    const { body, finalUrl } = await fetchText(url);
    pageBase = finalUrl;
    pageBody = body;
    declared = feedLinksInHtml(body, finalUrl);
  } catch {
    /* page unreachable — still try the conventional paths */
  }

  const origin = new URL(pageBase).origin;
  const under = (candidate: string) => {
    try {
      return new URL(candidate).pathname.replace(/\/$/, "").startsWith(sectionPath);
    } catch {
      return false;
    }
  };

  // A feed for the section itself is worth more than the site's main feed,
  // and most publishers expose one at <section>/rss or <section>/feed.
  const sectionCandidates = wantsSection
    ? [
        ...COMMON_PATHS.map((path) => `${origin}${sectionPath}${path}`),
        ...declared.filter(under),
      ]
    : [];

  const siteCandidates = [
    ...declared.filter((c) => !sectionCandidates.includes(c)),
    ...COMMON_PATHS.map((path) => `${origin}${path}`),
  ];

  const tryAll = async (candidates: string[], resultScope: "section" | "site") => {
    for (const candidate of [...new Set(candidates)]) {
      try {
        const { meta, total, articles } = await tryFeed(candidate, limit);
        if (articles.length === 0) continue;
        return {
          ...meta,
          kind: "feed" as const,
          scope: resultScope,
          total,
          favicon: faviconFor(meta.siteUrl || origin),
          articles: await enrichArticles(articles, {
            siteDescription: meta.description,
          }),
        };
      } catch {
        /* try the next candidate */
      }
    }
    return null;
  };

  const sectionFeed = await tryAll(sectionCandidates, "section");
  if (sectionFeed) return sectionFeed;

  // No feed for the section, but the page itself lists exactly its articles —
  // still closer to what was asked for than the whole site's feed.
  if (wantsSection && pageBody) {
    try {
      const { meta, articles } = scrapePage(pageBody, pageBase);
      const enriched = sortNewestFirst(
        await enrichArticles(articles.slice(0, limit), {
          siteDescription: meta.description,
        }),
      );
      if (enriched.length > 0) {
        return {
          ...meta,
          kind: "page",
          scope: "section",
          total: articles.length,
          favicon: faviconFor(meta.siteUrl),
          articles: enriched,
        };
      }
    } catch {
      /* fall through to the site-wide feed */
    }
  }

  const siteFeed = await tryAll(siteCandidates, "site");
  if (siteFeed) return siteFeed;

  // 4. No feed anywhere. Read the page itself, the way Feedly does for sites
  //    that never published one.
  try {
    const { body, finalUrl } = await fetchText(pageBase);
    const { meta, articles } = scrapePage(body, finalUrl);
    // A listing page gives titles and links; summaries and exact dates come
    // from each article's own metadata.
    const enriched = sortNewestFirst(
      await enrichArticles(articles.slice(0, limit), {
        siteDescription: meta.description,
      }),
    );
    return {
      ...meta,
      kind: "page",
      scope: hasSection ? "section" : "site",
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
