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

/**
 * Newsrooms — government ones especially — rarely publish at the blog-style
 * paths above; their feed lives under a news or press-release section.
 */
const NEWSROOM_PATHS = [
  "/news/rss",
  "/news/rss.xml",
  "/news/feed/",
  "/newsroom/rss",
  "/newsroom/feed",
  "/press-releases/rss",
  "/press-releases/feed",
  "/news/press-releases/rss",
  "/news/pressreleases.rss",
  "/rss/news",
  "/rss/all.xml",
];

/**
 * Pages that list a site's feeds. Probed directly, because a site can block
 * its HTML homepage while serving these and the feeds themselves — fbi.gov
 * does exactly that.
 */
const INDEX_PATHS = ["/feeds", "/rss", "/syndication", "/about/rss"];

/**
 * Rank feed candidates: a site often exposes many, and the newsroom is what
 * someone pasting the bare domain almost always wants — not its jobs board or
 * comment stream.
 */
function scoreFeedUrl(url: string) {
  const value = url.toLowerCase();
  let score = 0;
  if (/press[-_]?release|pressreleases/.test(value)) score += 5;
  if (/\bnews\b|newsroom|headlines/.test(value)) score += 4;
  if (/\ball\b|main|index|full/.test(value)) score += 1;
  if (/blog/.test(value)) score += 1;
  // Feeds that exist but are not what anyone means by "follow this site".
  if (/comment|podcast|video|photo|image|job|career|event|calendar|alert|recall|tag\/|category\/|author\/|search/.test(value))
    score -= 8;
  // Deep field-office or regional splits are narrower than the main feed.
  if (/field-office|local|region/.test(value)) score -= 3;
  return score;
}

/** Anchors pointing at a feed — many sites link theirs instead of declaring it. */
function feedLinksInAnchors(html: string, base: string) {
  const found: string[] = [];
  for (const match of html.matchAll(/<a\b[^>]*href=["']([^"']+)["']/gi)) {
    const href = match[1];
    if (!/(\.rss|\.xml|\/rss|\/feed|feed=rss|format=rss)/i.test(href)) continue;
    // Sitemaps and stylesheets are XML too.
    if (/sitemap|\.xsl|\.xsd/i.test(href)) continue;
    try {
      found.push(new URL(href, base).toString());
    } catch {
      /* skip malformed hrefs */
    }
  }
  return found;
}

/** Pages that list a site's feeds, e.g. fbi.gov/feeds — worth one hop. */
function feedIndexPages(html: string, base: string) {
  const found: string[] = [];
  for (const match of html.matchAll(/<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]{0,80}?)<\/a>/gi)) {
    const [, href, label] = match;
    const looksLikeIndex =
      /\/(feeds|rss|syndication)\/?$/i.test(href) ||
      /\brss\b|syndicat/i.test(label.replace(/<[^>]+>/g, ""));
    if (!looksLikeIndex) continue;
    try {
      const url = new URL(href, base).toString();
      if (!found.includes(url)) found.push(url);
    } catch {
      /* skip malformed hrefs */
    }
  }
  return found.slice(0, 3);
}

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

/**
 * Bing rather than Google News: Google wraps every result in a link that only
 * resolves in a browser, via JavaScript, so articles could not be read in the
 * app at all. Bing's wrapper carries the publisher's URL in a query parameter,
 * which unwrapRedirect turns back into a direct link.
 */
function topicFeedUrl(topic: string) {
  const query = encodeURIComponent(topic.trim());
  return `https://www.bing.com/news/search?q=${query}&format=RSS`;
}

/** Google News links can only be resolved by a browser running its JavaScript. */
export function isUnresolvableAggregatorLink(url: string) {
  return /^https?:\/\/news\.google\.com\/(rss\/)?articles\//i.test(url);
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
      siteUrl: "https://www.bing.com/news",
      favicon: faviconFor("bing.com"),
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

  // Plenty of sites link their feed as an ordinary anchor rather than
  // declaring it in <head>, which is how the .gov newsrooms were missed.
  const anchors = pageBody ? feedLinksInAnchors(pageBody, pageBase) : [];

  const siteCandidates = [
    ...declared,
    ...anchors,
    ...COMMON_PATHS.map((path) => `${origin}${path}`),
    ...NEWSROOM_PATHS.map((path) => `${origin}${path}`),
  ].filter((c) => !sectionCandidates.includes(c));

  const asResult = async (candidate: string, resultScope: "section" | "site") => {
    const { meta, total, articles } = await tryFeed(candidate, limit);
    if (articles.length === 0) throw new Error("Empty feed");
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
  };

  /**
   * Probe in small parallel batches, best-scoring first: trying a dozen
   * candidates one at a time would take longer than anyone will wait.
   */
  const tryAll = async (candidates: string[], resultScope: "section" | "site") => {
    const ranked = [...new Set(candidates)].sort(
      (a, b) => scoreFeedUrl(b) - scoreFeedUrl(a),
    );

    for (let i = 0; i < ranked.length; i += 4) {
      const batch = ranked.slice(i, i + 4);
      const settled = await Promise.allSettled(
        batch.map((candidate) => asResult(candidate, resultScope)),
      );
      // Keep the batch's ranking rather than whichever answered first.
      for (const outcome of settled) {
        if (outcome.status === "fulfilled") return outcome.value;
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

  // Some sites only list their feeds on a dedicated page, e.g. fbi.gov/feeds.
  const indexPages = [
    ...(pageBody ? feedIndexPages(pageBody, pageBase) : []),
    ...INDEX_PATHS.map((path) => `${origin}${path}`),
  ];

  for (const indexUrl of [...new Set(indexPages)].slice(0, 5)) {
    try {
      const { body, finalUrl } = await fetchText(indexUrl, 8000);
      if (looksLikeFeed(body)) continue; // handled as a feed already

      const listed = [
        ...feedLinksInHtml(body, finalUrl),
        ...feedLinksInAnchors(body, finalUrl),
      ];

      // Entries often point at a per-feed page rather than the XML itself
      // (fbi.gov/feeds/<name> → fbi.gov/feeds/<name>/rss.xml).
      const expanded = listed.flatMap((url) =>
        /\.(xml|rss|atom)$/i.test(url)
          ? [url]
          : [url, `${url.replace(/\/$/, "")}/rss.xml`],
      );

      // A newsroom can list dozens of feeds; only the best-ranked are worth
      // the requests.
      const best = [...new Set(expanded)]
        .sort((a, b) => scoreFeedUrl(b) - scoreFeedUrl(a))
        .slice(0, 10);

      const found = await tryAll(best, "site");
      if (found) return found;
    } catch {
      /* try the next index page */
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
