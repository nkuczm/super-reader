/**
 * Which stories are new to the reader.
 *
 * A refresh merges into what the device already holds (lib/window.ts), and
 * the list is ordered by date or by ranking — so a story that has just come
 * in sits among the ones that were there before, looking exactly like them.
 * This keeps a note of what each refresh brought, so the list can light the
 * new ones up until they have been looked at.
 *
 * "New" is deliberately narrow. A story is new when a refresh brings it to a
 * source this device was already following and had stories from: the first
 * fill of a source just added, or of a device just signed in, is the whole
 * backlog arriving at once, and lighting all of it up would mark nothing.
 *
 * And it ends. Opening a story ends it for that story; coming back to the
 * app after being away (AWAY_MS) ends it for everything the last visit
 * brought, which has been seen, so the next visit lights up only what is new
 * since then. A highlight that never ended would only be "unread" again.
 *
 * Kept on the device, like the list it describes.
 */

/** Canonical link → when it came in. */
export type Fresh = Record<string, number>;

/** Gone this long, and what the last visit brought counts as seen. */
export const AWAY_MS = 30 * 60 * 1000;

const FRESH_KEY = "super-reader:fresh";
const ACTIVE_KEY = "super-reader:last-active";

type Arriving = { link: string; sourceId: string; alsoIn?: string[] };

/**
 * What a refresh brought that the device has never held, from sources it
 * already had stories from — as canonical links.
 */
export function arrivals<T extends Arriving>(fetched: T[], held: Arriving[], canonical: (link: string) => string): string[] {
  const heldLinks = new Set(held.map((article) => canonical(article.link)));
  const heldSources = new Set(held.flatMap((article) => [article.sourceId, ...(article.alsoIn ?? [])]));
  const found = new Set<string>();
  for (const article of fetched) {
    if (!article?.link) continue;
    const key = canonical(article.link);
    if (heldLinks.has(key)) continue;
    if (![article.sourceId, ...(article.alsoIn ?? [])].some((id) => heldSources.has(id))) continue;
    found.add(key);
  }
  return [...found];
}

/**
 * The note after a refresh: what it brought added, and anything no longer in
 * the list let go (a story the window has dropped is not waiting to be found).
 */
export function noteArrivals(fresh: Fresh, brought: string[], inList: ReadonlySet<string>, now = Date.now()): Fresh {
  const next: Fresh = {};
  for (const [key, at] of Object.entries(fresh)) if (inList.has(key)) next[key] = at;
  for (const key of brought) if (inList.has(key) && next[key] === undefined) next[key] = now;
  return next;
}

/** Everything that came in at or before `before` — a visit's worth, seen. */
export function seenBefore(fresh: Fresh, before: number): Fresh {
  const next: Fresh = {};
  for (const [key, at] of Object.entries(fresh)) if (at > before) next[key] = at;
  return next;
}

export function loadFresh(): Fresh {
  try {
    const raw = JSON.parse(window.localStorage.getItem(FRESH_KEY) ?? "{}");
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
    const fresh: Fresh = {};
    for (const [key, at] of Object.entries(raw)) if (typeof at === "number" && Number.isFinite(at)) fresh[key] = at;
    return fresh;
  } catch {
    return {};
  }
}

export function saveFresh(fresh: Fresh) {
  try {
    window.localStorage.setItem(FRESH_KEY, JSON.stringify(fresh));
  } catch {
    /* storage full or blocked: the highlight lasts this visit only */
  }
}

/** When the reader last had the app in front of them. */
export function loadLastActive(): number | null {
  try {
    const at = Number(window.localStorage.getItem(ACTIVE_KEY));
    return Number.isFinite(at) && at > 0 ? at : null;
  } catch {
    return null;
  }
}

export function saveLastActive(at = Date.now()) {
  try {
    window.localStorage.setItem(ACTIVE_KEY, String(at));
  } catch {
    /* nothing to do */
  }
}
