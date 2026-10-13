/**
 * An article's text as the reader pastes it in, to stand in for a copy the
 * site would only give us part of.
 *
 * Cleaned as an article, not as a subject's text box: a box is a note, kept
 * small because it syncs, so its cleaner keeps 20,000 characters, no
 * pictures and no headings above the third level — which cut a pasted
 * article off a few screens in and took its photographs out. Here the whole
 * of it stays, with its headings, links and pictures; only what can run, or
 * is the site's furniture rather than the story, goes.
 *
 * Built from a parsed document, never by pattern on the markup: the parser
 * runs nothing, and only tags and attributes named here are written out.
 */

type Parse = (html: string) => Document;
const browserParse: Parse = (html) => new DOMParser().parseFromString(html, "text/html");

/** Kept, under their own name or the one given. */
const KEEP: Record<string, string> = {
  p: "p", br: "br", hr: "hr", h1: "h1", h2: "h2", h3: "h3", h4: "h3", h5: "h3", h6: "h3",
  blockquote: "blockquote", ul: "ul", ol: "ol", li: "li", a: "a", img: "img", figure: "figure", figcaption: "figcaption",
  b: "b", strong: "b", i: "i", em: "i", u: "u", s: "s", sub: "sub", sup: "sup", pre: "pre", code: "code",
  table: "table", thead: "thead", tbody: "tbody", tr: "tr", th: "th", td: "td",
};
/** Gone with everything in them: what runs, what is filled in, and the site's own furniture around the story. */
const DROP = new Set([
  "script", "style", "noscript", "template", "iframe", "object", "embed", "svg", "canvas", "video", "audio", "source", "track",
  "form", "input", "button", "select", "textarea", "label", "nav", "aside", "footer", "dialog", "head", "title", "meta", "link",
]);
const BLOCK = new Set(["p", "h1", "h2", "h3", "blockquote", "ul", "ol", "li", "figure", "figcaption", "pre", "table", "hr"]);
const VOID = new Set(["br", "hr", "img"]);
/** A container whose content is only text and inline tags is a paragraph of its own: a line typed into the box is one. */
const CONTAINER = new Set(["div", "section", "article", "main", "header", "center", "address", "details", "summary"]);
const MAX_CHARS = 2_000_000;

