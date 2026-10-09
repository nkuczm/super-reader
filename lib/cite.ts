/**
 * Citing a story from the subject inside writing: a chip carrying the
 * story's headline that links to the original, and takes the reader to the
 * story's card when clicked. In the saved HTML it is an ordinary link marked
 * `data-cite` — "chip" for the headline chip, "text" for the writer's own
 * words linked to a story — so it survives copy, paste and sync as any link.
 */

import { escapeHtml } from "./subjects";
import { canonicalUrl } from "./url";

export type Cite = { link: string; title: string; source?: string; author?: string };

/** What a story card is dragged as, between a card and text. */
export const CITE_TYPE = "application/x-super-reader-cite";
/** A citation clicked: the subject page takes the reader to that story's card. */
export const CITE_OPEN_EVENT = "super-reader:cite-open";
/** A story's headline changed (its page was read, its text scanned in): chips on screen follow. */
export const CITES_CHANGED_EVENT = "super-reader:cites-changed";

/** The stories the subject open now holds, by canonical link. */
let sources = new Map<string, Cite>();

export function setCiteSources(cards: Cite[]) {
  const next = new Map(cards.map((c) => [canonicalUrl(c.link), { link: c.link, title: c.title, source: c.source, author: c.author }]));
  const retitled = [...next].some(([id, c]) => sources.has(id) && (sources.get(id)!.title !== c.title || bylineOfCite(sources.get(id)!) !== bylineOfCite(c)));
  sources = next;
  if (retitled && typeof window !== "undefined") queueMicrotask(() => window.dispatchEvent(new Event(CITES_CHANGED_EVENT)));
}

/**
 * Bring the headline chips in some writing up to date with their stories'
 * titles — a story added from a pasted link is named from its address until
 * its page has been read. True when any chip changed, so the writing is saved.
 */
export function refreshCiteChips(root: ParentNode): boolean {
  let changed = false;
  for (const chip of root.querySelectorAll<HTMLAnchorElement>("a[data-cite=chip], a[data-cite=card]")) {
    const source = sources.get(canonicalUrl(chip.getAttribute("href") ?? ""));
    if (!source) continue;
    const card = chip.dataset.cite === "card";
    // A card's outlet and byline are drawn from the story as it is now, never saved.
    if (card) {
      const by = bylineOfCite(source);
      if (by) chip.dataset.by = by;
      else delete chip.dataset.by;
    }
    if (chip.title === source.title) continue;
    chip.title = source.title;
    chip.textContent = card ? source.title : shortTitle(source.title);
    changed = true;
  }
  return changed;
}

/** "Outlet · Author", as a card shows under its headline. */
export function bylineOfCite(cite: Cite): string {
  return [cite.source, cite.author].filter(Boolean).join(" · ");
}

/**
 * A story set into writing as a card — its whole headline, with the outlet
 * and byline under it — where a chip would be too slight: a line of its own,
 * a bullet in a list of stories. Saved as the link and headline only.
 */
export function citeCardHtml(cite: Cite): string {
  const by = bylineOfCite(sources.get(canonicalUrl(cite.link)) ?? cite);
  return `<a data-cite="card" href="${escapeHtml(cite.link)}" title="${escapeHtml(cite.title)}" contenteditable="false"${by ? ` data-by="${escapeHtml(by)}"` : ""}>${escapeHtml(cite.title)}</a>`;
}

/** The stories set into some writing as cards, by canonical link. */
export function inlineCardLinks(html: string): string[] {
  return [...html.matchAll(/<a\b[^>]*data-cite="card"[^>]*>/g)]
    .map((m) => m[0].match(/href="([^"]*)"/)?.[1])
    .filter((href): href is string => Boolean(href))
    .map((href) => canonicalUrl(href.replace(/&amp;/g, "&")));
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
