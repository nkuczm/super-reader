import {
  fetchText,
  stripHtml,
  absolute,
  toIso,
  decodeEntities,
  isTrackingPixel,
  firstImageIn,
} from "./feed";
import { readEnriched, writeEnriched, type Enrichment } from "./enrich-cache";
import { canonicalUrl } from "./url";
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

/**
 * Read one article's own metadata. What comes back is about the page and
 * nothing else — no reference to the feed it was reached through — which is
 * what makes it safe to keep in a cache shared by every source and reader.
 */
async function lookupOne(url: string, timeoutMs: number): Promise<Enrichment> {
  try {
    const { body, finalUrl } = await fetchText(url, timeoutMs);
    // Metadata lives in <head>; ignore the rest of a potentially huge page.
    const head = body.slice(0, 60_000);

    const rawSummary = metaTag(head, [
      "og:description",
      "twitter:description",
      "description",
    ]);

    const rawImage = metaTag(head, [
      "og:image",
      "og:image:secure_url",
      "twitter:image",
      "twitter:image:src",
    ]);
    const image =
      rawImage && !isTrackingPixel(rawImage)
        ? absolute(rawImage, finalUrl)
        : // No social image: fall back to the first real picture in the body.
          firstImageIn(body, finalUrl);

    return {
      summary: rawSummary ? stripHtml(rawSummary) : undefined,
      image,
      publishedAt: toIso(
        metaTag(head, [
          "article:published_time",
          "datePublished",
          "article:modified_time",
        ]),
      ),
    };
  } catch {
    // A source that blocks us, or a slow page, must not fail the whole feed —
    // and is worth recording as "nothing here". Paying the timeout again for
    // the same dead link on every refresh is the worst case there is, and the
    // short miss TTL means a site having a bad morning is tried again soon.
    return {};
  }
}

/**
 * Merge what a page yielded into the article. The article's own values always
 * win: a feed that stated a summary knows better than the page's social card.
 */
function applyEnrichment(
  article: Article,
  found: Enrichment,
  siteDescription?: string,
): Article {
  const summary =
    article.summary ??
    (() => {
      if (!found.summary) return undefined;
      // Sites fall back to one boilerplate description for pages that have
      // none of their own; repeating it under every headline is just noise.
      // Checked here rather than when the page was read, because it is a fact
      // about this source and not about the article.
      if (siteDescription && normalize(found.summary) === normalize(siteDescription)) {
        return undefined;
      }
      return found.summary;
    })();

  return {
    ...article,
    summary,
    image: article.image ?? found.image,
    publishedAt: article.publishedAt ?? found.publishedAt,
  };
}

/**
 * Fill gaps in small batches so we never fan out dozens of requests at once.
 * Only articles actually missing something are fetched, which keeps a feed
 * that already carries images and summaries free.
 *
 * Two things bound the cost. Anything looked up before comes from the cache
 * with no request at all, which is what makes the second refresh of a feed
 * quick. What is left runs against a deadline: when the budget is spent the
 * remaining articles are returned as they came, because a list that is
 * missing a few thumbnails now beats a complete one half a minute from now.
 */
export async function enrichArticles(
  articles: Article[],
  {
    max = 15,
    concurrency = 5,
    siteDescription,
    budgetMs = 4000,
    perRequestMs = 2500,
  }: {
    max?: number;
    concurrency?: number;
    siteDescription?: string;
    /** How long the whole gap-filling pass may take. */
    budgetMs?: number;
    /**
     * How long one page may take. Waves are spent in units of this, so it is
     * also the granularity of the budget above — and a page that cannot
     * answer within it is not worth a refresh waiting on.
     */
    perRequestMs?: number;
  } = {},
): Promise<Article[]> {
  const needs = (a: Article) => !a.image || !a.summary;

  const queue: { index: number; article: Article }[] = [];
  articles.forEach((article, index) => {
    if (needs(article) && queue.length < max) queue.push({ index, article });
  });
  if (queue.length === 0) return articles;

  const byIndex = new Map<number, Article>();

  // Keyed by the app's own idea of article identity, so the same story
  // reached through two feeds with different tracking parameters is looked up
  // once rather than twice. The fetch below still uses the real link.
  const keyOf = (item: { article: Article }) => canonicalUrl(item.article.link);

  // Everything already known, in one round trip rather than one per article.
  const cached = await readEnriched(queue.map(keyOf));
  const outstanding: { index: number; article: Article }[] = [];
  for (const item of queue) {
    const hit = cached.get(keyOf(item));
    if (hit) {
      byIndex.set(item.index, applyEnrichment(item.article, hit, siteDescription));
    } else {
      outstanding.push(item);
    }
  }

  const deadline = Date.now() + budgetMs;
  const fresh: { url: string; found: Enrichment }[] = [];

  for (let i = 0; i < outstanding.length; i += concurrency) {
    // A wave is only started if it can run to full length. That keeps the
    // whole pass inside the budget, and — the reason it is written this way —
    // means every lookup that does run gets a fair trial. A wave squeezed
    // into the last few hundred milliseconds would time out on five perfectly
    // good pages and file them below as having nothing on them, which is far
    // worse than not looking at all.
    if (deadline - Date.now() < perRequestMs) break;

    const batch = outstanding.slice(i, i + concurrency);
    const results = await Promise.all(
      batch.map((item) => lookupOne(item.article.link, perRequestMs)),
    );

    results.forEach((found, offset) => {
      const item = batch[offset];
      byIndex.set(item.index, applyEnrichment(item.article, found, siteDescription));
      // Worth keeping either way — including that the page yielded nothing,
      // which is what stops a dead link costing a timeout on every refresh.
      fresh.push({ url: keyOf(item), found });
    });
  }

  // Awaited, not fired and forgotten: a serverless function can be frozen the
  // moment it responds, and a cache write that never lands leaves the next
  // refresh paying for the same page fetches — which is the whole point of
  // having one. It is a single round trip against a budget of seconds, and it
  // swallows its own failures.
  await writeEnriched(fresh);

  return articles.map((article, index) => byIndex.get(index) ?? article);
}
