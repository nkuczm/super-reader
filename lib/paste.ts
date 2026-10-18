/**
 * Formatted text pasted into a subject, from Google Docs and the like.
 *
 * Google Docs puts rich text on the clipboard in a shape no editor would
 * write: the whole paste wrapped in `<b style="font-weight:normal">`, every
 * bit of formatting as an inline style on a span, and a nested list flattened
 * into one list whose items say their depth in `aria-level`. Taken literally,
 * that pastes as all-bold text with every bullet at the top level.
 *
 * So the paste is translated first — styles into the tags the editor uses,
 * levels back into nested lists, indented paragraphs into indents — and only
 * then cut down by the ordinary sanitiser (lib/subjects.ts), which decides
 * what may stay. Runs in the browser; needs a Document to build in.
 */

import { escapeHtml, safeHref, sanitizeRichText } from "./subjects";

function unwrap(el: Element) {
  el.replaceWith(...Array.from(el.childNodes));
}

/** The formatting a Google Docs span carries in its style, as tags. */
function styleToTags(el: HTMLElement, doc: Document) {
  const style = el.getAttribute("style") ?? "";
  const weight = /font-weight\s*:\s*(\d+|bold|normal)/i.exec(style)?.[1]?.toLowerCase();
  const bold = weight === "bold" || (!!weight && /^\d+$/.test(weight) && Number(weight) >= 600);
  const italic = /font-style\s*:\s*italic/i.test(style);
  const underline = /text-decoration[^;]*underline/i.test(style);
  const background = /background(?:-color)?\s*:\s*([^;]+)/i.exec(style)?.[1]?.trim() ?? "";
  const highlight =
    !!background &&
    !/transparent|none|initial|inherit|white|#fff\b|#ffffff\b|rgba?\(\s*255\s*,\s*255\s*,\s*255/i.test(background);
  const wrappers = [bold && "b", italic && "i", underline && "u", highlight && "mark"].filter(Boolean) as string[];
  if (wrappers.length === 0) return null;
  const outer = doc.createElement(wrappers[0]);
  let inner = outer;
  for (const tag of wrappers.slice(1)) {
    const next = doc.createElement(tag);
    inner.appendChild(next);
    inner = next;
  }
  return { outer, inner };
}

const LIST = "ul, ol";

/**
 * Lists whose items carry aria-level, rebuilt as properly nested lists.
 * Consecutive lists are taken together, because Docs sometimes starts a new
 * list where the depth changes.
 */
function nestLists(root: DocumentFragment | Element, doc: Document) {
  const lists = Array.from(root.querySelectorAll<HTMLElement>(LIST)).filter(
    (list) => !list.parentElement?.closest(LIST) && list.querySelector("li[aria-level]"),
  );
  const done = new Set<Element>();
  for (const first of lists) {
    if (done.has(first)) continue;
    // This list and the lists straight after it.
    const run: HTMLElement[] = [first];
    let next = first.nextElementSibling;
    // Only lists of the same kind continue each other: bullets followed by a
    // numbered list are two lists.
    while (next && next.matches(LIST) && next.tagName === first.tagName) {
      run.push(next as HTMLElement);
      next = next.nextElementSibling;
    }
    run.forEach((list) => done.add(list));

    const items = run.flatMap((list) => Array.from(list.querySelectorAll<HTMLElement>("li")));
    const fragment = doc.createDocumentFragment();
    const stack: { level: number; list: HTMLElement }[] = [];
    for (const item of items) {
      const level = Math.max(1, Number(item.getAttribute("aria-level")) || 1);
      const ordered =
        /list-style-type\s*:\s*(decimal|lower-alpha|upper-alpha|lower-roman|upper-roman)/i.test(
          item.getAttribute("style") ?? "",
        ) || item.closest("ol") !== null;
      while (stack.length && stack[stack.length - 1].level > level) stack.pop();
      if (!stack.length || stack[stack.length - 1].level < level) {
        const list = doc.createElement(ordered ? "ol" : "ul");
        const parent = stack[stack.length - 1];
        const host = parent?.list.lastElementChild ?? null;
        if (host) host.appendChild(list);
        else if (parent) parent.list.appendChild(list);
        else fragment.appendChild(list);
        stack.push({ level, list });
      }
      const li = doc.createElement("li");
      // Docs puts each item's words in a <p>; a list item is the paragraph.
      for (const child of Array.from(item.childNodes)) {
        if (child.nodeType === 1 && (child as Element).matches(LIST)) continue;
        li.appendChild(child);
      }
      stack[stack.length - 1].list.appendChild(li);
    }
    first.replaceWith(fragment);
    run.slice(1).forEach((list) => list.remove());
  }
}

/** A paragraph Docs indented with margin-left becomes an indent here. */
function indentParagraphs(root: DocumentFragment | Element, doc: Document) {
  for (const p of Array.from(root.querySelectorAll<HTMLElement>("p[style]"))) {
    if (p.closest("li")) continue;
    const margin = /margin-left\s*:\s*([\d.]+)(pt|px)/i.exec(p.getAttribute("style") ?? "");
    if (!margin) continue;
    const px = Number(margin[1]) * (margin[2].toLowerCase() === "pt" ? 4 / 3 : 1);
    const levels = Math.min(4, Math.round(px / 48));
    let target: Element = p;
    for (let i = 0; i < levels; i += 1) {
      const quote = doc.createElement("blockquote");
      target.replaceWith(quote);
      quote.appendChild(target);
      target = quote;
    }
  }
}

