import { Readability } from "@mozilla/readability";
import { JSDOM, VirtualConsole } from "jsdom";
import sanitizeHtml from "sanitize-html";
import { fetchText, stripHtml, absolute, toIso, stripChrome } from "./feed";

export type ReadableArticle = {
  /** Where the text came from: the page itself, or the feed's own copy. */
  via?: "page" | "feed";
  url: string;
  title: string;
  byline?: string;
  siteName?: string;
  publishedAt?: string;
  excerpt?: string;
  /** Sanitized HTML, safe to inject. */
  html: string;
  wordCount: number;
  truncated: boolean;
};

/**
 * Only this subset survives sanitizing. The article body is third-party HTML,
 * so everything that can execute or phone home — script, style, iframe, form,
 * event handlers, inline styles — is dropped rather than filtered.
 */
const ALLOWED_TAGS = [
  "p", "br", "hr", "blockquote", "pre", "code", "em", "i", "strong", "b",
  "u", "s", "sub", "sup", "small", "mark", "span", "div",
  "h1", "h2", "h3", "h4", "h5", "h6",
  "ul", "ol", "li", "dl", "dt", "dd",
  "table", "thead", "tbody", "tfoot", "tr", "th", "td", "caption",
  "a", "img", "figure", "figcaption",
];

function sanitize(html: string, baseUrl: string) {
  return sanitizeHtml(html, {
    allowedTags: ALLOWED_TAGS,
    allowedAttributes: {
      a: ["href", "title"],
      img: ["src", "alt", "title", "width", "height", "loading", "decoding", "referrerpolicy"],
      "*": ["colspan", "rowspan"],
    },
    // Absolute http(s) only: blocks javascript:, data: and friends outright.
    allowedSchemes: ["http", "https", "mailto"],
    allowedSchemesAppliedToAttributes: ["href", "src"],
    transformTags: {
      a: (tagName, attribs) => ({
        tagName,
        attribs: {
          ...attribs,
          ...(attribs.href ? { href: absolute(attribs.href, baseUrl) } : {}),
          target: "_blank",
          rel: "noreferrer noopener",
        },
      }),
      img: (tagName, attribs) => {
        const src = bestImageSrc(attribs);
        const next: Record<string, string> = { alt: attribs.alt ?? "" };
        if (src) {
          next.src = absolute(src, baseUrl);
          next.loading = "lazy";
          next.decoding = "async";
          // Some publishers block hot-linked images by Referer; sending none
          // is far more likely to load than sending ours.
          next.referrerpolicy = "no-referrer";
        }
        return { tagName, attribs: next };
      },
    },
    // Drop empty leftovers so the reader doesn't show gaps.
    exclusiveFilter: (frame) =>
      ["p", "div", "span", "figcaption"].includes(frame.tag) &&
      !frame.text.trim() &&
      !frame.mediaChildren.length,
  });
}

/** Take the largest candidate out of a srcset ("url 320w, url 1200w"). */
function widestFromSrcset(srcset: string) {
  const candidates = srcset
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => {
      const [url, descriptor = ""] = part.split(/\s+/);
      const width = Number.parseInt(descriptor, 10);
      return { url, weight: Number.isFinite(width) ? width : 0 };
    })
    .filter((c) => c.url && !c.url.startsWith("data:"));

  if (candidates.length === 0) return "";
  return candidates.reduce((best, c) => (c.weight >= best.weight ? c : best)).url;
}

/** A src that is a spacer, blur-up or inline placeholder, not the real photo. */
function isPlaceholder(src: string) {
  return (
    !src ||
    src.startsWith("data:") ||
    /(^|[\/_-])(placeholder|spacer|blank|transparent|lazy|loading)([._-]|$)/i.test(src)
  );
}

/**
 * Lazy-loading markup leaves a placeholder in src and the real image in
 * data-src or a srcset, so reading src alone yields blank or blurred photos.
 */
