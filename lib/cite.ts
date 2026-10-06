/**
 * Citing a story from the subject inside writing: a chip carrying the
 * story's headline that links to the original, and takes the reader to the
 * story's card when clicked. In the saved HTML it is an ordinary link marked
 * `data-cite` — "chip" for the headline chip, "text" for the writer's own
 * words linked to a story — so it survives copy, paste and sync as any link.
 */

import { escapeHtml } from "./subjects";
import { canonicalUrl } from "./url";

export type Cite = { link: string; title: string };

/** What a story card is dragged as, between a card and text. */
export const CITE_TYPE = "application/x-super-reader-cite";
/** A citation clicked: the subject page takes the reader to that story's card. */
export const CITE_OPEN_EVENT = "super-reader:cite-open";

/** The stories the subject open now holds, by canonical link. */
let sources = new Map<string, Cite>();

export function setCiteSources(cards: Cite[]) {
  sources = new Map(cards.map((c) => [canonicalUrl(c.link), c]));
}

/** The story an address points to, when it is one in the subject. */
export function citeFor(url: string): Cite | null {
  if (!/^https?:\/\/\S+$/i.test(url.trim())) return null;
  return sources.get(canonicalUrl(url)) ?? null;
}

/** A headline short enough to sit in a line of a script, cut at a word. */
export function shortTitle(title: string, max = 42): string {
  const t = title.replace(/\s+/g, " ").trim();
  if (t.length <= max) return t;
  const cut = t.slice(0, max);
  const space = cut.lastIndexOf(" ");
  return `${(space > max * 0.6 ? cut.slice(0, space) : cut).replace(/[\s,;:.\-–—]+$/, "")}…`;
}

/** The chip's HTML: one unbreakable piece the caret steps over, as a single character. */
export function citeChipHtml(cite: Cite): string {
  return `<a data-cite="chip" href="${escapeHtml(cite.link)}" title="${escapeHtml(cite.title)}" contenteditable="false">${escapeHtml(shortTitle(cite.title))}</a>`;
}

/** The writer's chosen words linked to a story. */
export function citeTextHtml(cite: Cite, words: string): string {
  return `<a data-cite="text" href="${escapeHtml(cite.link)}">${escapeHtml(words)}</a>`;
}
