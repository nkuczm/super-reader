import {
  stripHtml,
  absolute,
  toIso,
  decodeEntities,

} from "./feed";
import { sortNewestFirst } from "./sort";
import type { Article, SourceMeta } from "./types";

/**
 * Build a feed from a plain HTML listing page — what a site without RSS gives
 * us. The idea: a listing page links to its articles many times over in a
 * consistent shape ("/news/<slug>"), while navigation and footer links are
 * one-offs scattered across unrelated paths. So we group every link by the
 * directory it lives in and keep the biggest group that looks like content.
 */

type Candidate = {
  url: string;
  title: string;
  summary?: string;
  image?: string;
  publishedAt?: string;
  group: string;
};

const SKIP_SEGMENTS = new Set([
  "tag", "tags", "category", "categories", "author", "authors", "page",
  "search", "login", "signin", "signup", "privacy", "terms", "cookies",
  "contact", "about", "careers", "pricing", "legal", "rss", "feed",
]);

const ANCHOR = /<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;

/** Strip chrome that never contains the article list. */
function stripNonContent(html: string) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<nav\b[\s\S]*?<\/nav>/gi, "")
    .replace(/<header\b[\s\S]*?<\/header>/gi, "")
    .replace(/<footer\b[\s\S]*?<\/footer>/gi, "");
}

function metaContent(html: string, property: string) {
  const pattern = new RegExp(
    `<meta[^>]+(?:property|name)=["']${property}["'][^>]*>`,
    "i",
  );
  const tag = html.match(pattern)?.[0];
  const value = tag?.match(/content=["']([^"']*)["']/i)?.[1];
  return value ? decodeEntities(value) : undefined;
}

