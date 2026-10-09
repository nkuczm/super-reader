/**
 * A pasted link to one story, rather than to a site or a section.
 *
 * Discovery used to treat any path below the domain as a section, so a link
 * to an article was looked for a feed under the article's own address (none
 * ever exists) and then scraped as a listing page — which on an article
 * page means its related-stories rail and navigation: the confident,
 * useless list of docs/COLLECTION.md §6. An article is not a source; the
 * outlet that published it is. So an article link is recognised as one,
 * and the feed is looked for where the story sits: its section, then its
 * site.
 *
 * Pure: no fetching here, so it can be tested on fixtures.
 */

const ARTICLE_TYPES = /^(NewsArticle|Article|BlogPosting|ReportageNewsArticle|AnalysisNewsArticle|OpinionNewsArticle|ReviewNewsArticle|BackgroundNewsArticle|ScholarlyArticle|TechArticle|LiveBlogPosting|Report)$/;

/**
 * Path segments that hold stories rather than name a desk: an article under
 * /stories/ or /p/ belongs to the whole publication, not to a section called
 * "stories".
 */
const CONTAINERS = new Set([
  "a", "article", "articles", "blog", "blogs", "content", "entry", "entries", "item", "items", "n", "news-story",
  "p", "post", "posts", "s", "stories", "story", "amp", "en", "en-us", "en-gb", "us", "uk", "www",
]);

const metaContent = (html: string, key: string) => {
  for (const tag of html.match(/<meta\b[^>]*>/gi) ?? []) {
    if (!new RegExp(`(?:property|name)=["']?${key.replace(/[:.]/g, "\\$&")}["'\\s>]`, "i").test(tag)) continue;
    const value = tag.match(/content=["']([^"']*)["']/i)?.[1] ?? tag.match(/content=([^\s>]+)/i)?.[1];
    if (value) return value.trim();
  }
  return undefined;
};

/** The schema.org types a page declares in its JSON-LD. */
function jsonLdTypes(html: string): string[] {
  const types: string[] = [];
  for (const match of html.matchAll(/"@type"\s*:\s*(\[[^\]]*\]|"[^"]+")/g)) {
    for (const t of match[1].matchAll(/"([^"]+)"/g)) types.push(t[1]);
  }
  return types;
}

const decode = (s: string) =>
  s.replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#0?39;|&apos;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&#x27;/g, "'");

/** Whether a page's own markup says it is one story, and what it says about it. */
export function articleOnPage(html: string, url: string): { title?: string; section?: string } | null {
  const declared = jsonLdTypes(html).some((t) => ARTICLE_TYPES.test(t));
  const ogArticle = /^article$/i.test(metaContent(html, "og:type") ?? "");
  const published = Boolean(metaContent(html, "article:published_time"));
  // og:type alone is set on whole sites by some templates; it counts with a date, or an article-shaped address.
  if (!declared && !(ogArticle && (published || looksLikeArticlePath(url)))) return null;
  const title = metaContent(html, "og:title") ?? html.match(/<title[^>]*>([^<]*)/i)?.[1];
  const section = metaContent(html, "article:section");
  return { title: title ? decode(title).trim() : undefined, section: section ? decode(section).trim() : undefined };
}

const isDatePart = (s: string) => /^(19|20)\d\d$/.test(s) || /^\d{1,2}$/.test(s) || /^(19|20)\d\d-\d\d(-\d\d)?$/.test(s);

/**
 * Whether an address alone reads as one story — for when the page itself
 * cannot be read. Deliberately strict, since a section mistaken for a story
 * would lose the section: a dated path with something after the date, or a
 * last segment that is a long hyphenated headline.
 */
export function looksLikeArticlePath(url: string): boolean {
  let path: string;
  try {
    path = new URL(url).pathname;
  } catch {
    return false;
  }
  const parts = path.split("/").filter(Boolean);
  if (parts.length === 0) return false;
  const last = parts[parts.length - 1].replace(/\.(s?html?|php|aspx?)$/i, "");
  const dated = parts.slice(0, -1).some((p) => /^(19|20)\d\d$/.test(p) || /^(19|20)\d\d-\d\d(-\d\d)?$/.test(p));
  const words = last.split(/[-_]+/).filter((w) => /[a-z]/i.test(w));
  if (dated && words.length >= 2) return true;
  // A headline as a slug: five or more words, or four with a long id beside them.
  if (words.length >= 5) return true;
  if (words.length >= 4 && (/\d{5,}/.test(last) || parts.some((p) => /^\d{5,}$/.test(p)))) return true;
  return false;
}

/**
 * The section a story sits in, from where it is filed: the path above it,
 * dates and ids taken off. "" when the story sits straight under the site or
 * under a plain container (/stories/, /p/, /2026/10/), which means the
 * publication as a whole.
 */
export function articleSectionPath(url: string): string {
  let parts: string[];
  try {
    parts = new URL(url).pathname.split("/").filter(Boolean);
  } catch {
    return "";
  }
  parts = parts.slice(0, -1);
  // Dates and ids come after the section: /tech/2026/10/09/slug, /world/12345/slug.
  while (parts.length && (isDatePart(parts[parts.length - 1]) || /^\d{4,}$/.test(parts[parts.length - 1]))) parts.pop();
  // A path that is only dates (/2026/10/slug) leaves nothing; /stories/2026/10 leaves a container.
  if (parts.some((p) => isDatePart(p) || /^\d{4,}$/.test(p))) parts = parts.slice(0, parts.findIndex((p) => isDatePart(p) || /^\d{4,}$/.test(p)));
  while (parts.length && CONTAINERS.has(parts[parts.length - 1].toLowerCase())) parts.pop();
  if (parts.length === 0) return "";
  return `/${parts.join("/")}`;
}

/** Feeds that belong to the one story — its comments — rather than to the outlet. */
export function isPerStoryFeed(feedUrl: string, articleUrl: string): boolean {
  try {
    const feed = new URL(feedUrl);
    const article = new URL(articleUrl);
    if (/comment/i.test(feed.pathname + feed.search)) return true;
    const base = article.pathname.replace(/\/$/, "");
    return feed.host === article.host && base.length > 1 && feed.pathname.startsWith(`${base}/`);
  } catch {
    return false;
  }
}