function bestImageSrc(attribs: Record<string, string>) {
  const dataSrc = attribs["data-src"] || attribs["data-original"] || attribs["data-lazy-src"];
  if (dataSrc && !isPlaceholder(dataSrc)) return dataSrc;

  for (const key of ["data-srcset", "data-lazy-srcset", "srcset"]) {
    const widest = attribs[key] ? widestFromSrcset(attribs[key]) : "";
    if (widest && !isPlaceholder(widest)) return widest;
  }

  if (!isPlaceholder(attribs.src)) return attribs.src;
  return dataSrc || attribs.src || "";
}

function metaOf(dom: JSDOM, names: string[]) {
  for (const name of names) {
    const el = dom.window.document.querySelector(
      `meta[property="${name}"], meta[name="${name}"]`,
    );
    const content = el?.getAttribute("content")?.trim();
    if (content) return content;
  }
  return undefined;
}

/**
 * Fix lazy-loading markup before Readability runs, while the surrounding
 * <picture>/<noscript> structure is still intact — afterwards the real image
 * URL is gone and only the placeholder remains.
 */
function hoistLazyImages(doc: Document) {
  // <picture><source srcset="real.jpg"><img src="placeholder"></picture>
  for (const picture of Array.from(doc.querySelectorAll("picture"))) {
    const img = picture.querySelector("img");
    if (!img) continue;
    const sources = Array.from(picture.querySelectorAll("source"));
    for (const source of sources) {
      const set = source.getAttribute("srcset") ?? source.getAttribute("data-srcset");
      const widest = set ? widestFromSrcset(set) : "";
      if (widest) {
        img.setAttribute("src", widest);
        img.removeAttribute("srcset");
        break;
      }
    }
  }

  // Lazy loaders often keep the real <img> inside <noscript>.
  for (const noscript of Array.from(doc.querySelectorAll("noscript"))) {
    const html = noscript.textContent ?? "";
    if (!/<img/i.test(html)) continue;
    const holder = doc.createElement("div");
    holder.innerHTML = html;
    const replacement = holder.querySelector("img");
    if (replacement) noscript.replaceWith(replacement);
  }
}

const MAX_CHARS = 400_000;

/**
 * Build a readable article from HTML the publisher already syndicated,
 * skipping Readability: feed content is the article body, with none of the
 * page furniture Readability exists to strip.
 */
export function articleFromFeedContent(
  contentHtml: string,
  url: string,
  fallbackTitle: string,
): ReadableArticle {
  const html = sanitize(stripChrome(contentHtml).slice(0, MAX_CHARS), url);
  const text = stripHtml(html, Number.MAX_SAFE_INTEGER);
  return {
    via: "feed",
    url,
    title: fallbackTitle,
    html,
    wordCount: text ? text.split(/\s+/).length : 0,
    truncated: contentHtml.length > MAX_CHARS,
  };
}

export async function extractArticle(url: string): Promise<ReadableArticle> {
  const { body, finalUrl } = await fetchText(url, 15000);

  // jsdom logs noisily about CSS it cannot parse; none of it matters here.
  const virtualConsole = new VirtualConsole();
  const dom = new JSDOM(body, { url: finalUrl, virtualConsole });

  const publishedAt =
    toIso(metaOf(dom, ["article:published_time", "datePublished", "date"])) ??
    toIso(
      dom.window.document
        .querySelector("time[datetime]")
        ?.getAttribute("datetime") ?? undefined,
    );
  const siteName = metaOf(dom, ["og:site_name"]);

  hoistLazyImages(dom.window.document);

  const parsed = new Readability(dom.window.document).parse();
  if (!parsed?.content) {
    throw new Error("Could not extract readable text from that page.");
  }

  const truncated = parsed.content.length > MAX_CHARS;
  const html = sanitize(
    truncated ? parsed.content.slice(0, MAX_CHARS) : parsed.content,
    finalUrl,
  );

  const text = stripHtml(html, Number.MAX_SAFE_INTEGER);
  return {
    via: "page",
    url: finalUrl,
    title: parsed.title?.trim() || stripHtml(parsed.title ?? "", 200) || url,
    byline: parsed.byline?.trim() || undefined,
    siteName: siteName ?? parsed.siteName ?? undefined,
    publishedAt,
    excerpt: parsed.excerpt?.trim() || undefined,
    html,
    wordCount: text ? text.split(/\s+/).length : 0,
    truncated,
  };
}