/**
 * Google Docs' smart chips — a YouTube video, a file, a place — come on the
 * clipboard as a link wrapped round an icon and the item's name. They come
 * in here as chips: the name, linked, marked to show as one (lib/link-chip.ts).
 */
function chipsFromDocs(root: DocumentFragment | Element) {
  for (const a of Array.from(root.querySelectorAll<HTMLAnchorElement>("a[href]"))) {
    const marked = Array.from(a.attributes).some((attr) => /chip/i.test(attr.name) || /chip/i.test(attr.value))
      || !!a.closest("[class*=chip], [data-chip], [data-smart-chip]");
    if (!a.querySelector("img") && !marked) continue;
    a.querySelectorAll("img").forEach((img) => img.remove());
    const words = (a.textContent ?? "").replace(/\s+/g, " ").trim();
    a.textContent = words || a.getAttribute("href") || "";
    a.setAttribute("data-link", "chip");
  }
}

/** What an element may keep through the clean: everything else is Docs' bookkeeping. */
const KEEP = new Set(["href", "title", "type", "start", "data-link", "data-cite", "data-quote", "data-subject", "data-embed", "data-w", "data-check", "data-checked", "data-mark"]);

/**
 * Every attribute Docs adds that nothing reads — ids, classes, the styles
 * already turned into tags — taken off. They were most of a Docs paste's
 * size, and the sanitiser keeps only the first stretch of what it is given
 * (MAX_HTML), so a long or chip-heavy paste was cut off partway through.
 */
function stripAttributes(root: DocumentFragment | Element) {
  for (const el of Array.from(root.querySelectorAll("*"))) {
    for (const attr of Array.from(el.attributes)) {
      // A span's formatting has already been turned into tags (styleToTags), so its style goes too.
      if (!KEEP.has(attr.name)) el.removeAttribute(attr.name);
    }
  }
  // A span that says nothing is only its words.
  for (const span of Array.from(root.querySelectorAll("span"))) {
    if (!span.attributes.length) unwrap(span);
  }
}

export function cleanPastedHtml(html: string, doc: Document = document): string {
  const template = doc.createElement("template");
  template.innerHTML = html;
  const root = template.content;
  root.querySelectorAll("meta, style, script, title, link, head").forEach((el) => el.remove());

  // Docs' wrapper: a <b> that says it is not bold.
  for (const b of Array.from(root.querySelectorAll<HTMLElement>("b, strong"))) {
    if (/font-weight\s*:\s*(normal|[1-5]00)\b/i.test(b.getAttribute("style") ?? "")) unwrap(b);
  }
  // Inline styles into tags.
  for (const span of Array.from(root.querySelectorAll<HTMLElement>("span[style]"))) {
    const tags = styleToTags(span, doc);
    if (!tags) continue;
    while (span.firstChild) tags.inner.appendChild(span.firstChild);
    span.replaceWith(tags.outer);
  }
  nestLists(root, doc);
  indentParagraphs(root, doc);
  // Line items: <li><p>words</p></li> reads better as <li>words</li>.
  for (const p of Array.from(root.querySelectorAll("li > p"))) unwrap(p);
  chipsFromDocs(root);
  stripAttributes(root);

  const holder = doc.createElement("div");
  holder.appendChild(root);
  return sanitizeRichText(holder.innerHTML);
}

/**
 * What a paste says in words. A link copied on an iPhone — from Safari's
 * address bar, or a share sheet's Copy — can come only as a URI list, with
 * no plain text beside it: read as plain text it was nothing, so pasting a
 * link pasted nothing, and pasted over selected words it deleted them.
 */
export function pastedText(data: Pick<DataTransfer, "getData">): string {
  const plain = data.getData("text/plain");
  if (plain.trim()) return plain;
  // One address a line; a line starting "#" is a comment.
  return data.getData("text/uri-list").split(/\r?\n/).map((line) => line.trim()).filter((line) => line && !line.startsWith("#")).join(" ");
}

/**
 * A line of pasted words with web addresses in it, as writing with the
 * addresses linked — as a Doc links them, and as one typed here is linked
 * once a space follows it (a story's title and its link, shared from a
 * phone, come as just this). Trailing punctuation stays outside the link.
 * Null when there is no address, or more than one line.
 */
export function linkedTextHtml(text: string): string | null {
  const line = text.trim();
  if (!line || /[\r\n]/.test(line)) return null;
  let out = "";
  let from = 0;
  for (const match of line.matchAll(/(?:https?:\/\/|www\.)[^\s<>"]+/gi)) {
    const address = match[0].replace(/[.,;:!?'")\]]+$/, "");
    const href = safeHref(/^www\./i.test(address) ? `https://${address}` : address);
    if (!href || !/\.[a-z]{2,}/i.test(address)) continue;
    out += `${escapeHtml(line.slice(from, match.index))}<a href="${href}">${escapeHtml(address)}</a>`;
    from = match.index + address.length;
  }
  return from === 0 ? null : out + escapeHtml(line.slice(from));
}
