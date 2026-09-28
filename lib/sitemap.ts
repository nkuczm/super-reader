/**
 * News sitemaps — the route publishers maintain and readers never use.
 *
 * A section feed is a courtesy; a news sitemap is an obligation. Publishers
 * who want to be in Google News keep one, it is required to list everything
 * published in the last 48 hours, and it carries a headline, a publication
 * date and a language for every entry. Measured from the deployment:
 *
 *   The Guardian   429 stories   where its section feed carries a few dozen
 *   New York Times 442 stories
 *   CNN            108 stories   and CNN declares no RSS feed at all
 *   The Verge       17 stories   fewer than its feed — the reverse case
 *
 * That spread is the whole argument for treating this as one route among
 * several rather than a replacement for feeds. At the Guardian it multiplies
 * coverage tenfold; at the Verge it would lose stories. Collect both, merge,
 * and the reader gets the union without having to know which site is which.
 *
 * Finding one is its own problem. Every conventional path we guessed at the
 * Guardian returned 404 while robots.txt named the real one, so robots.txt is
 * the route and guessing is the fallback — the opposite of how feeds work.
 */

import { fetchText, toIso, decodeEntities, absolute } from "./feed";
import type { Article } from "./types";

/** Paths worth guessing when robots.txt names nothing useful. */
const GUESSES = [
  "/sitemap-news.xml",
  "/news-sitemap.xml",
  "/sitemaps/news.xml",
  "/sitemap/news.xml",
  "/sitemaps/google_news",
  "/arc/outboundfeeds/news-sitemap/",
  "/sitemap_news.xml",
  "/googlenews.xml",
];

/** How much of a sitemap index is worth descending into. */
const MAX_CHILDREN = 3;
export const MAX_SITEMAP_ITEMS = 400;