const DATEISH =
  /^(?:\d{1,2}\s+)?(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\.?\s+\d{1,2},?\s*\d{0,4}$|^\d{4}-\d{2}-\d{2}$|^\d{1,2}\/\d{1,2}\/\d{2,4}$/i;

/**
 * Pull the headline out of a listing card. Cards commonly stack a date, a
 * category label and the headline inside one <a>, so taking the anchor's whole
 * text yields "Sep 1, 2026 Announcements Real Title". Prefer a real heading;
 * otherwise split the card into its text chunks and take the longest one,
 * which is the headline in practice — labels and dates are short.
 */
function cardText(innerHtml: string): { title: string; summary?: string } {
  const chunks = innerHtml
    .split(/<[^>]+>/)
    .map((chunk) => stripHtml(chunk, 400))
    .filter((chunk) => chunk.length > 0 && !DATEISH.test(chunk));

  const heading = innerHtml.match(/<(h[1-6])\b[^>]*>([\s\S]*?)<\/\1>/i)?.[2];
  const asHeading = heading ? stripHtml(heading, 200) : "";

  // With a real heading the title is settled; otherwise the longest chunk is
  // the headline, since labels and dates are short.
  const title =
    asHeading.length >= 8
      ? asHeading
      : chunks.reduce((best, c) => (c.length > best.length ? c : best), "");

  // A richer "featured" card also carries a blurb: the longest remaining chunk
  // that is clearly prose rather than a category label.
  const summary = chunks
    .filter((c) => c !== title && c.length >= 60)
    .reduce((best, c) => (c.length > best.length ? c : best), "");

  return {
    title: title || stripHtml(innerHtml, 200),
    summary: summary || undefined,
  };
}

const DATE_PATTERNS = [
  // <time datetime="..."> is the most reliable signal when present.
  /<time[^>]+datetime=["']([^"']+)["']/i,
  /\b(\d{4}-\d{2}-\d{2})\b/,
  /\b((?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\.?\s+\d{1,2},?\s+\d{4})\b/i,
  /\b(\d{1,2}\s+(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\.?\s+\d{4})\b/i,
];

function dateFrom(innerHtml: string, url: string) {
  for (const pattern of DATE_PATTERNS) {
    const raw = innerHtml.match(pattern)?.[1];
    const iso = toIso(raw);
    if (iso) return iso;
  }
  // Many CMSs encode the date in the URL: /2026/09/04/slug
  const fromUrl = url.match(/\/(20\d{2})\/(\d{1,2})(?:\/(\d{1,2}))?\//);
  if (fromUrl) {
    const [, y, m, d] = fromUrl;
    return toIso(`${y}-${m.padStart(2, "0")}-${(d ?? "01").padStart(2, "0")}`);
  }
  return undefined;
}

function groupOf(pathname: string) {
  const parts = pathname.split("/").filter(Boolean);
  // The "directory" the article sits in: /news/foo -> /news, /foo -> /
  return parts.length <= 1 ? "/" : `/${parts.slice(0, -1).join("/")}`;
}

function collect(html: string, pageUrl: string): Candidate[] {
  const page = new URL(pageUrl);
  const seen = new Set<string>();
  const out: Candidate[] = [];

  for (const match of stripNonContent(html).matchAll(ANCHOR)) {
    const [, href, inner] = match;
    if (/^(#|mailto:|tel:|javascript:)/i.test(href.trim())) continue;

    let url: URL;
    try {
      url = new URL(decodeEntities(href.trim()), pageUrl);
    } catch {
      continue;
    }
    if (url.origin !== page.origin) continue;

    // Drop the listing page itself and anything above it.
    url.hash = "";
    const clean = url.toString();
    if (url.pathname === page.pathname) continue;
    if (seen.has(clean)) continue;

    const segments = url.pathname.split("/").filter(Boolean);
    if (segments.length === 0) continue;
    if (segments.some((s) => SKIP_SEGMENTS.has(s.toLowerCase()))) continue;
    // A slug — the last segment of an article URL — is rarely one short word.
    const slug = segments[segments.length - 1];
    if (slug.length < 6) continue;

    const { title, summary } = cardText(inner);
    if (title.length < 12) continue;

    seen.add(clean);
    out.push({
      url: clean,
      title,
      summary,
      image: firstImage(inner, pageUrl),
      publishedAt: dateFrom(inner, url.pathname),
      group: groupOf(url.pathname),
    });
  }
  return out;
}

function firstImage(innerHtml: string, base: string) {
  const src =
    innerHtml.match(/<img[^>]+src=["']([^"']+)["']/i)?.[1] ??
    innerHtml.match(/<source[^>]+srcset=["']([^"'\s,]+)/i)?.[1];
  if (!src || src.startsWith("data:")) return undefined;
  return absolute(src, base);
}

export function scrapePage(
  html: string,
  pageUrl: string,
): { meta: Omit<SourceMeta, "favicon">; articles: Article[] } {
  const candidates = collect(html, pageUrl);
  if (candidates.length === 0) {
    throw new Error(
      "No feed found, and no article links could be read from that page.",
    );
  }

  const byGroup = new Map<string, Candidate[]>();
  for (const candidate of candidates) {
    const list = byGroup.get(candidate.group) ?? [];
    list.push(candidate);
    byGroup.set(candidate.group, list);
  }

  const pagePath = new URL(pageUrl).pathname.replace(/\/$/, "") || "/";
  const best = [...byGroup.entries()]
    .map(([group, items]) => ({
      group,
      items,
      // Links sitting directly under the listing page (/news -> /news/x) are
      // far more likely to be its articles than a same-size group elsewhere.
      score: items.length + (group === pagePath ? 100 : 0),
    }))
    .sort((a, b) => b.score - a.score)[0];

  if (!best || best.items.length < 3) {
    throw new Error(
      "No feed found, and that page doesn't look like a list of articles.",
    );
  }

  const site = new URL(pageUrl).origin;
  const title =
    metaContent(html, "og:site_name") ??
    stripHtml(html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? "", 120) ??
    new URL(pageUrl).hostname;

  return {
    meta: {
      feedUrl: pageUrl,
      siteUrl: site,
      title: title || new URL(pageUrl).hostname,
      description: metaContent(html, "og:description"),
    },
    articles: sortNewestFirst(
      best.items.map((item) => ({
        id: item.url,
        title: item.title,
        link: item.url,
        summary: item.summary,
        publishedAt: item.publishedAt,
        image: item.image,
      })),
    ),
  };
}
