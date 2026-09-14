import { sortNewestFirst } from "./sort";
import { canonicalUrl } from "./url";

/**
 * Several sources' articles as one list.
 *
 * The reader asks for one source per request now, so these arrive one at a
 * time and in no particular order. That must not show: the list is rebuilt
 * from all of them in the order the sidebar lists the sources, which is what
 * decides which copy of a story survives deduplication. Merging in arrival
 * order instead would file a story under whichever feed happened to answer
 * first, and move it to another one on the next refresh.
 */
export function mergeBySource<T extends { link: string; publishedAt?: string }>(
  /** Source ids, in the order the reader has them. */
  order: string[],
  bySource: Map<string, T[]>,
): T[] {
  const merged: T[] = [];
  // One article, once. Two of a paper's feeds carry the same story with
  // different tracking parameters, which is how the list ended up showing the
  // same WSJ piece twice in a row.
  const seen = new Set<string>();

  for (const sourceId of order) {
    for (const article of bySource.get(sourceId) ?? []) {
      const key = canonicalUrl(article.link);
      if (seen.has(key)) continue;
      seen.add(key);
      merged.push(article);
    }
  }
  return sortNewestFirst(merged);
}
