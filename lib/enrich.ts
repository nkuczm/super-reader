import {
  fetchText,
  stripHtml,
  absolute,
  toIso,
  decodeEntities,
  isTrackingPixel,
  firstImageIn,
} from "./feed";
import type { Article } from "./types";
import { titleFromSlug } from "./sitemap";

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

async function enrichOne(
  article: Article,
  { siteDescription, preferPageDates }: EnrichOptions = {},
): Promise<Article> {
  try {
    const { body, finalUrl } = await fetchText(article.link, 9000);
    // Metadata lives in <head>; ignore the rest of a potentially huge page.
    const head = body.slice(0, 60_000);

    const summary =
      article.summary ??
      (() => {
        const raw = metaTag(head, [
          "og:description",
          "twitter:description",
          "description",
        ]);
        if (!raw) return undefined;
        const text = stripHtml(raw);
        // Sites fall back to one boilerplate description for pages that have
        // none of their own; repeating it under every headline is just noise.
        if (siteDescription && normalize(text) === normalize(siteDescription)) {
          return undefined;
        }
        return text;
      })();

    const image =
      article.image ??
      (() => {
        const raw = metaTag(head, [
          "og:image",
          "og:image:secure_url",
          "twitter:image",
          "twitter:image:src",
        ]);
        if (raw && !isTrackingPixel(raw)) return absolute(raw, finalUrl);
        // No social image: fall back to the first real picture in the body.
        return firstImageIn(body, finalUrl);
      })();

    const published = toIso(metaTag(head, ["article:published_time", "datePublished"]));
    const publishedAt = preferPageDates
      ? (published ?? article.publishedAt)
      : (article.publishedAt ??
        published ??
        toIso(metaTag(head, ["article:modified_time"])));

    /*
     * A headline made up from the URL's slug — all a plain sitemap has —
     * gives way to the page's own. "Economic policy for agi" is legible;
     * "Economic Policy for AGI" is the title.
     */
    const title =
      article.title && article.title !== titleFromSlug(article.link)
        ? article.title
        : (() => {
            const own = metaTag(head, ["og:title", "twitter:title"]);
            return own ? stripHtml(own) : article.title;
          })();

    return { ...article, title, summary, image, publishedAt };
  } catch {
    // A source that blocks us, or a slow page, must not fail the whole feed.
    return article;
  }
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
