import type { Article } from "./types";

/** Milliseconds for sorting; undated items sort last rather than randomly. */
export function timeOf(article: { publishedAt?: string }) {
  if (!article.publishedAt) return Number.NEGATIVE_INFINITY;
  const parsed = Date.parse(article.publishedAt);
  return Number.isNaN(parsed) ? Number.NEGATIVE_INFINITY : parsed;
}

/**
 * Newest first. Sorting is stable in modern JS engines, so items sharing a
 * timestamp — and undated ones — keep the order the source gave them.
 */
export function sortNewestFirst<T extends { publishedAt?: string }>(
  articles: T[],
): T[] {
  return [...articles].sort((a, b) => timeOf(b) - timeOf(a));
}
