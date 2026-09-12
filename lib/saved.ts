/**
 * Merging bookmarks across devices.
 *
 * The rest of the synced document resolves by "most recent change wins",
 * which suits a feed list: it changes rarely, and when it does the newest
 * arrangement is the one wanted. Bookmarks are not like that. Both devices
 * add to the list constantly, and whole-list replacement means the phone
 * saving something on the train silently deletes what the desktop saved that
 * morning. Nobody would notice until they went looking for the article.
 *
 * So saved articles merge instead: the union of both sides, each entry kept
 * in whichever copy is newer. Un-saving needs a record of its own —
 * otherwise the other device, still holding the article, simply puts it
 * back — so a removal leaves a dated tombstone, and a tombstone suppresses
 * the article until a later save supersedes it.
 */

import type { Article } from "./types";
import { canonicalUrl } from "./url";

/**
 * A bookmarked article. The whole record is kept, not just its id: an
 * article drops out of its feed after a few weeks, and a saved one has to
 * outlive that — the point of saving it is that it is still there later.
 */
export type SavedArticle = Article & {
  /** Which source it came from, for the byline when the feed no longer has it. */
  sourceId?: string;
  sourceTitle?: string;
  favicon?: string;
  savedAt: number;
  /**
   * Saved because it was quoted in a note, rather than by the reader pressing
   * Save. Only these are cleaned up when the quote goes — see lib/notes.ts.
   * Device-local bookkeeping: `slimForSync` drops it, so a copy arriving from
   * another device never turns someone's own bookmark into a disposable one.
   */
  viaNote?: boolean;
};

/** An un-save, dated, so it survives a sync with a device that still has it. */
export type SavedRemoval = { link: string; at: number };

/**
 * Bookmarks are small individually, but the synced document has a 512KB
 * ceiling that the feed list and read-marks also draw on — and a payload
 * over it is refused outright, which would break syncing altogether rather
 * than just losing a bookmark. 400 slimmed records is roughly 150KB.
 */
export const MAX_SAVED = 400;
/** Long enough to recognise the article, short enough to sync hundreds. */
const SYNC_SUMMARY_CHARS = 200;
/** A tombstone only has to outlive the slowest device's absence. */
export const REMOVAL_TTL_MS = 90 * 24 * 60 * 60 * 1000;
const MAX_REMOVALS = 400;

export type SavedState = {
  saved: SavedArticle[];
  removals: SavedRemoval[];
};

function keyOf(link: string) {
  return canonicalUrl(link);
}

/**
 * Union of two devices' bookmarks.
 *
 * Order of the result is newest-saved first, which is the order the list is
 * read in. Pure, so the interesting part — what happens when one device
 * saved something the other removed — is testable without a database.
 */
export function mergeSaved(
  mine: SavedState,
  theirs: SavedState,
  now = Date.now(),
): SavedState {
  const removals = new Map<string, number>();
  for (const removal of [...(mine.removals ?? []), ...(theirs.removals ?? [])]) {
    if (!removal?.link) continue;
    const at = Number(removal.at) || 0;
    // Long-expired tombstones are dropped: by then every device has seen the
    // removal, and keeping them would grow the document forever.
    if (now - at > REMOVAL_TTL_MS) continue;
    const key = keyOf(removal.link);
    removals.set(key, Math.max(removals.get(key) ?? 0, at));
  }

  const best = new Map<string, SavedArticle>();
  for (const article of [...(mine.saved ?? []), ...(theirs.saved ?? [])]) {
    if (!article?.link) continue;
    const key = keyOf(article.link);
    const savedAt = Number(article.savedAt) || 0;
    const current = best.get(key);
    if (!current || savedAt > (Number(current.savedAt) || 0)) {
      best.set(key, { ...article, savedAt });
    }
  }

  const saved: SavedArticle[] = [];
  for (const [key, article] of best) {
    const removedAt = removals.get(key);
    // A removal only wins while it is the most recent thing to happen to the
    // article. Saving it again afterwards brings it back.
    if (removedAt !== undefined && removedAt >= (Number(article.savedAt) || 0)) {
      continue;
    }
    // A save later than the tombstone makes the tombstone pointless, and
    // keeping it would suppress the article on a device that merges in the
    // other order.
    if (removedAt !== undefined) removals.delete(key);
    saved.push(article);
  }

  saved.sort((a, b) => (Number(b.savedAt) || 0) - (Number(a.savedAt) || 0));

  const keptRemovals = [...removals.entries()]
    .map(([link, at]) => ({ link, at }))
    .sort((a, b) => b.at - a.at)
    .slice(0, MAX_REMOVALS);

  return { saved: saved.slice(0, MAX_SAVED), removals: keptRemovals };
}

/** Whether a merge produced anything the other side did not already have. */
export function differsFrom(merged: SavedState, theirs: SavedState) {
  const keys = (state: SavedState) =>
    new Set((state.saved ?? []).map((article) => keyOf(article.link)));
  const ours = keys(merged);
  const other = keys(theirs);
  if (ours.size !== other.size) return true;
  for (const key of ours) if (!other.has(key)) return true;
  // A removal this device knows about and the other does not still has to
  // travel, or the article comes back on the next sync.
  const theirRemovals = new Set(
    (theirs.removals ?? []).map((removal) => keyOf(removal.link)),
  );
  return (merged.removals ?? []).some(
    (removal) => !theirRemovals.has(keyOf(removal.link)),
  );
}

/**
 * The copy that goes over the wire.
 *
 * A saved record holds whatever the feed gave it, and a few hundred of those
 * with full summaries would push the synced document past the size the route
 * accepts — at which point nothing syncs, not just bookmarks. The summary is
 * the only field with real length, so it is trimmed; everything needed to
 * show the entry and open it survives.
 *
 * A trimmed copy cannot overwrite a fuller local one: mergeSaved only
 * replaces on a strictly newer savedAt, and these carry the same stamp.
 */
export function slimForSync(articles: SavedArticle[]): SavedArticle[] {
  return articles.slice(0, MAX_SAVED).map((article) => ({
    id: article.id,
    title: article.title,
    link: article.link,
    savedAt: article.savedAt,
    ...(article.publishedAt ? { publishedAt: article.publishedAt } : {}),
    // Carried so the other device shows the date rather than a time its
    // source never gave — see lib/dates.ts.
    ...(article.datePrecision ? { datePrecision: article.datePrecision } : {}),
    ...(article.author ? { author: article.author } : {}),
    ...(article.image ? { image: article.image } : {}),
    ...(article.sourceId ? { sourceId: article.sourceId } : {}),
    ...(article.sourceTitle ? { sourceTitle: article.sourceTitle } : {}),
    ...(article.favicon ? { favicon: article.favicon } : {}),
    ...(article.summary
      ? { summary: article.summary.slice(0, SYNC_SUMMARY_CHARS) }
      : {}),
  }));
}
