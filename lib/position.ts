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

/**
 * A fraction of 0 is a *cleared* place, kept with its date rather than
 * deleted. Places sync between devices by "most recent change wins", and a
 * plain deletion loses to the other device's older copy: finish a story on
 * the laptop, and the phone would hand back the place it still held, three
 * paragraphs from the end. A dated clear outranks it.
 */
export type Position = { fraction: number; at: number };
export type Positions = Record<string, Position>;

/** Announced when a place is left, which is when it is worth syncing. */
export const POSITIONS_EVENT = "super-reader:positions";

export function loadPositions(): Positions {
  return load();
}

export function savePositions(positions: Positions) {
  store(prune(positions));
}

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
export function rememberPosition(
  url: string,
  fraction: number,
  /** Tell the app this place is settled and worth syncing — on leaving, not per scroll. */
  announce = false,
  now = Date.now(),
) {
  if (!url || !Number.isFinite(fraction)) return;
  const positions = load();
  const cleared = fraction < MIN_FRACTION || fraction > DONE_FRACTION;
  if (cleared) {
    // Nothing held here, so there is nothing for another device to be told.
    if (!positions[url] || positions[url].fraction === 0) return;
    positions[url] = { fraction: 0, at: now };
  } else {
    const rounded = Math.round(fraction * 1000) / 1000;
    // Unchanged places are not re-dated: a re-dated place would count as news
    // and push a sync for a scroll of nothing.
    if (positions[url]?.fraction === rounded) {
      if (announce) announcePositions();
      return;
    }
    positions[url] = { fraction: rounded, at: now };
  }
  store(prune(positions, now));
  if (announce) announcePositions();
}

export function forgetPosition(url: string, now = Date.now()) {
  const positions = load();
  if (!positions[url] || positions[url].fraction === 0) return;
  positions[url] = { fraction: 0, at: now };
  store(positions);
  announcePositions();
}

function announcePositions() {
  if (typeof window === "undefined" || typeof window.dispatchEvent !== "function") return;
  window.dispatchEvent(new Event(POSITIONS_EVENT));
}

/**
 * Two devices' places, merged: for each article the more recent change wins,
 * whether that was reading further, reading less, finishing, or starting over.
 * Pure, so it runs the same in the browser and in writeSync on the server.
 */
export function mergePositions(mine: Positions, theirs: Positions, now = Date.now()): Positions {
  const merged: Positions = {};
  for (const source of [mine ?? {}, theirs ?? {}]) {
    for (const [url, entry] of Object.entries(source)) {
      const fraction = Number(entry?.fraction);
      const at = Number(entry?.at);
      if (!url || !Number.isFinite(fraction) || !Number.isFinite(at)) continue;
      if (!merged[url] || at > merged[url].at) merged[url] = { fraction, at };
    }
  }
  return prune(merged, now);
}

/**
 * The copy that goes over the wire. The synced document has one size ceiling
 * shared with feeds, bookmarks and notes, so places get a modest share of it:
 * the most recent 200, which is weeks of reading.
 */
export function slimPositionsForSync(positions: Positions, now = Date.now()): Positions {
  return Object.fromEntries(Object.entries(prune(positions, now)).slice(0, 200));
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

/**
 * Whether two sets of places say the same thing, whatever order they are in.
 * Deciding "this device has news to send" by comparing serialised JSON would
 * see a reordering as a change, and two idle devices would push to each other
 * on every focus — which is how read marks once behaved.
 */
export function samePositions(a: Positions, b: Positions): boolean {
  const left = Object.entries(a ?? {});
  if (left.length !== Object.keys(b ?? {}).length) return false;
  return left.every(([url, entry]) => {
    const other = b[url];
    return !!other && other.fraction === entry.fraction && other.at === entry.at;
  });
}
