/**
 * Following a site that publishes no feed.
 *
 * Scraping the listing page (lib/scrape.ts) is the existing answer and it is
 * a good one, but it fails in two ways that are getting more common, not
 * less: a page that builds its list in the browser server-renders nothing to
 * group, and a section that paginates shows a scraper ten items and hides the
 * eleventh behind a click.
 *
 * Nearly all of those sites do publish a machine-readable index of everything
 * they have — a sitemap, announced in robots.txt, because search engines
 * require it of them. Government publishers in particular are far more
 * reliable about a sitemap than about RSS: a department that has never
 * shipped a feed still lists every notice it posts, with the date it posted
 * it.
 *
 * Two kinds are worth reading:
 *
 *  A news sitemap (the Google News extension) is the better one. It is
 *  limited by its own specification to the last two days, it carries each
 *  item's real headline and publication time, and it is exactly the set of
 *  things a newsroom considers news — which is the feed someone pasting the
 *  site wanted.
 *
 *  An ordinary sitemap carries URLs and `lastmod`. That is enough to build a
 *  newest-first list; the headlines come from each page's own metadata during
 *  enrichment, the same way a scraped listing page fills its gaps.
 *
 * This reads what a publisher put out to be read, at the address they
 * advertised for it, one request at a time. It is not a crawl: nothing
 * follows links out of the pages, and the number of sitemap documents opened
 * is capped hard.
 */

import { fetchText, toIso, decodeEntities } from "./feed";
import { sortNewestFirst } from "./sort";
import type { Article } from "./types";

/** How many sitemap documents one discovery may open, in total. */
const MAX_DOCUMENTS = 4;
/** Sitemaps get large. Past this, the remainder is not worth parsing. */
const MAX_BYTES = 4_000_000;

export type SitemapEntry = {
  loc: string;
  lastmod?: string;
  /** From the news extension, where the publisher used it. */
  title?: string;
  publishedAt?: string;
};

export type ParsedSitemap =
  | { kind: "index"; sitemaps: { loc: string; lastmod?: string }[] }
  | { kind: "urlset"; entries: SitemapEntry[] };

function tagIn(block: string, name: string) {
  // Namespaced or not: <loc>, <news:publication_date>, <image:loc>.
  const match = block.match(
    new RegExp(`<(?:[a-z0-9]+:)?${name}\\b[^>]*>([\\s\\S]*?)</(?:[a-z0-9]+:)?${name}>`, "i"),
  );
  if (!match) return undefined;
  const value = decodeEntities(match[1].replace(/<!\[CDATA\[|\]\]>/g, "")).trim();
  return value || undefined;
}

export function looksLikeSitemap(body: string) {
  const head = body.slice(0, 2000).toLowerCase();
  return head.includes("<urlset") || head.includes("<sitemapindex");
}

/**
 * Parse either kind of sitemap.
 *
 * By regex rather than by XML parser, deliberately: these documents reach
 * megabytes, a full parse builds an object graph for every one of 50,000
 * entries, and nothing here needs more than four fields per block.
 */
export function parseSitemap(xml: string, base: string): ParsedSitemap {
  const body = xml.slice(0, MAX_BYTES);

  if (/<sitemapindex\b/i.test(body)) {
    const sitemaps: { loc: string; lastmod?: string }[] = [];
    for (const [, block] of body.matchAll(/<sitemap\b[^>]*>([\s\S]*?)<\/sitemap>/gi)) {
      const loc = tagIn(block, "loc");
      if (!loc) continue;
      sitemaps.push({ loc: absoluteish(loc, base), lastmod: tagIn(block, "lastmod") });
    }
    return { kind: "index", sitemaps };
  }

  const entries: SitemapEntry[] = [];
  for (const [, block] of body.matchAll(/<url\b[^>]*>([\s\S]*?)<\/url>/gi)) {
    const loc = tagIn(block, "loc");
    if (!loc) continue;
    entries.push({
      loc: absoluteish(loc, base),
      lastmod: tagIn(block, "lastmod"),
      title: tagIn(block, "title"),
      publishedAt: tagIn(block, "publication_date"),
    });
  }
  return { kind: "urlset", entries };
}

function absoluteish(href: string, base: string) {
  try {
    return new URL(href, base).toString();
  } catch {
    return href;
  }
}

/** Sitemaps a site announces in robots.txt, which is where they belong. */
export function sitemapsInRobots(robots: string, base: string) {
  const found: string[] = [];
  for (const [, loc] of robots.matchAll(/^\s*sitemap:\s*(\S+)\s*$/gim)) {
    const url = absoluteish(loc, base);
    if (!found.includes(url)) found.push(url);
  }
  return found;
}

/** The conventional addresses, for a site whose robots.txt says nothing. */
const COMMON_SITEMAPS = [
  "/sitemap.xml",
  "/sitemap_index.xml",
  "/sitemap-index.xml",
  "/news-sitemap.xml",
  "/sitemap-news.xml",
  "/sitemap/news.xml",
];

/**
 * Which sitemap to open first.
 *
 * A news sitemap is worth far more than the site-wide one: it is the last two
 * days of journalism rather than every page the CMS has ever rendered, and it
 * carries headlines. After that, anything naming the section that was pasted,
 * then anything that sounds like articles, and a plain sitemap last.
 */
