import { Readability } from "@mozilla/readability";
import { JSDOM, VirtualConsole } from "jsdom";
import sanitizeHtml from "sanitize-html";
import { fetchText, stripHtml, absolute, toIso } from "./feed";

export type ReadableArticle = {
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
      img: ["src", "alt", "title", "width", "height"],
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
        // Lazy-loading markup often parks the real URL in data-src.
        const src = attribs.src || attribs["data-src"] || "";
        const next: Record<string, string> = { alt: attribs.alt ?? "" };
        if (src) {
          next.src = absolute(src, baseUrl);
          next.loading = "lazy";
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

const MAX_CHARS = 400_000;

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
