import { fetchText, stripHtml, absolute, toIso, decodeEntities } from "./feed";
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
        const raw = metaTag(head, ["og:image", "twitter:image"]);
        return raw ? absolute(raw, finalUrl) : undefined;
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

/** Enrich in small batches so we never fan out dozens of requests at once. */
export async function enrichArticles(
  articles: Article[],
  {
    max = 15,
    concurrency = 5,
    siteDescription,
  }: { max?: number; concurrency?: number; siteDescription?: string } = {},
): Promise<Article[]> {
  const targets = articles.slice(0, max);
  const rest = articles.slice(max);
  const done: Article[] = [];

  for (let i = 0; i < targets.length; i += concurrency) {
    const batch = targets.slice(i, i + concurrency);
    done.push(
      ...(await Promise.all(batch.map((a) => enrichOne(a, siteDescription)))),
    );
  }
  return [...done, ...rest];
}