export function scoreSitemapUrl(url: string, sectionPath = "") {
  const value = url.toLowerCase();
  let score = 0;
  if (/news[-_]?sitemap|sitemap[-_]?news|googlenews/.test(value)) score += 10;
  if (/article|post|story|stories|press|release|blog/.test(value)) score += 4;
  if (sectionPath && value.includes(sectionPath.toLowerCase().replace(/^\//, ""))) score += 6;
  if (/index/.test(value)) score += 1;
  // Sitemaps that are not pages at all.
  if (/image|video|category|tag|author|topic|product|user|page-sitemap/.test(value)) score -= 8;
  return score;
}

/** A URL that is a listing rather than a story, as far as can be told. */
function looksLikeArticleUrl(url: string) {
  let path: string;
  try {
    path = new URL(url).pathname;
  } catch {
    return false;
  }
  if (path === "/" || path === "") return false;
  const segments = path.replace(/\/$/, "").split("/").filter(Boolean);
  if (segments.length === 0) return false;
  const last = segments[segments.length - 1];
  // A slug: several words, or a file with an id in it. A single short word is
  // usually a section ("/news", "/about").
  return segments.length > 1 || /[-_]/.test(last) || /\d/.test(last);
}

/** "harbour-works-approved-by-council" → "Harbour works approved by council". */
export function titleFromSlug(url: string) {
  let path: string;
  try {
    path = new URL(url).pathname;
  } catch {
    return "";
  }
  const last = path.replace(/\/$/, "").split("/").filter(Boolean).pop() ?? "";
  const words = last
    .replace(/\.(html?|php|aspx?)$/i, "")
    // Drop a trailing or leading numeric id, which is not part of the title.
    .replace(/^\d{4,}[-_]|[-_]\d{4,}$/g, "")
    .replace(/[-_+]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!words) return "";
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/**
 * Sitemap entries as articles, newest first.
 *
 * An entry with no date at all is dropped rather than sorted last: a sitemap
 * is not ordered, so an undated entry cannot be placed, and a "feed" whose
 * order is the CMS's internal one is worse than a shorter honest one.
 */
export function articlesFromSitemap(
  entries: SitemapEntry[],
  { sectionPath = "", limit = 40 }: { sectionPath?: string; limit?: number } = {},
): Article[] {
  const wanted = entries.filter((entry) => {
    if (!looksLikeArticleUrl(entry.loc)) return false;
    if (!sectionPath) return true;
    try {
      return new URL(entry.loc).pathname.startsWith(sectionPath);
    } catch {
      return false;
    }
  });

  const articles = wanted
    .map((entry): Article | null => {
      const publishedAt = toIso(entry.publishedAt) ?? toIso(entry.lastmod);
      if (!publishedAt) return null;
      return {
        id: entry.loc,
        // A news sitemap carries the headline. An ordinary one does not, and
        // the slug stands in until enrichment reads the page's own title.
        title: entry.title ?? "",
        link: entry.loc,
        publishedAt,
      };
    })
    .filter((article): article is Article => article !== null);

  return sortNewestFirst(articles).slice(0, limit);
}

export type SitemapSource = {
  /** The sitemap the articles came from, which is the source's address. */
  sitemapUrl: string;
  articles: Article[];
  /** True where the headlines are the publisher's, not derived from URLs. */
  headlines: boolean;
};

/**
 * Find a site's sitemap and read the newest articles out of it.
 *
 * Follows at most one level of index, opens at most four documents, and gives
 * up quietly: this is the last thing tried before scraping a page, so a site
 * that has no sitemap must cost a couple of failed requests and nothing else.
 */
export async function sitemapSource(
  origin: string,
  { sectionPath = "", limit = 40 }: { sectionPath?: string; limit?: number } = {},
): Promise<SitemapSource | null> {
  const declared = await robotsSitemaps(origin);
  const candidates = [
    ...declared,
    ...COMMON_SITEMAPS.map((path) => `${origin}${path}`),
  ];

  const ranked = [...new Set(candidates)].sort(
    (a, b) => scoreSitemapUrl(b, sectionPath) - scoreSitemapUrl(a, sectionPath),
  );

  let opened = 0;
  const queue = ranked.slice(0, 6);
  const seen = new Set<string>();

  while (queue.length > 0 && opened < MAX_DOCUMENTS) {
    const url = queue.shift()!;
    if (seen.has(url)) continue;
    seen.add(url);

    let parsed: ParsedSitemap;
    try {
      const { body, finalUrl } = await fetchText(url, 12000);
      opened += 1;
      if (!looksLikeSitemap(body)) continue;
      parsed = parseSitemap(body, finalUrl);
    } catch {
      continue;
    }

    if (parsed.kind === "index") {
      // Take the best-named children and try them before anything else left.
      const children = parsed.sitemaps
        .map((entry) => entry.loc)
        .sort((a, b) => scoreSitemapUrl(b, sectionPath) - scoreSitemapUrl(a, sectionPath))
        .slice(0, 2);
      queue.unshift(...children);
      continue;
    }

    const articles = articlesFromSitemap(parsed.entries, { sectionPath, limit });
    // Two is the floor. One surviving entry out of a whole document usually
    // means the filtering went wrong rather than that the section is quiet,
    // and a section genuinely holding a couple of notices is a real source.
    if (articles.length >= 2) {
      return {
        sitemapUrl: url,
        articles,
        headlines: articles.every((article) => Boolean(article.title)),
      };
    }
  }

  return null;
}

async function robotsSitemaps(origin: string) {
  try {
    const { body, finalUrl } = await fetchText(`${origin}/robots.txt`, 8000);
    // A robots.txt that comes back as a page is a 404 handler, not a policy.
    if (/^\s*</.test(body)) return [];
    return sitemapsInRobots(body.slice(0, 200_000), finalUrl);
  } catch {
    return [];
  }
}
