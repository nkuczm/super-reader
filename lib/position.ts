/**
 * Where the reader had got to in each article, so reopening one picks up
 * there rather than at the headline.
 *
 * Stored as a fraction of the article body rather than a pixel offset. Pixels
 * are only true for the width and font size they were measured at: a story
 * left on the phone and reopened on the laptop, or after the text size
 * changed, would land somewhere arbitrary. How far through the prose you were
 * survives both.
 */

const KEY = "super-reader:positions:v1";

/** Less than this is the opening lines — nothing worth coming back to. */
export const MIN_FRACTION = 0.03;
/** More than this is the end — reopening a finished story starts it again. */
export const DONE_FRACTION = 0.97;
/** Enough for months of reading; old entries go first. */
const MAX_ENTRIES = 400;
/** A place in an article two months old is not one anyone is returning to. */
const MAX_AGE_MS = 60 * 24 * 60 * 60 * 1000;

export type Position = { fraction: number; at: number };
type Positions = Record<string, Position>;

function load(): Positions {
  if (typeof window === "undefined") return {};
  try {
    const parsed = JSON.parse(window.localStorage.getItem(KEY) ?? "{}");
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function store(positions: Positions) {
  try {
    window.localStorage.setItem(KEY, JSON.stringify(positions));
  } catch {
    /* storage full or unavailable; the article simply opens at the top */
  }
}

/** Where to reopen this article, or null to start at the top. */
export function positionFor(url: string, now = Date.now()): number | null {
  const entry = load()[url];
  if (!entry || now - entry.at > MAX_AGE_MS) return null;
  const fraction = Number(entry.fraction);
  if (!Number.isFinite(fraction) || fraction < MIN_FRACTION || fraction > DONE_FRACTION) {
    return null;
  }
  return fraction;
}

/**
 * Record how far through an article the reader is. The opening lines and the
 * end both clear the entry rather than store it: neither is a place anyone
 * needs bringing back to.
 */
export function rememberPosition(url: string, fraction: number, now = Date.now()) {
  if (!url || !Number.isFinite(fraction)) return;
  const positions = load();
  if (fraction < MIN_FRACTION || fraction > DONE_FRACTION) {
    if (!(url in positions)) return;
    delete positions[url];
    store(positions);
    return;
  }
  positions[url] = { fraction: Math.round(fraction * 1000) / 1000, at: now };
  store(prune(positions, now));
}

export function forgetPosition(url: string) {
  const positions = load();
  if (!(url in positions)) return;
  delete positions[url];
  store(positions);
}

/** Every article with a place saved in it — for marking rows in the list. */
export function allPositions(now = Date.now()): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [url, entry] of Object.entries(load())) {
    if (now - entry.at <= MAX_AGE_MS) out[url] = entry.fraction;
  }
  return out;
}

export function prune(positions: Positions, now = Date.now()): Positions {
  return Object.fromEntries(
    Object.entries(positions)
      .filter(([, entry]) => now - entry.at <= MAX_AGE_MS)
      .sort((a, b) => b[1].at - a[1].at)
      .slice(0, MAX_ENTRIES),
  );
}
