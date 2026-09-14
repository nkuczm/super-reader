/**
 * Keeping what a feed has already said.
 *
 * A feed is a window, not an archive: it holds the last twenty or forty
 * things a desk filed and drops the rest. The reader used to show exactly
 * that window — every refresh replaced the list with whatever the feeds were
 * carrying at that moment — so anything published and pushed back out between
 * two visits was never seen at all, and there was nothing to say it had
 * happened. The WSJ's markets desk turns its feed over in under two days.
 *
 * So a refresh now merges into what is already held rather than replacing it.
 * The cost of keeping everything for ever would be a list nobody can scroll
 * and a phone that struggles to render it, so the window is bounded: recent
 * enough to be worth reading, and few enough per source that one busy desk
 * cannot crowd out a quiet one.
 */

export type Held = {
  id: string;
  link: string;
  sourceId: string;
  publishedAt?: string;
  /** When this device first saw it — the only date an undated item has. */
  seenAt?: number;
};

export const KEEP_DAYS = 14;
export const KEEP_PER_SOURCE = 250;

type Options = {
  /** Sources the reader still follows; anything else is dropped. */
  sources: ReadonlySet<string>;
  canonical: (link: string) => string;
  now?: number;
  keepDays?: number;
  perSource?: number;
};

function ageOf(article: Held, now: number) {
  const published = article.publishedAt ? Date.parse(article.publishedAt) : NaN;
  if (Number.isFinite(published)) return now - published;
  // No date of its own: fall back to when it turned up here, and treat
  // anything that has not even got that as new rather than ancient.
  return article.seenAt ? now - article.seenAt : 0;
}

/**
 * Merge a refresh into what was already held.
 *
 * The fetched copy wins on ties: it is the publisher's current version of the
 * story, with whatever they have since corrected in it. Order is left to the
 * caller, which sorts the whole list the same way it always did.
 */
export function mergeWindow<T extends Held>(
  fetched: T[],
  held: T[],
  { sources, canonical, now = Date.now(), keepDays = KEEP_DAYS, perSource = KEEP_PER_SOURCE }: Options,
): T[] {
  const cutoff = keepDays * 24 * 60 * 60 * 1000;
  const byKey = new Map<string, T>();

  // Held first, so a fetched copy of the same story overwrites it.
  for (const article of [...held, ...fetched]) {
    if (!article?.link || !sources.has(article.sourceId)) continue;
    if (ageOf(article, now) > cutoff) continue;
    const key = canonical(article.link);
    const existing = byKey.get(key);
    byKey.set(key, {
      ...article,
      // Keep the day it first appeared here, not the day it was re-read.
      seenAt: existing?.seenAt ?? article.seenAt ?? now,
    });
  }

  // Bounded per source rather than overall: a desk that files hourly would
  // otherwise push a weekly column out of a list it should still be in.
  const counts = new Map<string, number>();
  const kept: T[] = [];
  for (const article of [...byKey.values()].sort(
    (a, b) => ageOf(a, now) - ageOf(b, now),
  )) {
    const count = counts.get(article.sourceId) ?? 0;
    if (count >= perSource) continue;
    counts.set(article.sourceId, count + 1);
    kept.push(article);
  }
  return kept;
}

/** What a fresh fetch looks like before it has ever been held. */
export function stamp<T extends Held>(articles: T[], now = Date.now()): T[] {
  return articles.map((article) => ({ ...article, seenAt: article.seenAt ?? now }));
}