const escapeText = (value: string) => value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const escapeAttribute = (value: string) => escapeText(value).replace(/"/g, "&quot;");

/** A link or picture address worth keeping: the web's, or a picture carried inline. */
function address(value: string | null, base: string, picture = false): string | null {
  const raw = value?.trim();
  if (!raw) return null;
  if (picture && /^data:image\/(png|jpe?g|gif|webp|avif);base64,[a-z0-9+/=\s]+$/i.test(raw)) return raw.replace(/\s+/g, "");
  try {
    const url = new URL(raw, base);
    if (url.protocol === "https:" || url.protocol === "http:" || (!picture && url.protocol === "mailto:")) return url.toString();
  } catch {
    /* not an address */
  }
  return null;
}

/** A picture's real address: a lazy-loading page leaves a placeholder in `src` and the photograph elsewhere. */
function pictureOf(el: Element, base: string): string | null {
  const src = el.getAttribute("src");
  const lazy = el.getAttribute("data-src") ?? el.getAttribute("data-lazy-src") ?? el.getAttribute("data-original");
  const set = (el.getAttribute("srcset") ?? el.getAttribute("data-srcset"))?.split(",")[0]?.trim().split(/\s+/)[0] ?? null;
  const placeholder = !src || /^data:image\/gif|blank|placeholder|spacer|1x1/i.test(src);
  return address(placeholder ? lazy ?? set ?? src : src, base, true) ?? address(lazy ?? set, base, true);
}

type Part = { html: string; block: boolean };
/** Nothing to read or see: spaces and line breaks only. */
const blank = (html: string) => !html.replace(/<br \/>|\s|&nbsp;/g, "");

function partsOf(node: Node, base: string): Part[] {
  if (node.nodeType === 3) return [{ html: escapeText(node.textContent ?? ""), block: false }];
  if (node.nodeType !== 1) return [];
  const el = node as Element;
  const tag = el.tagName.toLowerCase();
  if (DROP.has(tag) || el.getAttribute("aria-hidden") === "true" || el.getAttribute("role") === "navigation") return [];
  const inner = () => Array.from(el.childNodes).flatMap((child) => partsOf(child, base));
  const kept = KEEP[tag];
  if (!kept) {
    const parts = inner();
    if (!CONTAINER.has(tag) || parts.some((p) => p.block)) return parts;
    // A line on its own — a <div> of text, as typing into the box makes — stays a paragraph.
    const line = parts.map((p) => p.html).join("");
    return blank(line) ? [] : [{ html: `<p>${line}</p>`, block: true }];
  }
  if (kept === "img") {
    const src = pictureOf(el, base);
    if (!src) return [];
    const size = ["width", "height"].map((name) => Number(el.getAttribute(name))).filter((n) => n > 0 && n < 10_000);
    const alt = el.getAttribute("alt")?.trim();
    return [{ html: `<img src="${escapeAttribute(src)}"${alt ? ` alt="${escapeAttribute(alt.slice(0, 300))}"` : ' alt=""'}${size.length === 2 ? ` width="${size[0]}" height="${size[1]}"` : ""} />`, block: false }];
  }
  if (VOID.has(kept)) return [{ html: `<${kept} />`, block: BLOCK.has(kept) }];
  let attributes = "";
  if (kept === "a") {
    const href = address(el.getAttribute("href"), base);
    if (href) attributes = ` href="${escapeAttribute(href)}"`;
  }
  const body = inner().map((p) => p.html).join("");
  if (blank(body)) return [];
  return [{ html: `<${kept}${attributes}>${body}</${kept}>`, block: BLOCK.has(kept) }];
}

/**
 * Pasted HTML cleaned as an article. `base` is the article's address, which
 * relative links and pictures are read against. Text and inline tags left
 * loose between blocks are gathered into paragraphs.
 */
export function cleanArticleHtml(html: string, base: string, parse: Parse = browserParse): string {
  const doc = parse(String(html ?? "").slice(0, MAX_CHARS));
  const out: string[] = [];
  let loose: string[] = [];
  const settle = () => {
    const text = loose.join("");
    if (!blank(text)) out.push(`<p>${text.trim()}</p>`);
    loose = [];
  };
  for (const part of Array.from(doc.body.childNodes).flatMap((node) => partsOf(node, base))) {
    if (part.block) {
      settle();
      out.push(part.html);
    } else loose.push(part.html);
  }
  settle();
  return out.join("\n");
}

/** What a site puts above a story that is not its headline. */
const CHROME = /^(skip to|advertisement|sign in|log in|subscribe|menu|share|listen|search)\b/i;
const ENDS_SENTENCE = /[.!?,;:]["”’)]?$/;

/**
 * The headline at the top of pasted text, taken out of it: the first main
 * heading if it has one, or else a short first line that does not end as a
 * sentence does — a headline typed or pasted above the story. Any other
 * main heading becomes a section heading, the article's title being shown
 * above the text already.
 */
export function takeHeadline(html: string, parse: Parse = browserParse): { html: string; title?: string } {
  const doc = parse(html);
  const blocks = Array.from(doc.body.children);
  const text = (el: Element) => (el.textContent ?? "").replace(/\s+/g, " ").trim();
  const fits = (value: string) => value.length >= 8 && value.length <= 300 && value.split(" ").length >= 2 && !CHROME.test(value);
  let headline: Element | undefined = blocks.slice(0, 12).find((el) => el.tagName === "H1" && fits(text(el)));
  if (!headline) {
    const first = blocks.find((el) => text(el));
    const value = first ? text(first) : "";
    const onlyLink = first?.children.length === 1 && first.firstElementChild?.tagName === "A" && text(first.firstElementChild) === value;
    if (first && /^(P|H2|H3)$/.test(first.tagName) && fits(value) && value.length <= 200 && !ENDS_SENTENCE.test(value) && !onlyLink && blocks.length > 2) headline = first;
  }
  const title = headline ? text(headline) : undefined;
  headline?.remove();
  for (const h1 of Array.from(doc.body.querySelectorAll("h1"))) {
    const h2 = doc.createElement("h2");
    h2.innerHTML = h1.innerHTML;
    h1.replaceWith(h2);
  }
  return { html: Array.from(doc.body.children, (el) => el.outerHTML).join("\n"), ...(title ? { title } : {}) };
}
