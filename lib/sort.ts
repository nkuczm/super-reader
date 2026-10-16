import type { Article } from "./types";

/*
 * Each date string read once for the life of the page: the same few thousand
 * are sorted, windowed and grouped again on every refresh and every view, and
 * parsing them afresh each time was among the largest costs of opening the
 * app on a phone.
 */
const parsed = new Map<string, number>();

/** Milliseconds for sorting; undated items sort last rather than randomly. */
export function timeOf(article: { publishedAt?: string }) {
  const iso = article.publishedAt;
  if (!iso) return Number.NEGATIVE_INFINITY;
  let at = parsed.get(iso);
  if (at === undefined) {
    const ms = Date.parse(iso);
    at = Number.isNaN(ms) ? Number.NEGATIVE_INFINITY : ms;
    if (parsed.size >= 50_000) parsed.clear();
    parsed.set(iso, at);
  }
  return at;
}

/**
 * Newest first. Sorting is stable in modern JS engines, so items sharing a
 * timestamp — and undated ones — keep the order the source gave them.
 */
export function sortNewestFirst<T extends { publishedAt?: string }>(
  articles: T[],
): T[] {
  // Each date read once, not in every comparison: a sort compares each item
  // a dozen times over at a few thousand stories.
  const timed = articles.map((article) => ({ article, at: timeOf(article) }));
  timed.sort((a, b) => (b.at === a.at ? 0 : b.at - a.at || 0));
  return timed.map(({ article }) => article);
}
