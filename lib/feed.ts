import { XMLParser } from "fast-xml-parser";
import { sortNewestFirst } from "./sort";
import type { Article, SourceMeta } from "./types";

/**
 * Many publishers (OpenAI among them) return 403 to anything that does not
 * look like a browser, which broke the reader on their articles. These are
 * ordinary reader requests made on the user's behalf, one page at a time.
 */
const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

export async function fetchText(url: string, timeoutMs = 12000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      headers: {
        "user-agent": UA,
        accept:
          "text/html,application/xhtml+xml,application/rss+xml,application/atom+xml," +
          "application/xml;q=0.9,*/*;q=0.8",
        "accept-language": "en-US,en;q=0.9",
      },
      redirect: "follow",
      signal: controller.signal,
    });
    if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
    return { body: await res.text(), finalUrl: res.url || url };
  } finally {
    clearTimeout(timer);
  }
}

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  trimValues: true,
  // Keep CDATA and entity text intact rather than coercing to numbers/booleans.
  parseTagValue: false,
  parseAttributeValue: false,
});

function first<T>(value: T | T[] | undefined): T | undefined {
  if (value === undefined) return undefined;
  return Array.isArray(value) ? value[0] : value;
}

function asArray<T>(value: T | T[] | undefined): T[] {
  if (value === undefined || value === null) return [];
  return Array.isArray(value) ? value : [value];
}

/** Nodes may be a plain string, or an object with #text plus attributes. */
function text(node: any): string {
  if (node === undefined || node === null) return "";
  if (typeof node === "string") return node;
  if (typeof node === "number") return String(node);
  if (typeof node === "object" && "#text" in node) return String(node["#text"]);
  return "";
}

const NAMED_ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  hellip: "…",
  mdash: "—",
  ndash: "–",
  lsquo: "\u2018",
  rsquo: "\u2019",
  ldquo: "\u201c",
  rdquo: "\u201d",
};

/**
 * Decode HTML entities. Feeds routinely double-encode, so numeric forms like
 * &#8217; and &#038; survive XML parsing and must be handled here — including
 * inside URLs, where a stray &#038; breaks the link.
 */
