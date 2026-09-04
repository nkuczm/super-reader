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

/**
 * Listing pages rarely carry a summary for every card, so fill the gaps from
 * each article's own metadata. Only the <head> is needed, which keeps this far
 * cheaper than a full readability parse.
 */
function metaTag(html: string, names: string[]) {
  for (const name of names) {
    const pattern = new RegExp(
      `<meta[^>]+(?:property|name)=["']${name}["'][^>]*>`,
      "i",
    );
    const tag = html.match(pattern)?.[0];
    const content = tag?.match(/content=["']([^"']*)["']/i)?.[1];
    if (content?.trim()) return decodeEntities(content.trim());
  }
  return undefined;
}

function normalize(text: string) {
  return text.replace(/\s+/g, " ").trim().toLowerCase();
}

async function enrichOne(
  article: Article,
  siteDescription?: string,
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

    const publishedAt =
      article.publishedAt ??
      toIso(
        metaTag(head, [
          "article:published_time",
          "datePublished",
          "article:modified_time",
        ]),
      );

    return { ...article, summary, image, publishedAt };
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
  }: { max?: number; concurrency?: number; siteDescription?: string } = {},
): Promise<Article[]> {
  const needs = (a: Article) => !a.image || !a.summary;

  const byIndex = new Map<number, Article>();
  const queue: { index: number; article: Article }[] = [];
  articles.forEach((article, index) => {
    if (needs(article) && queue.length < max) queue.push({ index, article });
  });

  for (let i = 0; i < queue.length; i += concurrency) {
    const batch = queue.slice(i, i + concurrency);
    const filled = await Promise.all(
      batch.map((item) => enrichOne(item.article, siteDescription)),
    );
    filled.forEach((article, offset) => byIndex.set(batch[offset].index, article));
  }

  return articles.map((article, index) => byIndex.get(index) ?? article);
}
