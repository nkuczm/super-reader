import { Readability } from "@mozilla/readability";
import { JSDOM, VirtualConsole } from "jsdom";
import sanitizeHtml from "sanitize-html";
import { fetchText, stripHtml, absolute, toIso, stripChrome } from "./feed";
import { structuredArticle } from "./structured";
import { endsAtWall, paywallVerdict, SHORT_ARTICLE_WORDS } from "./paywall";
import type { Attachment } from "./types";

export type ReadableArticle = {
  /**
   * Where the text came from: the page, the feed's own copy, a file, or —
   * when none of those could be read — the page's own description of itself.
   */
  via?: "page" | "feed" | "file" | "preview" | "data" | "amp";
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
  /** Files this article points at — the filed PDF, say. */
  attachments?: Attachment[];
  /**
   * What arrived is the free part of a subscriber article, not all of it.
   * Set from the publisher's own declaration wherever they made one.
   */
  partial?: boolean;
  /** Why it is partial, in terms the reader can act on. */
  partialReason?: string;
  /** Subjects the publisher tagged it with — kept for grouping and search. */
  topics?: string[];
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
    /**
     * Drop empty leftovers so the reader doesn't show gaps — but only the
     * tags that actually leave one. `mediaChildren` counts direct children,
     * so a wrapper like Substack's `div > picture > img` looked empty and was
     * removed with the photo inside it: eight images became none. An empty
     * div or span renders as nothing anyway, so there is nothing to tidy.
     */
    exclusiveFilter: (frame) =>
      ["p", "figcaption"].includes(frame.tag) &&
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

/**
 * Comment threads, which are not the article.
 *
 * Readability scores containers by how much text they hold, so on a short post
 * with a busy comment section the discussion outweighs the post and gets
 * returned as the article — a reader's comment appearing under the author's
 * name and title. Melanie Mitchell's "On AI and Jagged Intelligence" is the
 * case that found this: a 458-character note with 1,700 characters of replies
 * beneath it.
 *
 * Removing the thread before Readability runs is the fix, rather than trying
 * to out-score it afterwards. Every blogging platform appends comments this
 * way, so this is not Substack-specific.
 */
const DISCUSSION_SELECTORS = [
  "#comments",
  "#substack-comments",
  "#disqus_thread",
  "#respond",
  ".comments-section",
  ".comments-area",
  ".comment-list",
  ".commentlist",
  ".comment-respond",
  ".comment-thread",
  ".responses",
  "[data-testid=comments]",
];

/**
 * Containers a page uses to mark its own article body. Nothing holding one of
 * these is a comment thread, whatever it calls itself.
 */
const BODY_HINTS =
  "div.available-content, div.body.markup, [itemprop=articleBody], .post-content, .entry-content";

function stripDiscussion(doc: Document) {
  const candidates = new Set<Element>();

  for (const selector of DISCUSSION_SELECTORS) {
    try {
      for (const el of doc.querySelectorAll(selector)) candidates.add(el);
    } catch {
      /* a selector this DOM will not parse is simply skipped */
    }
  }

  // Anything else naming itself a comment container. Matched on whole words so
  // "commentary" and "commented" are left alone.
  for (const el of doc.querySelectorAll("[class*=comment], [id*=comment]")) {
    const name = `${el.getAttribute("class") ?? ""} ${el.getAttribute("id") ?? ""}`;
    if (/(^|[\s_-])comments?([\s_-]|$)/i.test(name)) candidates.add(el);
  }

  for (const el of candidates) {
    // Never take the article with the thread: on some layouts the post lives
    // inside a wrapper whose name mentions comments.
    if (el.tagName === "BODY" || el.tagName === "ARTICLE") continue;
    // The element itself may be the body — a post about comments can sit in
    // "entry-content comment-guidance" — as well as merely contain it.
    if (el.matches(BODY_HINTS) || el.querySelector(BODY_HINTS)) continue;
    el.remove();
  }
}

const MAX_CHARS = 400_000;

/**
 * The picture a page declares for itself. Publishers put the lead photo in
 * og:image even when it sits outside the article body — the Guardian and AP
 * both do, which is why their articles arrived as walls of text.
 */
function leadImageFrom(dom: JSDOM) {
  const src = metaOf(dom, ["og:image", "og:image:url", "twitter:image", "twitter:image:src"]);
  if (!src || isPlaceholder(src)) return undefined;
  // Site logos and avatars are declared this way too and are not worth a
  // full-width slot at the top of the article.
  if (/(logo|avatar|icon|default[-_]?share)/i.test(src)) return undefined;
  const alt = metaOf(dom, ["og:image:alt", "twitter:image:alt"]) ?? "";
  return { src, alt };
}

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

/**
 * Take the publisher's syndicated copy when it is the fuller one.
 *
 * The reader used to reach for the feed only when the page refused outright,
 * which missed the more common case by a distance: the page answers, extracts
 * cleanly, and holds three paragraphs of a nine-paragraph story. Where a feed
 * carries `content:encoded` — and independent blogs, newsletters and most
 * Substacks do — that is the whole article, syndicated by the publisher for
 * exactly this.
 *
 * The page still wins at comparable length, because it brings the pictures.
 */
export function preferSyndicated(
  article: ReadableArticle,
  contentHtml: string,
  fallbackTitle = "",
): ReadableArticle {
  const syndicated = articleFromFeedContent(
    contentHtml,
    article.url,
    article.title || fallbackTitle,
  );
  const better =
    syndicated.wordCount >= article.wordCount * 1.5 &&
    syndicated.wordCount >= article.wordCount + 80;
  if (!better) return article;

  return {
    ...article,
    via: "feed",
    html: syndicated.html,
    wordCount: syndicated.wordCount,
    truncated: syndicated.truncated,
    // The wall was on the page. What the publisher handed out in their own
    // feed is not behind it.
    partial: undefined,
    partialReason: undefined,
  };
}

/**
 * An article whose HTML came from somewhere other than a scraped page — an
 * API's own copy of the text. Same sanitising as everything else; it is still
 * third-party HTML being injected into the reader.
 */
export function sanitizeArticleHtml(
  contentHtml: string,
  url: string,
  meta: {
    title: string;
    byline?: string;
    siteName?: string;
    publishedAt?: string;
    attachments?: Attachment[];
  },
): ReadableArticle {
  const html = sanitize(contentHtml.slice(0, MAX_CHARS), url);
  const text = stripHtml(html, Number.MAX_SAFE_INTEGER);
  return {
    via: "page",
    url,
    title: meta.title,
    byline: meta.byline,
    siteName: meta.siteName,
    publishedAt: meta.publishedAt,
    html,
    wordCount: text ? text.split(/\s+/).length : 0,
    truncated: contentHtml.length > MAX_CHARS,
    attachments: meta.attachments,
  };
}

/**
 * What a page says about itself, for the cases Readability cannot read at all
 * — a video, a gallery, an app shell. A title, a picture and a description is
 * far better than "could not extract readable text", and it is exactly what
 * every other app shows when it unfurls a link.
 */
/**
 * Video hosts serve a script shell to anything that is not a browser, so their
 * page metadata is generic boilerplate — YouTube's says "- YouTube". Their
 * oEmbed endpoints are public, need no key, and give the real title, author
 * and thumbnail.
 */
async function oEmbedPreview(url: string): Promise<ReadableArticle | null> {
  const endpoint = /(^|\.)(youtube\.com|youtu\.be)$/i.test(new URL(url).hostname)
    ? `https://www.youtube.com/oembed?format=json&url=${encodeURIComponent(url)}`
    : /(^|\.)vimeo\.com$/i.test(new URL(url).hostname)
      ? `https://vimeo.com/api/oembed.json?url=${encodeURIComponent(url)}`
      : null;
  if (!endpoint) return null;

  const res = await fetch(endpoint, { signal: AbortSignal.timeout(10000) });
  if (!res.ok) return null;
  const data: any = await res.json();
  if (!data?.title) return null;

  const thumb = typeof data.thumbnail_url === "string" ? data.thumbnail_url : "";
  return {
    via: "preview",
    url,
    title: String(data.title),
    byline: data.author_name ? String(data.author_name) : undefined,
    siteName: data.provider_name ? String(data.provider_name) : undefined,
    html: sanitize(
      thumb ? `<figure><img src="${thumb}" alt="" /></figure>` : "",
      url,
    ),
    wordCount: 0,
    truncated: false,
  };
}

export async function previewFromMetadata(url: string): Promise<ReadableArticle | null> {
  // A video's own oEmbed beats whatever its page says to a crawler.
  try {
    const embed = await oEmbedPreview(url);
    if (embed) return embed;
  } catch {
    /* not an embeddable host, or it would not answer */
  }

  const { body, finalUrl } = await fetchText(url, 15000);
  const dom = new JSDOM(body, { url: finalUrl, virtualConsole: new VirtualConsole() });

  const title = metaOf(dom, ["og:title", "twitter:title"]) ?? dom.window.document.title?.trim();
  const description = metaOf(dom, ["og:description", "twitter:description", "description"]);
  const lead = leadImageFrom(dom);
  const siteName = metaOf(dom, ["og:site_name"]);
  if (!title && !description && !lead) return null;

  const parts = [
    lead ? `<figure><img src="${lead.src}" alt="" /></figure>` : "",
    description ? `<p>${description}</p>` : "",
  ].join("");

  return {
    via: "preview",
    url: finalUrl,
    title: title || url,
    siteName,
    publishedAt: toIso(metaOf(dom, ["article:published_time", "datePublished"])),
    html: sanitize(parts, finalUrl),
    wordCount: description ? description.split(/\s+/).length : 0,
    truncated: false,
  };
}

/** Prose length, which is the only fair way to compare two bodies. */
function proseWords(html: string) {
  const text = stripHtml(html, Number.MAX_SAFE_INTEGER).trim();
  return text ? text.split(/\s+/).length : 0;
}

/**
 * The publisher's own AMP copy of the page.
 *
 * AMP pages are a representation the publisher declares in their own markup
 * for anyone who wants it, and they are plain server-rendered HTML by
 * definition — no client-side assembly, which is exactly the failure mode
 * that leaves the reader with an empty shell. It is only worth a request when
 * the ordinary page came back thin, so it stays a second try rather than a
 * second fetch on every article.
 */
function ampUrlFrom(dom: JSDOM, pageUrl: string) {
  const href = dom.window.document
    .querySelector('link[rel="amphtml"], link[rel="amphtml alternate"]')
    ?.getAttribute("href");
  if (!href) return null;
  let amp: URL;
  let page: URL;
  try {
    amp = new URL(href, pageUrl);
    page = new URL(pageUrl);
  } catch {
    return null;
  }
  if (amp.protocol !== "https:" && amp.protocol !== "http:") return null;
  // Follow it only to the same site or to an AMP cache. A page is free to
  // declare any URL it likes here, and this route fetches whatever it is told.
  const sameSite =
    amp.hostname === page.hostname ||
    registrable(amp.hostname) === registrable(page.hostname) ||
    /(^|\.)ampproject\.org$/i.test(amp.hostname);
  if (!sameSite) return null;
  if (amp.toString() === page.toString()) return null;
  return amp.toString();
}

/** Enough of a hostname to tell "same publisher" from "somewhere else". */
function registrable(hostname: string) {
  return hostname.toLowerCase().split(".").slice(-2).join(".");
}

/** One possible article body, with where it came from. */
type BodyCandidate = {
  via: NonNullable<ReadableArticle["via"]>;
  html: string;
  words: number;
};

/**
 * Which body to show.
 *
 * The page's own extraction is preferred at equal length: it carries the
 * photographs, the pull quotes and the links, where a syndicated copy or a
 * structured-data field is prose alone. But it is only preferred at *equal*
 * length — a metered page hands over three paragraphs and Readability
 * extracts them flawlessly, which is how a teaser used to be shown as the
 * article while the publisher's own feed carried the whole thing.
 *
 * So a challenger wins when it is substantially longer: half as much again,
 * and at least eighty words more. Both conditions matter — the ratio alone
 * promotes a 40-word difference on a short post, and the absolute alone
 * promotes a feed's boilerplate footer on a long one.
 */
export function pickBody(candidates: BodyCandidate[]): BodyCandidate | null {
  const usable = candidates.filter((candidate) => candidate.words > 0);
  if (usable.length === 0) return null;

  const page = usable.find((candidate) => candidate.via === "page");
  if (!page) {
    return usable.reduce((best, candidate) =>
      candidate.words > best.words ? candidate : best,
    );
  }

  let winner = page;
  for (const candidate of usable) {
    if (candidate === page) continue;
    const beats = candidate.words >= winner.words * 1.5 && candidate.words >= winner.words + 80;
    if (beats) winner = candidate;
  }
  return winner;
}

export type ExtractOptions = {
  /**
   * The full text the publisher syndicated for this item, where the caller
   * had a feed to look in. Offered as a candidate rather than kept for a
   * failure: the interesting case is a page that extracts *successfully* and
   * still holds a fraction of what the feed carries.
   */
  feedContent?: string | null;
  /** Off for the AMP second try itself, so it cannot recurse. */
  allowAlternate?: boolean;
};

export async function extractArticle(
  url: string,
  options: ExtractOptions = {},
): Promise<ReadableArticle> {
  const { body, finalUrl } = await fetchText(url, 15000);

  // jsdom logs noisily about CSS it cannot parse; none of it matters here.
  const virtualConsole = new VirtualConsole();
  const dom = new JSDOM(body, { url: finalUrl, virtualConsole });

  // What the page says about itself, before anything is removed from it.
  const data = structuredArticle(body);

  const publishedAt =
    toIso(metaOf(dom, ["article:published_time", "datePublished", "date"])) ??
    toIso(data?.publishedAt) ??
    toIso(
      dom.window.document
        .querySelector("time[datetime]")
        ?.getAttribute("datetime") ?? undefined,
    );
  const siteName = metaOf(dom, ["og:site_name"]) ?? data?.siteName;
  const amp = options.allowAlternate === false ? null : ampUrlFrom(dom, finalUrl);

  hoistLazyImages(dom.window.document);
  stripDiscussion(dom.window.document);

  // charThreshold defaults to 500, which makes Readability discard a genuinely
  // short post and fall back to scraping the whole page. Short posts are
  // ordinary — a link-out note is often two sentences.
  const parsed = new Readability(dom.window.document, { charThreshold: 250 }).parse();

  const candidates: BodyCandidate[] = [];
  const add = (via: BodyCandidate["via"], html: string | null | undefined) => {
    if (!html) return;
    const cleaned = sanitize(
      (via === "feed" ? stripChrome(html) : html).slice(0, MAX_CHARS),
      finalUrl,
    );
    const words = proseWords(cleaned);
    if (words > 0) candidates.push({ via, html: cleaned, words });
  };

  add("page", parsed?.content);
  // The publisher's own copy of the prose, which survives a page whose body
  // is assembled in the browser.
  add("data", data?.body);
  add("feed", options.feedContent);

  let best = pickBody(candidates);

  /**
   * Still thin, and the publisher declares an AMP copy: it is server-rendered
   * by definition, so it is the one remaining place the full text might be
   * sitting in plain HTML. One extra request, only on the pages that need it.
   */
  if (amp && (!best || best.words < SHORT_ARTICLE_WORDS)) {
    try {
      const alternate = await extractArticle(amp, {
        ...options,
        allowAlternate: false,
      });
      const words = proseWords(alternate.html);
      if (words > (best?.words ?? 0) * 1.5 && words >= (best?.words ?? 0) + 80) {
        best = { via: "amp", html: alternate.html, words };
      }
    } catch {
      /* the AMP copy is optional; the page's own text stands */
    }
  }

  if (!best) {
    throw new Error("Could not extract readable text from that page.");
  }

  const truncated =
    (parsed?.content?.length ?? 0) > MAX_CHARS ||
    (options.feedContent?.length ?? 0) > MAX_CHARS ||
    (data?.body?.length ?? 0) > MAX_CHARS;
  let html = best.html;

  // An article that came out with no picture at all gets the one the page
  // declares for itself, rather than opening as a wall of text.
  if (!/<img\b/i.test(html)) {
    const lead = leadImageFrom(dom) ?? (data?.image ? { src: data.image, alt: "" } : undefined);
    if (lead && !isPlaceholder(lead.src)) {
      html =
        sanitize(
          `<figure><img src="${lead.src}" alt="${lead.alt.replace(/"/g, "&quot;")}" /></figure>`,
          finalUrl,
        ) + html;
    }
  }

  const text = stripHtml(html, Number.MAX_SAFE_INTEGER);
  const wordCount = text ? text.split(/\s+/).length : 0;

  /**
   * Is this all of it?
   *
   * Two ways to a yes. The publisher declared the article gated and what
   * arrived is page text — in which case the length that looks complete is
   * whatever the meter lets through, so the bar is generous. Or the text is
   * short and the page shows a wall, or ends at one.
   *
   * A long body is never partial, whatever the page declares: when the
   * publisher's own feed carried the whole article, the wall on the page it
   * came from says nothing about what the reader is holding.
   */
  const wall = paywallVerdict(body, data?.free);
  const partial =
    (wall.declared && wall.marked && best.via === "page" && wordCount < 600) ||
    (wordCount < SHORT_ARTICLE_WORDS && (wall.marked || endsAtWall(text)));

  return {
    via: best.via,
    url: finalUrl,
    title:
      parsed?.title?.trim() ||
      data?.headline ||
      metaOf(dom, ["og:title", "twitter:title"]) ||
      dom.window.document.title?.trim() ||
      url,
    byline: parsed?.byline?.trim() || data?.byline || undefined,
    siteName: siteName ?? parsed?.siteName ?? undefined,
    publishedAt,
    excerpt: parsed?.excerpt?.trim() || data?.description || undefined,
    html,
    wordCount,
    truncated,
    topics: data?.keywords,
    ...(partial
      ? {
          partial: true,
          partialReason:
            wall.reason ?? "The rest of this article is behind a subscription.",
        }
      : {}),
  };
}
