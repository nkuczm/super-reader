import {
  fetchText,
  isAggregatorFeed,
  stripHtml,
  absolute,
  toIso,
  decodeEntities,
  isTrackingPixel,
  firstImageIn,
} from "./feed";
import { isChallengeHtml } from "./challenge";
import type { Article } from "./types";
import { titleFromSlug } from "./sitemap";
import { OUTLETS, isResearchCategory } from "./outlets";

/**
 * Sources whose article pages are not read for a picture or a summary.
 *
 * A journal's papers: the publishers' pages refuse a server or answer with a
 * bot check (§8, measured 11 Oct 2026), so fifteen page reads a journal
 * brought back nothing. Measured again 12 Oct 2026 from production: ten Wiley
 * journals, 495 papers, not one picture. Their feeds carry the abstract.
 */
const PAPER_FEEDS = new Set(OUTLETS.filter((outlet) => isResearchCategory(outlet.category)).map((outlet) => outlet.feedUrl));

/**
 * Whether to read a source's article pages at all. Not a paper (above), and
 * not an aggregator's links: Google's link is a token only a browser can
 * resolve (§2), and ten Google News sources, 889 stories, came back with no
 * picture between them (12 Oct 2026).
 */
export function readsPages(feedUrl: string) {
  return !PAPER_FEEDS.has(feedUrl) && !isAggregatorFeed(feedUrl);
}

/**
 * Listing pages rarely carry a summary for every card, so fill the gaps from
 * each article's own metadata. Only the <head> is needed, which keeps this far
 * cheaper than a full readability parse.
 */
/**
 * Read one <meta> value, quoted or not.
 *
 * Minified HTML drops the quotes from any attribute value without a space in
 * it — `<meta property=og:title content="…">`, and `content=` may come first.
 * institute.deepmind.com ships exactly that, and requiring quotes meant every
 * page on it read as having no metadata at all.
 */
function metaTag(html: string, names: string[]) {
  for (const name of names) {
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const pattern = new RegExp(
      `<meta\\b[^>]*\\b(?:property|name|itemprop)\\s*=\\s*["']?${escaped}["']?(?=[\\s/>])[^>]*>`,
      "i",
    );
    const tag = html.match(pattern)?.[0];
    const match = tag?.match(/\bcontent\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+))/i);
    const content = match?.[1] ?? match?.[2] ?? match?.[3];
    if (content?.trim()) return decodeEntities(content.trim());
  }
  return undefined;
}

function normalize(text: string) {
  return text.replace(/\s+/g, " ").trim().toLowerCase();
}

type EnrichOptions = {
  siteDescription?: string;
  /**
   * For entries read from a plain sitemap, whose only date is `lastmod` — the
   * last time the page was *touched*, which drifts forward with every
   * correction (§3). The page's own `article:published_time` is the truth
   * where it exists, so it replaces the sitemap's date rather than only
   * filling a gap.
   */
  preferPageDates?: boolean;
};

/** What a story's page says about itself, read from its <head>. */
type PageFacts = { description?: string; image?: string; published?: string; modified?: string; title?: string };

/*
 * Pages already read, kept while the server instance lives. Every refresh,
 * on every device, used to read the same stories' pages again for the same
 * picture and summary — fetching, decompressing and scanning a few hundred
 * kilobytes each, which is server CPU the free plan counts (3 Nov 2026).
 * What a page said is kept for half a day; a page that would not answer is
 * asked again after two hours.
 */
const pages = new Map<string, { at: number; facts: PageFacts | null }>();
const READ_FOR_MS = 12 * 60 * 60 * 1000;
const FAILED_FOR_MS = 2 * 60 * 60 * 1000;
const PAGES_HELD = 4000;

async function pageFacts(link: string): Promise<PageFacts | null> {
  const held = pages.get(link);
  if (held && Date.now() - held.at < (held.facts ? READ_FOR_MS : FAILED_FOR_MS)) return held.facts;
  let facts: PageFacts | null = null;
  try {
    const { body, finalUrl } = await fetchText(link, 9000);
    // A bot or cookie check where the article should be says nothing about it.
    if (!isChallengeHtml(body, finalUrl)) {
      // Metadata lives in <head>; ignore the rest of a potentially huge page.
      const head = body.slice(0, 60_000);
      const description = metaTag(head, ["og:description", "twitter:description", "description"]);
      const social = metaTag(head, ["og:image", "og:image:secure_url", "twitter:image", "twitter:image:src"]);
      const title = metaTag(head, ["og:title", "twitter:title"]);
      facts = {
        ...(description ? { description: stripHtml(description) } : {}),
        // No social image: the first real picture in the body.
        image: social && !isTrackingPixel(social) ? absolute(social, finalUrl) : firstImageIn(body, finalUrl),
        published: toIso(metaTag(head, ["article:published_time", "datePublished"])),
        modified: toIso(metaTag(head, ["article:modified_time"])),
        ...(title ? { title: stripHtml(title) } : {}),
      };
    }
  } catch {
    // A slow page or one that refuses us: nothing to add, and not asked again for a while.
  }
  if (pages.size >= PAGES_HELD) pages.delete(pages.keys().next().value!);
  pages.set(link, { at: Date.now(), facts });
  return facts;
}

async function enrichOne(
  article: Article,
  { siteDescription, preferPageDates }: EnrichOptions = {},
): Promise<Article> {
  const facts = await pageFacts(article.link);
  // A source that blocks us, or a slow page, must not fail the whole feed.
  if (!facts) return article;

  // Sites fall back to one boilerplate description for pages that have
  // none of their own; repeating it under every headline is just noise.
  const summary =
    article.summary ??
    (facts.description && !(siteDescription && normalize(facts.description) === normalize(siteDescription))
      ? facts.description
      : undefined);
  const image = article.image ?? facts.image;
  const publishedAt = preferPageDates
    ? (facts.published ?? article.publishedAt)
    : (article.publishedAt ?? facts.published ?? facts.modified);
  /*
   * A headline made up from the URL's slug — all a plain sitemap has —
   * gives way to the page's own. "Economic policy for agi" is legible;
   * "Economic Policy for AGI" is the title.
   */
  const title = article.title && article.title !== titleFromSlug(article.link) ? article.title : (facts.title ?? article.title);

  return { ...article, title, summary, image, publishedAt };
}

/**
 * Fill gaps in small batches so we never fan out dozens of requests at once.
 * Only articles actually missing something are fetched, which keeps a feed
 * that already carries images and summaries free.
 */
export async function enrichArticles(
  articles: Article[],
  {
    max = 15,
    concurrency = 5,
    siteDescription,
    preferPageDates,
  }: { max?: number; concurrency?: number } & EnrichOptions = {},
): Promise<Article[]> {
  const needs = (a: Article) =>
    !a.image || !a.summary || preferPageDates || a.title === titleFromSlug(a.link);

  const byIndex = new Map<number, Article>();
  const queue: { index: number; article: Article }[] = [];
  articles.forEach((article, index) => {
    if (needs(article) && queue.length < max) queue.push({ index, article });
  });

  for (let i = 0; i < queue.length; i += concurrency) {
    const batch = queue.slice(i, i + concurrency);
    const filled = await Promise.all(
      batch.map((item) => enrichOne(item.article, { siteDescription, preferPageDates })),
    );
    filled.forEach((article, offset) => byIndex.set(batch[offset].index, article));
  }

  return articles.map((article, index) => byIndex.get(index) ?? article);
}
