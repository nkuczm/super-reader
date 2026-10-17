/**
 * The colours a highlight or a table cell can take: a wider set than the
 * one each began with (which stay first, and the highlight's default stays
 * yellow), and favourites the reader adds. Favourites are kept on the device
 * and shared by highlights and table cells alike.
 */

/** The highlight's own yellow: a highlight in it is saved as a plain <mark>, as every highlight was before colours. */
export const DEFAULT_HIGHLIGHT = "#fde68a";

export const HIGHLIGHT_COLORS = [
  DEFAULT_HIGHLIGHT, "#fef08a", "#fed7aa", "#fecaca", "#fbcfe8", "#f5d0fe", "#e9d5ff", "#c7d2fe",
  "#bfdbfe", "#bae6fd", "#a5f3fc", "#99f6e4", "#bbf7d0", "#d9f99d", "#e7e5e4", "#e5e7eb",
  "#facc15", "#fb923c", "#f87171", "#f472b6", "#c084fc", "#60a5fa", "#2dd4bf", "#4ade80",
];

/** The cell colours tables had, first, then more. */
export const CELL_PALETTE = [
  "#fde68a", "#fecaca", "#bbf7d0", "#bfdbfe", "#e9d5ff", "#fed7aa", "#e5e7eb",
  "#fef9c3", "#ffe4e6", "#fce7f3", "#ede9fe", "#e0e7ff", "#dbeafe", "#cffafe", "#ccfbf1", "#dcfce7",
  "#ecfccb", "#f5f5f4", "#d1d5db", "#fca5a5", "#93c5fd", "#86efac", "#fcd34d", "#c4b5fd",
];

/** A colour as #rrggbb, lower case, or null when it is not one. */
export function hexColor(value: string | undefined | null): string | null {
  const v = (value ?? "").trim().toLowerCase();
  const short = /^#([0-9a-f])([0-9a-f])([0-9a-f])$/.exec(v);
  if (short) return `#${short[1]}${short[1]}${short[2]}${short[2]}${short[3]}${short[3]}`;
  if (/^#[0-9a-f]{6}$/.test(v)) return v;
  const rgb = /^rgba?\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})/.exec(v);
  if (rgb) return `#${rgb.slice(1, 4).map((n) => Math.min(255, Number(n)).toString(16).padStart(2, "0")).join("")}`;
  return null;
}

const FAVORITES_KEY = "super-reader:color-favorites";
const LAST_HIGHLIGHT_KEY = "super-reader:last-highlight";
export const FAVORITES_EVENT = "super-reader:color-favorites";

export function loadFavorites(): string[] {
  try {
    const list = JSON.parse(localStorage.getItem(FAVORITES_KEY) ?? "[]");
    return Array.isArray(list) ? list.map(hexColor).filter((c): c is string => Boolean(c)).slice(0, 24) : [];
  } catch {
    return [];
  }
}

export function saveFavorites(list: string[]) {
  const clean = [...new Set(list.map(hexColor).filter((c): c is string => Boolean(c)))].slice(0, 24);
  try {
    localStorage.setItem(FAVORITES_KEY, JSON.stringify(clean));
  } catch {
    /* not remembered */
  }
  window.dispatchEvent(new Event(FAVORITES_EVENT));
}

/** The colour the highlight button puts on: the last one chosen. */
export function lastHighlight(): string {
  try {
    return hexColor(localStorage.getItem(LAST_HIGHLIGHT_KEY)) ?? DEFAULT_HIGHLIGHT;
  } catch {
    return DEFAULT_HIGHLIGHT;
  }
}

export function setLastHighlight(color: string) {
  try {
    localStorage.setItem(LAST_HIGHLIGHT_KEY, hexColor(color) ?? DEFAULT_HIGHLIGHT);
  } catch {
    /* not remembered */
  }
}