function tagged(xml: string, tag: string): string[] {
  const found: string[] = [];
  const pattern = new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${tag}>`, "gi");
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(xml))) found.push(match[1]);
  return found;
}

function inner(block: string, tag: string): string | undefined {
  // Namespaced tags vary (news:title, n:title), so match on the local name.
  const match = block.match(
    new RegExp(`<(?:[a-z0-9]+:)?${tag}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/(?:[a-z0-9]+:)?${tag}>`, "i"),
  );
  if (!match) return undefined;
  const value = match[1]
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .trim();
  return value ? decodeEntities(value) : undefined;
}

export type Sitemap =
  | { kind: "index"; children: { url: string; lastmod?: string }[] }
  | { kind: "urls"; articles: Article[]; withNews: number };

/** Is this XML a sitemap at all? Cheap enough to ask before parsing. */
export function looksLikeSitemap(body: string): boolean {
  return /<(?:[a-z0-9]+:)?(urlset|sitemapindex)\b/i.test(body);
}

/**
 * Read one sitemap document.
 *
 * Entries carrying a <news:news> block are articles with a real headline and
 * publication date. Entries without one are still URLs — a plain sitemap
 * lists every page a site has, section landings and all — so those are
 * returned too and left for the authenticity filter to judge, with the slug
 * standing in for the headline it does not have.
 */
export function parseSitemap(body: string, base: string): Sitemap {
  if (/<(?:[a-z0-9]+:)?sitemapindex\b/i.test(body)) {
    const children = tagged(body, "(?:[a-z0-9]+:)?sitemap")
      .map((block) => ({
        url: inner(block, "loc") ?? "",
        lastmod: inner(block, "lastmod"),
      }))
      .filter((child) => child.url);
    return { kind: "index", children };
  }

  const articles: Article[] = [];
  let withNews = 0;
  for (const block of tagged(body, "(?:[a-z0-9]+:)?url")) {
    const loc = inner(block, "loc");
    if (!loc) continue;
    const link = absolute(loc, base);

    const news = block.match(/<(?:[a-z0-9]+:)?news(?:\s[^>]*)?>([\s\S]*?)<\/(?:[a-z0-9]+:)?news>/i)?.[1];
    const title = news ? inner(news, "title") : undefined;
    const published = news ? inner(news, "publication_date") : undefined;
    if (news) withNews += 1;

    articles.push({
      id: link,
      title: title ?? titleFromSlug(link),
      link,
      publishedAt: toIso(published ?? inner(block, "lastmod")),
      image: imageIn(block, base),
    });
  }
  return { kind: "urls", articles, withNews };
}

function imageIn(block: string, base: string): string | undefined {
  const image = block.match(
    /<(?:[a-z0-9]+:)?image(?:\s[^>]*)?>([\s\S]*?)<\/(?:[a-z0-9]+:)?image>/i,
  )?.[1];
  const loc = image ? inner(image, "loc") : undefined;
  return loc ? absolute(loc, base) : undefined;
}

/**
 * A readable headline from a URL, for sitemaps that carry no news block.
 * Not as good as the real one, and much better than showing a URL.
 */
export function titleFromSlug(link: string): string {
  try {
    const parts = new URL(link).pathname.split("/").filter(Boolean);
    const last = parts[parts.length - 1] ?? "";
    const stem = last.replace(/\.(html?|php|aspx?)$/i, "").replace(/[-_]+/g, " ");
    if (!stem || /^\d+$/.test(stem)) return "";
    return stem.charAt(0).toUpperCase() + stem.slice(1);
  } catch {
    return "";
  }
}

/**
 * A section of a sitemap, carried inside the source's own URL.
 *
 * A plain sitemap lists a whole site. When someone asks for a section of a
 * site that has no feed — institute.deepmind.com/essays is the case — the
 * sitemap is still the best route, but only the part of it under that path is
 * what was asked for (§3, "a section must stay a section"). The path rides in
 * the URL's fragment, the way a bundle rides in its own string, so refresh,
 * sync and offline never learn a new shape — and a fragment is never sent to
 * the server, so the sitemap itself is fetched exactly as before.
 */
const WITHIN = "within=";

export function sitemapSource(sitemapUrl: string, within?: string): string {
  const clean = sitemapUrl.split("#")[0];
  if (!within || within === "/") return clean;
  const path = `/${within.replace(/^\/+|\/+$/g, "")}/`;
  return `${clean}#${WITHIN}${encodeURIComponent(path)}`;
}

/** The section a sitemap source is limited to, if any. */
export function withinOf(sourceUrl: string): string | null {
  const hash = sourceUrl.split("#")[1] ?? "";
  if (!hash.startsWith(WITHIN)) return null;
  try {
    return decodeURIComponent(hash.slice(WITHIN.length)) || null;
  } catch {
    return null;
  }
}

/**
 * Only the entries under that path — and never the section's own landing
 * page, which is a list of the articles rather than one of them.
 */
export function keepWithin<T extends { link: string }>(articles: T[], within: string | null): T[] {
  if (!within) return articles;
  return articles.filter((article) => {
    try {
      const path = new URL(article.link).pathname;
      const normalised = path.endsWith("/") ? path : `${path}/`;
      return normalised.startsWith(within) && normalised !== within;
    } catch {
      return false;
    }
  });
}

