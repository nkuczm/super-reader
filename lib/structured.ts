/**
 * What a page says about itself, rather than what we guess from its links.
 *
 * Nearly every modern publisher ships a JSON-LD block describing the page:
 * an ItemList of what is on a section front, or an Article record for a
 * single story. It is there for search engines, it is maintained because
 * ranking depends on it, and it contains exactly the structured listing the
 * link-group scraper is reverse-engineering from anchors.
 *
 * Measured from the deployment: the New York Times ships ItemList, TechCrunch
 * ships CollectionPage with a WebSite/SearchAction, the Verge ships two
 * blocks. Reading these before falling back to heuristics turns a guess into
 * a reading, and — via SearchAction — tells us the site's own search URL,
 * which is the best route there is to articles matching a query.
 */

import { absolute, stripHtml, toIso } from "./feed";
import type { Article } from "./types";

/** Every JSON-LD block on a page, parsed, with the unparseable skipped. */
export function jsonLdBlocks(html: string): unknown[] {
  const blocks: unknown[] = [];
  const pattern =
    /<script\b[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(html))) {
    const raw = match[1].trim().replace(/^<!\[CDATA\[|\]\]>$/g, "");
    try {
      blocks.push(JSON.parse(raw));
    } catch {
      // Publishers ship invalid JSON-LD more often than you would expect;
      // one bad block must not cost us the good ones on the same page.
    }
  }
  return blocks;
}

function typesOf(node: Record<string, unknown>): string[] {
  const value = node["@type"];
  if (typeof value === "string") return [value];
  if (Array.isArray(value)) return value.filter((v): v is string => typeof v === "string");
  return [];
}

const ARTICLE_TYPES =
  /^(News)?Article$|^BlogPosting$|^Report$|^ScholarlyArticle$|^LiveBlogPosting$|^SocialMediaPosting$|^TechArticle$|^OpinionNewsArticle$|^ReportageNewsArticle$/i;

/** Walk everything — @graph, arrays, nested lists — and hand back every node. */
function* walk(value: unknown, depth = 0): Generator<Record<string, unknown>> {
  if (depth > 6 || value === null || typeof value !== "object") return;
  if (Array.isArray(value)) {
    for (const entry of value) yield* walk(entry, depth + 1);
    return;
  }
  const node = value as Record<string, unknown>;
  yield node;
  for (const key of ["@graph", "itemListElement", "item", "mainEntity", "mainEntityOfPage", "blogPost", "hasPart", "potentialAction", "about"]) {
    if (key in node) yield* walk(node[key], depth + 1);
  }
}

function textOf(value: unknown): string | undefined {
  if (typeof value === "string") return stripHtml(value, 400) || undefined;
  if (Array.isArray(value)) return textOf(value[0]);
  if (value && typeof value === "object") {
    const node = value as Record<string, unknown>;
    return textOf(node.name ?? node.headline ?? node["@value"]);
  }
  return undefined;
}

function urlOf(value: unknown): string | undefined {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return urlOf(value[0]);
  if (value && typeof value === "object") {
    const node = value as Record<string, unknown>;
    return urlOf(node.url ?? node["@id"] ?? node.contentUrl);
  }
  return undefined;
}

/**
 * Articles a page declares about itself.
 *
 * Both shapes are handled because both are common: an ItemList whose members
 * are bare URLs with positions (the NYT front), and full Article records
 * embedded for each card (most blogs). A member that is only a URL still
 * counts — a link the page declares as list content is a far better candidate
 * than a link found in the markup.
 */
export function articlesFromStructured(html: string, base: string): Article[] {
  const found = new Map<string, Article>();

  const add = (link: string | undefined, article: Partial<Article>) => {
    if (!link) return;
    let absoluteLink: string;
    try {
      absoluteLink = absolute(link, base);
      new URL(absoluteLink);
    } catch {
      return;
    }
    const existing = found.get(absoluteLink);
    // A later, richer record wins over an earlier bare URL.
    found.set(absoluteLink, {
      id: absoluteLink,
      link: absoluteLink,
      title: article.title || existing?.title || "",
      publishedAt: article.publishedAt ?? existing?.publishedAt,
      summary: article.summary ?? existing?.summary,
      image: article.image ?? existing?.image,
      author: article.author ?? existing?.author,
    });
  };

  for (const block of jsonLdBlocks(html)) {
    for (const node of walk(block)) {
      const types = typesOf(node);

      if (types.some((type) => ARTICLE_TYPES.test(type))) {
        add(urlOf(node.url ?? node.mainEntityOfPage ?? node["@id"]), {
          title: textOf(node.headline ?? node.name) ?? "",
          publishedAt: toIso(
            typeof node.datePublished === "string"
              ? node.datePublished
              : typeof node.dateModified === "string"
                ? node.dateModified
                : undefined,
          ),
          summary: textOf(node.description ?? node.abstract),
          image: urlOf(node.image ?? node.thumbnailUrl),
          author: textOf(node.author),
        });
        continue;
      }

      // A ListItem wrapping a URL: the shape a section front uses.
      if (types.includes("ListItem")) {
        const item = node.item;
        if (typeof item === "string") add(item, { title: textOf(node.name) ?? "" });
        else if (item && typeof item === "object") {
          const inner = item as Record<string, unknown>;
          add(urlOf(inner.url ?? inner["@id"]), {
            title: textOf(inner.headline ?? inner.name ?? node.name) ?? "",
            publishedAt: toIso(
              typeof inner.datePublished === "string" ? inner.datePublished : undefined,
            ),
            summary: textOf(inner.description),
            image: urlOf(inner.image),
          });
        } else if (typeof node.url === "string") {
          add(node.url, { title: textOf(node.name) ?? "" });
        }
      }
    }
  }

  return [...found.values()].filter((article) => article.link);
}

/**
 * The site's own search URL, as the site declares it.
 *
 * schema.org's SearchAction exists so that search engines can offer a site
 * search box. It tells us, in the publisher's own words, how to ask their
 * archive a question — which beats guessing query parameters, and beats
 * asking a general search engine about a site it may barely have indexed.
 */
export function searchTemplateFrom(html: string): string | undefined {
  for (const block of jsonLdBlocks(html)) {
    for (const node of walk(block)) {
      if (!typesOf(node).includes("SearchAction")) continue;
      const target = node.target;
      const template =
        typeof target === "string"
          ? target
          : target && typeof target === "object"
            ? urlOf((target as Record<string, unknown>).urlTemplate ?? target)
            : undefined;
      if (template && template.includes("{") && /^https?:/i.test(template)) return template;
    }
  }
  return undefined;
}
