/**
 * Watching a source for new posts.
 *
 * A watched source keeps a high-water mark: the publication time of the
 * newest post the reader has already been shown. Anything published after
 * that is an unread update, and the mark moves forward when they look at the
 * source — or acknowledge it — rather than when the app happens to fetch.
 *
 * A mark rather than a list of seen ids, for two reasons. It is one number
 * per source, so it syncs between devices without weighing down the synced
 * document; and it cannot grow stale in a way that resurrects an old post.
 */

import { timeOf } from "./sort";

export type WatchMark = {
  /** Publication time of the newest post already seen, in epoch ms. */
  at: number;
  /** Which post that was, so it is never counted as new again. */
  id?: string;
};

/** By source id. */
export type WatchMarks = Record<string, WatchMark>;

type Dated = { id: string; publishedAt?: string };

/**
 * The posts in this source that arrived after the mark.
 *
 * Strictly after: a post published in the same second as the marked one is
 * not flagged. That loses a rare simultaneous post, and in exchange no badge
 * can ever get stuck — which is what the alternative risks, since a mark can
 * only carry one id at that timestamp.
 *
 * A source with no mark yet reports nothing. Turning notifications on should
 * not immediately announce the forty posts already sitting in the feed.
 */
export function newSince<T extends Dated>(articles: T[], mark?: WatchMark): T[] {
  if (!mark || !(mark.at > 0)) return [];
  return articles.filter((article) => {
    if (article.id === mark.id) return false;
    const at = timeOf(article);
    // An undated post cannot be compared, so it is never an alert. Feeds
    // without dates therefore never raise one — see markFrom.
    return Number.isFinite(at) && at > mark.at;
  });
}

/**
 * The mark that says "everything here has been seen".
 *
 * Taken from the newest dated post. A source whose feed carries no dates at
 * all gets the current time, which means it will never raise an alert:
 * without dates there is nothing to compare a later post against, and
 * inventing an order would produce false alarms rather than useful ones.
 */
export function markFrom(articles: Dated[], now = Date.now()): WatchMark {
  let best: { at: number; id?: string } | null = null;
  for (const article of articles) {
    const at = timeOf(article);
    if (!Number.isFinite(at)) continue;
    if (!best || at > best.at) best = { at, id: article.id };
  }
  return best ?? { at: now };
}

/** Move a source's mark past everything currently in it. */
export function acknowledge(
  marks: WatchMarks,
  sourceId: string,
  articles: Dated[],
  now = Date.now(),
): WatchMarks {
  const next = markFrom(articles, now);
  const current = marks[sourceId];
  // Never move a mark backwards: an older fetch must not un-see posts.
  if (current && current.at > next.at) return marks;
  return { ...marks, [sourceId]: next };
}

/**
 * Merge two devices' marks by taking the later of each.
 *
 * Safe in both directions and needs no tombstones: a mark only ever moves
 * forward, so the later one has strictly more information — reading on the
 * desktop clears the phone's badge rather than the two fighting.
 */
export function mergeMarks(mine: WatchMarks, theirs: WatchMarks): WatchMarks {
  const merged: WatchMarks = { ...mine };
  for (const [sourceId, mark] of Object.entries(theirs ?? {})) {
    const current = merged[sourceId];
    if (!current || (mark?.at ?? 0) > current.at) merged[sourceId] = mark;
  }
  return merged;
}

/** Forget marks for sources that no longer exist, so they cannot pile up. */
export function pruneMarks(marks: WatchMarks, sourceIds: Iterable<string>): WatchMarks {
  const alive = new Set(sourceIds);
  const kept: WatchMarks = {};
  for (const [sourceId, mark] of Object.entries(marks ?? {})) {
    if (alive.has(sourceId)) kept[sourceId] = mark;
  }
  return kept;
}

export type Alert<T> = {
  /** The source the entry opens. */
  sourceId: string;
  /** Every watched source for this outlet — the same outlet can sit in more than one folder. */
  sourceIds: string[];
  /** Newest first. */
  articles: T[];
};

/**
 * What to show in the notifications tab: one entry per watched outlet with
 * unread posts, busiest first so the loudest is not buried.
 *
 * One per outlet, not per source: an outlet kept in two folders is two
 * sources, and with notifications on in both it was announced twice — the
 * same posts in two entries (1 Nov 2026). And each post once: a story two
 * watched outlets delivered is listed under its publisher's own (the source
 * it is filed under), or the first that has it.
 */
export function alertsFor<T extends Dated & { sourceId?: string }>(
  watched: { id: string; feedUrl?: string }[],
  bySource: Map<string, T[]>,
  marks: WatchMarks,
  outletOf: (source: { id: string; feedUrl?: string }) => string = (source) => source.feedUrl || source.id,
): Alert<T>[] {
  const outlets = new Map<string, string[]>();
  for (const source of watched) {
    const key = outletOf(source);
    const ids = outlets.get(key) ?? [];
    if (!ids.includes(source.id)) ids.push(source.id);
    outlets.set(key, ids);
  }
  const groups = [...outlets.values()].map((sourceIds) => {
    const fresh = new Map<string, T>();
    for (const id of sourceIds) for (const article of newSince(bySource.get(id) ?? [], marks[id])) fresh.set(article.id, article);
    return { sourceIds, fresh };
  });
  // Where each post is listed: with the outlet it is filed under, if that one is watched.
  const home = new Map<string, number>();
  groups.forEach((group, g) => {
    for (const [id, article] of group.fresh) {
      const owner = article.sourceId !== undefined && group.sourceIds.includes(article.sourceId);
      if (!home.has(id) || (owner && !groups[home.get(id)!].sourceIds.includes(article.sourceId!))) home.set(id, g);
    }
  });
  const alerts: Alert<T>[] = [];
  groups.forEach((group, g) => {
    const articles = [...group.fresh].filter(([id]) => home.get(id) === g).map(([, article]) => article);
    if (articles.length > 0) {
      alerts.push({
        sourceId: group.sourceIds[0],
        sourceIds: group.sourceIds,
        articles: articles.sort((a, b) => timeOf(b) - timeOf(a)),
      });
    }
  });
  return alerts.sort((a, b) => b.articles.length - a.articles.length);
}