export function decodeEntities(input: string): string {
  return input.replace(
    /&(#[Xx][0-9A-Fa-f]+|#\d+|[A-Za-z][A-Za-z0-9]*);/g,
    (match, body: string) => {
      if (body[0] === "#") {
        const code =
          body[1] === "x" || body[1] === "X"
            ? Number.parseInt(body.slice(2), 16)
            : Number.parseInt(body.slice(1), 10);
        if (!Number.isFinite(code) || code <= 0 || code > 0x10ffff) return match;
        try {
          return String.fromCodePoint(code);
        } catch {
          return match;
        }
      }
      return NAMED_ENTITIES[body.toLowerCase()] ?? match;
    },
  );
}

export function stripHtml(html: string, max = 320) {
  const plain = decodeEntities(
    html
      .replace(/<script[\s\S]*?<\/script>/gi, "")
      .replace(/<style[\s\S]*?<\/style>/gi, "")
      .replace(/<[^>]+>/g, " "),
  )
    .replace(/\s+/g, " ")
    .trim();
  return plain.length > max ? plain.slice(0, max).trimEnd() + "…" : plain;
}

export function absolute(href: string, base: string) {
  const decoded = decodeEntities(href.trim());
  try {
    return new URL(decoded, base).toString();
  } catch {
    return decoded;
  }
}

export function firstImageIn(html: string, base: string) {
  const match = html.match(/<img[^>]+src=["']([^"']+)["']/i);
  return match ? absolute(match[1], base) : undefined;
}

export function toIso(value: string | undefined) {
  if (!value) return undefined;
  const time = Date.parse(value);
  return Number.isNaN(time) ? undefined : new Date(time).toISOString();
}

export function faviconFor(siteUrl: string) {
  let domain = siteUrl;
  try {
    domain = new URL(siteUrl).hostname;
  } catch {
    /* fall back to the raw string */
  }
  return `https://www.google.com/s2/favicons?domain=${encodeURIComponent(domain)}&sz=64`;
}

export function looksLikeFeed(body: string) {
  const head = body.slice(0, 1500).toLowerCase();
  return (
    head.includes("<rss") ||
    head.includes("<feed") ||
    head.includes("<rdf:rdf") ||
    head.includes("<?xml")
  );
}

/** Parse RSS 2.0, Atom, or RDF/RSS 1.0 into a common shape. */
export function parseFeed(
  xml: string,
  feedUrl: string,
): { meta: Omit<SourceMeta, "favicon">; articles: Article[] } {
  const doc = parser.parse(xml);
  const rss = doc.rss?.channel ?? doc["rdf:RDF"]?.channel;
  const atom = doc.feed;

  if (!rss && !atom) throw new Error("Not a recognizable RSS or Atom feed");

  if (atom) {
    const links = asArray(atom.link);
    const site =
      links.find((l: any) => l?.["@_rel"] === "alternate")?.["@_href"] ??
      links.find((l: any) => !l?.["@_rel"])?.["@_href"] ??
      feedUrl;
    const entries = asArray(atom.entry).map((entry: any) =>
      atomEntry(entry, site),
    );
    return {
      meta: {
        feedUrl,
        siteUrl: site,
        title: text(atom.title) || site,
        description: stripHtml(text(atom.subtitle), 200) || undefined,
      },
      articles: sortNewestFirst(entries),
    };
  }

  // RSS 2.0 / RDF. RDF keeps <item> as a sibling of <channel>.
  const items = asArray(rss.item ?? doc["rdf:RDF"]?.item);
  const site = text(first(rss.link)) || feedUrl;
  return {
    meta: {
      feedUrl,
      siteUrl: site,
      title: text(rss.title) || site,
      description: stripHtml(text(rss.description), 200) || undefined,
    },
    articles: sortNewestFirst(items.map((item: any) => rssItem(item, site))),
  };
}

function rssItem(item: any, site: string): Article {
  const link =
    text(item.link) ||
    item.link?.["@_href"] ||
    text(item.guid) ||
    text(item["feedburner:origLink"]) ||
    "";
  const content = text(item["content:encoded"]) || text(item.description);
  const enclosure = asArray(item.enclosure).find((e: any) =>
    String(e?.["@_type"] ?? "").startsWith("image/"),
  );
  const media =
    first(asArray(item["media:content"]).filter((m: any) => m?.["@_url"])) ??
    first(asArray(item["media:thumbnail"]).filter((m: any) => m?.["@_url"]));

  return {
    id: text(item.guid) || link || text(item.title),
    title: stripHtml(text(item.title), 200) || "(untitled)",
    link: absolute(link, site),
    author:
      text(item["dc:creator"]) || stripHtml(text(item.author), 80) || undefined,
    publishedAt: toIso(text(item.pubDate) || text(item["dc:date"])),
    summary: stripHtml(content) || undefined,
    image: pickImage(
      enclosure?.["@_url"] ?? media?.["@_url"],
      content,
      site,
    ),
  };
}

/** Prefer a declared image, falling back to the first one in the body. */
function pickImage(declared: string | undefined, content: string, site: string) {
  if (declared) return absolute(declared, site);
  return content ? firstImageIn(content, site) : undefined;
}

function atomEntry(entry: any, site: string): Article {
  const links = asArray(entry.link);
  const link =
    links.find((l: any) => l?.["@_rel"] === "alternate")?.["@_href"] ??
    links.find((l: any) => l?.["@_href"])?.["@_href"] ??
    text(entry.id);
  const content = text(entry.content) || text(entry.summary);
  return {
    id: text(entry.id) || link,
    title: stripHtml(text(entry.title), 200) || "(untitled)",
    link: absolute(link, site),
    author: text(first(asArray(entry.author))?.name) || undefined,
    publishedAt: toIso(text(entry.published) || text(entry.updated)),
    summary: stripHtml(content) || undefined,
    image: pickImage(undefined, content, site),
  };
}
