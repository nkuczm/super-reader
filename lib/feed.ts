import { XMLParser } from "fast-xml-parser";
import { sortNewestFirst } from "./sort";
import { fileKindFor } from "./files";
import type { Article, Attachment, SourceMeta } from "./types";

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

/**
 * Some feeds carry the article's whole rendered page, navigation and all, so
 * flattening it wholesale yields "Search Select Category All News ..." as the
 * summary. Drop the structural chrome before reading any text out of it.
 */
export function stripChrome(html: string) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<nav\b[\s\S]*?<\/nav>/gi, "")
    .replace(/<header\b[\s\S]*?<\/header>/gi, "")
    .replace(/<footer\b[\s\S]*?<\/footer>/gi, "")
    .replace(/<form\b[\s\S]*?<\/form>/gi, "")
    .replace(/<select\b[\s\S]*?<\/select>/gi, "")
    .replace(/<aside\b[\s\S]*?<\/aside>/gi, "")
    .replace(/<figure\b[\s\S]*?<\/figure>/gi, "");
}

/**
 * Prefer the article's own prose: with chrome gone, the paragraphs are the
 * summary. Falls back to the whole text when a feed has no markup at all.
 */
export function summarize(html: string, max = 320) {
  const cleaned = stripChrome(html);
  const paragraphs = [...cleaned.matchAll(/<p\b[^>]*>([\s\S]*?)<\/p>/gi)]
    .map((m) => stripHtml(m[1], Number.MAX_SAFE_INTEGER))
    .filter((text) => text.length > 40);

  if (paragraphs.length > 0) {
    const joined = paragraphs.join(" ");
    return joined.length > max ? `${joined.slice(0, max).trimEnd()}…` : joined;
  }
  return stripHtml(cleaned, max);
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

/** Feeds are full of 1x1 beacons; treat those as no image at all. */
export function isTrackingPixel(url: string) {
  return (
    /(^|[\/_.-])(pixel|beacon|spacer|blank|dot|1x1|track(ing)?)([._-]|\.|$)/i.test(url) ||
    /\b(width|w|h|height)=1\b/i.test(url) ||
    /feedburner|feedsportal|doubleclick|scorecardresearch|stats\./i.test(url)
  );
}

export function firstImageIn(html: string, base: string) {
  for (const match of html.matchAll(/<img[^>]+src=["']([^"']+)["'][^>]*>/gi)) {
    const src = decodeEntities(match[1]);
    if (isTrackingPixel(src)) continue;
    // Explicitly tiny images are decoration, not the article's picture.
    if (/(?:width|height)=["']?([1-9]?\d)["']?[\s>]/i.test(match[0])) continue;
    return absolute(src, base);
  }
  return undefined;
}

export function toIso(value: string | undefined) {
  if (!value) return undefined;
  const time = Date.parse(value);
  return Number.isNaN(time) ? undefined : new Date(time).toISOString();
}

/**
 * News aggregators wrap article links in their own redirector. Most carry the
 * real destination in a query parameter, so the reader can go straight to the
 * publisher instead of bouncing through a middleman.
 */
export function unwrapRedirect(url: string): string {
  let current = url;

  for (let depth = 0; depth < 3; depth += 1) {
    let parsed: URL;
    try {
      parsed = new URL(current);
    } catch {
      return current;
    }

    const host = parsed.hostname.replace(/^www\./, "");
    const isRedirector =
      /^(bing\.com|google\.com|news\.google\.com|duckduckgo\.com|l\.facebook\.com|out\.reddit\.com)$/.test(host) ||
      /\/(apiclick\.aspx|url|redirect|r\.php)$/i.test(parsed.pathname);
    if (!isRedirector) return current;

    const target = ["url", "u", "q", "target", "redirect"]
      .map((key) => parsed.searchParams.get(key))
      .find((value) => value && /^https?:\/\//i.test(value));

    if (!target) return current;
    current = target;
  }
  return current;
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

/**
 * The full article text a feed carries for one of its entries, when it has
 * one. Publishers that syndicate full text are handing it over deliberately,
 * which makes this the right fallback when their site refuses to be read.
 */
export async function fetchFeedItemContent(
  feedUrl: string,
  articleUrl: string,
): Promise<string | null> {
  const { body } = await fetchText(feedUrl, 10000);
  if (!looksLikeFeed(body)) return null;

  const doc = parser.parse(body);
  const channel = doc.rss?.channel ?? doc["rdf:RDF"]?.channel;
  const items = channel
    ? asArray(channel.item ?? doc["rdf:RDF"]?.item)
    : asArray(doc.feed?.entry);

  const wanted = articleUrl.replace(/\/$/, "");

  for (const item of items) {
    const links = [
      text(item.link),
      item.link?.["@_href"],
      ...asArray(item.link).map((l: any) => l?.["@_href"]),
      text(item.guid),
      text(item.id),
    ].filter(Boolean) as string[];

    if (!links.some((l) => decodeEntities(l).replace(/\/$/, "") === wanted)) {
      continue;
    }

    const content =
      text(item["content:encoded"]) ||
      text(item.content) ||
      text(item.description) ||
      text(item.summary);

    // A one-line teaser is not the article; only full text is worth showing
    // in place of the page itself.
    const plain = stripHtml(stripChrome(content), Number.MAX_SAFE_INTEGER);
    return plain.length >= 1200 ? content : null;
  }
  return null;
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
  const enclosure = asArray(item.enclosure).find(
    (e: any) =>
      String(e?.["@_type"] ?? "").startsWith("image/") &&
      e?.["@_url"] &&
      !isTrackingPixel(String(e["@_url"])),
  );

  // media:content can appear bare or nested inside a media:group, and a feed
  // may offer several sizes — take the widest real image.
  const mediaCandidates = [
    ...asArray(item["media:content"]),
    ...asArray(item["media:group"]).flatMap((g: any) =>
      asArray(g?.["media:content"]),
    ),
    ...asArray(item["media:thumbnail"]),
    ...asArray(item["itunes:image"]),
  ].filter(
    (m: any) =>
      m?.["@_url"] &&
      !isTrackingPixel(String(m["@_url"])) &&
      !String(m["@_medium"] ?? m["@_type"] ?? "image").startsWith("video"),
  );

  const media = mediaCandidates.sort(
    (a: any, b: any) =>
      (Number.parseInt(b["@_width"], 10) || 0) -
      (Number.parseInt(a["@_width"], 10) || 0),
  )[0];

  return {
    id: text(item.guid) || link || text(item.title),
    title: stripHtml(text(item.title), 200) || "(untitled)",
    link: unwrapRedirect(absolute(link, site)),
    author:
      text(item["dc:creator"]) || stripHtml(text(item.author), 80) || undefined,
    publishedAt: toIso(text(item.pubDate) || text(item["dc:date"])),
    summary: summarize(content) || undefined,
    image: pickImage(
      enclosure?.["@_url"] ?? media?.["@_url"],
      content,
      site,
    ),
    attachments: attachmentsFrom(asArray(item.enclosure), site),
  };
}

/**
 * Enclosures that are files worth reading. A feed's declared type is the
 * better signal than the URL, and an image enclosure is left to pickImage.
 */
function attachmentsFrom(nodes: any[], site: string): Attachment[] | undefined {
  const found: Attachment[] = [];
  for (const node of nodes) {
    const url = node?.["@_url"] ?? node?.["@_href"];
    if (!url) continue;
    const kind = fileKindFor(String(url), node?.["@_type"]);
    if (!kind) continue;
    const absoluteUrl = absolute(String(url), site);
    if (found.some((a) => a.url === absoluteUrl)) continue;
    const bytes = Number.parseInt(node?.["@_length"], 10);
    found.push({
      url: absoluteUrl,
      kind,
      ...(node?.["@_title"] ? { title: String(node["@_title"]) } : {}),
      ...(Number.isFinite(bytes) && bytes > 0 ? { bytes } : {}),
    });
  }
  return found.length > 0 ? found.slice(0, 6) : undefined;
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
  const enclosures = links.filter((l: any) => l?.["@_rel"] === "enclosure");
  return {
    id: text(entry.id) || link,
    attachments: attachmentsFrom(enclosures, site),
    title: stripHtml(text(entry.title), 200) || "(untitled)",
    link: unwrapRedirect(absolute(link, site)),
    author: text(first(asArray(entry.author))?.name) || undefined,
    publishedAt: toIso(text(entry.published) || text(entry.updated)),
    summary: summarize(content) || undefined,
    image: pickImage(undefined, content, site),
  };
}