/** Sitemaps named in robots.txt — the only reliable way to find the real one. */
export async function sitemapsFromRobots(origin: string): Promise<string[]> {
  try {
    const { body } = await fetchText(`${origin}/robots.txt`, 8000);
    return body
      .split("\n")
      .map((line) => line.match(/^\s*sitemap:\s*(\S+)/i)?.[1])
      .filter((url): url is string => Boolean(url))
      // robots.txt still names http:// at plenty of sites; the redirect costs
      // a round trip we do not need to spend.
      .map((url) => (origin.startsWith("https:") ? url.replace(/^http:\/\//i, "https://") : url));
  } catch {
    return [];
  }
}

/** Rank sitemap URLs by how likely they are to be the news one for this page. */
export function rankSitemaps(urls: string[], pagePath: string): string[] {
  const section = pagePath.split("/").filter(Boolean)[0]?.toLowerCase() ?? "";
  return [...new Set(urls)]
    .map((url) => {
      const lower = url.toLowerCase();
      let score = 0;
      if (/news/.test(lower)) score += 5;
      if (/google[-_]?news/.test(lower)) score += 3;
      if (/(article|story|stories|post)/.test(lower)) score += 2;
      // A site with sitemaps per language or per edition: prefer the one
      // matching the page the reader actually pasted. The BBC lists 39, most
      // of them for editions nobody asked for.
      if (section && lower.includes(section)) score += 4;
      if (/(video|audio|podcast|image|picture|gallery)/.test(lower)) score -= 6;
      if (/(author|tag|topic|category|profile|index-of)/.test(lower)) score -= 3;
      // Foreign-language editions, unless that is what was pasted.
      if (/(mundo|arabic|russian|hindi|portuguese|zhongwen|espanol|\/es\/|\/fr\/)/.test(lower)) {
        score -= 4;
      }
      return { url, score };
    })
    .sort((a, b) => b.score - a.score)
    .map((entry) => entry.url);
}

export type Harvested = {
  articles: Article[];
  /** The read stopped at the cap, so this is not all the site listed. */
  truncated: boolean;
  /** Which sitemap documents were actually read, for explaining the result. */
  read: string[];
  /** True when at least one document carried real news metadata. */
  authoritative: boolean;
};

/**
 * Collect everything a site's news sitemap currently lists.
 *
 * Descends one level into an index, because most large publishers point
 * robots.txt at an index rather than at the document with the stories in it.
 * Budgeted rather than exhaustive: an unbounded crawl of a sitemap index is
 * how a reader app becomes a crawler, and there is nothing at the bottom of
 * a 25-deep index that belongs in a feed anyway.
 */
export async function harvestSitemap(
  site: string,
  { limit = MAX_SITEMAP_ITEMS }: { limit?: number } = {},
): Promise<Harvested> {
  let origin: string;
  let pagePath = "";
  try {
    const url = new URL(site);
    origin = url.origin;
    pagePath = url.pathname;
  } catch {
    return { articles: [], read: [], authoritative: false, truncated: false };
  }

  const declared = await sitemapsFromRobots(origin);
  const newsish = declared.filter((url) => /news|article|story|post/i.test(url));
  const candidates = rankSitemaps(
    [...newsish, ...GUESSES.map((path) => `${origin}${path}`)],
    pagePath,
  ).slice(0, 6);

  const read: string[] = [];
  const articles: Article[] = [];
  let authoritative = false;

  const readOne = async (url: string, depth: number): Promise<void> => {
    if (articles.length >= limit || read.length >= 8) return;
    let body: string;
    let finalUrl = url;
    try {
      const fetched = await fetchText(url, 10000);
      body = fetched.body;
      finalUrl = fetched.finalUrl;
    } catch {
      return;
    }
    if (!looksLikeSitemap(body)) return;
    read.push(url);

    const parsed = parseSitemap(body, finalUrl);
    if (parsed.kind === "urls") {
      if (parsed.withNews > 0) authoritative = true;
      articles.push(...parsed.articles);
      return;
    }
    if (depth >= 1) return;

    // An index: follow the few children that look like news, newest first.
    const children = rankSitemaps(
      parsed.children
        .slice()
        .sort((a, b) => (b.lastmod ?? "").localeCompare(a.lastmod ?? ""))
        .map((child) => child.url),
      pagePath,
    ).slice(0, MAX_CHILDREN);
    for (const child of children) {
      if (articles.length >= limit) break;
      await readOne(child, depth + 1);
    }
  };

  for (const candidate of candidates) {
    if (articles.length > 0 && authoritative) break;
    await readOne(candidate, 0);
  }

  return {
    articles: articles.slice(0, limit),
    read,
    authoritative,
    truncated: articles.length > limit,
  };
}
