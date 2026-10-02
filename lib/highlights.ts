/**
 * Highlights: passages marked in an article without filing them anywhere.
 *
 * A quote filed into a subject is also shown highlighted in its article, but
 * it lives with the subject (lib/notes.ts); these are the ones marked with
 * "Highlight" alone. Kept per article link, synced like pasted stories —
 * most recent change per highlight wins, and a removal is a dated tombstone
 * so another device does not put it back.
 */

import { canonicalUrl } from "./url";

export type Highlight = {
  id: string;
  /** The article's canonical link. */
  link: string;
  text: string;
  at: number;
  deleted?: boolean;
};

export type Highlights = Record<string, Highlight>;

const KEY = "super-reader:highlights:v1";
const MAX_HIGHLIGHTS = 2000;
const TOMBSTONE_TTL_MS = 60 * 24 * 60 * 60 * 1000;
export const MAX_HIGHLIGHT_CHARS = 4000;

export function loadHighlights(): Highlights {
  if (typeof window === "undefined") return {};
  try {
    const parsed = JSON.parse(window.localStorage.getItem(KEY) ?? "{}");
    return parsed && typeof parsed === "object" ? (parsed as Highlights) : {};
  } catch {
    return {};
  }
}

export function saveHighlights(highlights: Highlights) {
  try {
    window.localStorage.setItem(KEY, JSON.stringify(highlights));
  } catch {
    /* storage full; the highlight still shows this session */
  }
}

export function highlightsFor(highlights: Highlights, link: string): Highlight[] {
  const key = canonicalUrl(link);
  return Object.values(highlights ?? {}).filter((h) => !h.deleted && h.link === key);
}

export function addHighlight(highlights: Highlights, link: string, text: string, now = Date.now()): Highlights {
  const clean = text.trim().slice(0, MAX_HIGHLIGHT_CHARS);
  if (!clean) return highlights;
  const id = `h${now.toString(36)}${Math.random().toString(36).slice(2, 7)}`;
  return { ...highlights, [id]: { id, link: canonicalUrl(link), text: clean, at: now } };
}

export function removeHighlight(highlights: Highlights, id: string, now = Date.now()): Highlights {
  const held = highlights[id];
  if (!held || held.deleted) return highlights;
  return { ...highlights, [id]: { ...held, deleted: true, at: now } };
}

export function mergeHighlights(mine: Highlights, theirs: Highlights, now = Date.now()): Highlights {
  const merged: Highlights = {};
  for (const source of [mine ?? {}, theirs ?? {}]) {
    for (const [id, h] of Object.entries(source)) {
      if (!h || typeof h.link !== "string" || typeof h.text !== "string" || typeof h.at !== "number") continue;
      if (!merged[id] || h.at > merged[id].at) merged[id] = h;
    }
  }
  const kept = Object.entries(merged)
    .filter(([, h]) => !(h.deleted && now - h.at > TOMBSTONE_TTL_MS))
    .sort((a, b) => b[1].at - a[1].at)
    .slice(0, MAX_HIGHLIGHTS);
  return Object.fromEntries(kept);
}

export function sameHighlights(a: Highlights, b: Highlights) {
  const keys = Object.keys(a ?? {});
  if (keys.length !== Object.keys(b ?? {}).length) return false;
  return keys.every((id) => b[id] && b[id].at === a[id].at && !!b[id].deleted === !!a[id].deleted);
}

/** The article's highlights that a selection overlaps: one inside it, or it inside one. */
export function highlightsOverlapping(highlights: Highlights, link: string, text: string): Highlight[] {
  const norm = (t: string) => t.replace(/\s+/g, " ").trim().toLowerCase();
  const sel = norm(text);
  if (!sel) return [];
  return highlightsFor(highlights, link).filter((h) => {
    const held = norm(h.text);
    return held.includes(sel) || sel.includes(held);
  });
}

/**
 * The Highlight button as a toggle: a selection over existing highlights
 * takes them off; anywhere else, it marks the passage.
 */
export function toggleHighlight(highlights: Highlights, link: string, text: string, now = Date.now()): Highlights {
  const over = highlightsOverlapping(highlights, link, text);
  if (over.length === 0) return addHighlight(highlights, link, text, now);
  return over.reduce((acc, h) => removeHighlight(acc, h.id, now), highlights);
}
