/**
 * How much of what was published did we actually catch?
 *
 * The tempting measure is how many articles a source returns, and it is the
 * wrong one. Four hundred stories spanning a year is worse coverage than a
 * hundred from the last day: the first is an archive that happens to be
 * large, the second is a newsroom's output caught in full. What a reader
 * loses when collection degrades is not volume, it is *recall inside a
 * window* — the stories filed since they last looked that never arrived.
 *
 * So coverage is measured as a fraction, over a stated period:
 *
 *     caught in the window ÷ published in the window
 *
 * The denominator is the hard part, because nothing tells us what a
 * publisher filed. Two usable approximations, in order of trust:
 *
 *   1. The news sitemap. Publishers who keep one are obliged to list
 *      everything from roughly the last 48 hours, which makes it the closest
 *      thing to ground truth that exists — and the reason it is worth reading
 *      as a yardstick even at sites where feeds already collect well.
 *   2. The union of every route. Where no sitemap exists, the best available
 *      estimate of what was published is everything any route found. A route
 *      is then scored on what share of that union it caught alone, which
 *      cannot detect a story every route missed, and does detect a route
 *      quietly falling behind the others.
 *
 * The honest limitation is stated rather than hidden: where the denominator
 * is the union, this measures agreement between routes, not truth.
 */

import { canonicalUrl } from "./url";

export type Windowed = { link: string; publishedAt?: string };

export const DEFAULT_WINDOW_HOURS = 48;

/** Articles published inside the window, by their own dates. */
export function inWindow<T extends Windowed>(
  articles: T[],
  hours = DEFAULT_WINDOW_HOURS,
  now = Date.now(),
): T[] {
  const cutoff = now - hours * 3600_000;
  return articles.filter((article) => {
    const at = Date.parse(article.publishedAt ?? "");
    // An undated item cannot be placed in the window. Counting it would
    // inflate recall with things that may be years old, so it sits out of
    // the measurement without being thrown away by the caller.
    return Number.isFinite(at) && at >= cutoff && at <= now + 3600_000;
  });
}

export type Reference = {
  /** What we believe was published in the window. */
  links: Set<string>;
  /** Where that belief came from, in words. */
  basis: "news sitemap" | "every route combined";
  count: number;
};

export function referenceOf(
  sitemapArticles: Windowed[],
  allArticles: Windowed[],
  hours = DEFAULT_WINDOW_HOURS,
  now = Date.now(),
): Reference {
  // Distinct stories, not records: the same piece found by three routes is
  // one thing published. Counting records would inflate the denominator and
  // make every route look worse than it is.
  const keys = (articles: Windowed[]) =>
    new Set(inWindow(articles, hours, now).map((article) => canonicalUrl(article.link)));

  const sitemap = keys(sitemapArticles);
  // A sitemap with a handful of entries is not a census of the window —
  // the Verge publishes 17 there — so it only counts as ground truth when
  // it is plausibly complete relative to what everything else found.
  const union = keys(allArticles);
  const useSitemap = sitemap.size >= Math.max(10, union.size * 0.6);
  const chosen = useSitemap ? sitemap : union;
  return {
    links: chosen,
    basis: useSitemap ? "news sitemap" : "every route combined",
    count: chosen.size,
  };
}

export type RouteCoverage = {
  route: string;
  /** In-window stories this route returned. */
  caught: number;
  /** Share of the reference set this route caught alone, 0 to 1. */
  recall: number;
  /** In-window stories no other route found. */
  only: number;
};

export type CoverageReport = {
  windowHours: number;
  /** In-window stories the reader ends up with. */
  caught: number;
  /** In-window stories we believe exist. */
  published: number;
  recall: number;
  basis: Reference["basis"];
  /** What each route contributed, worst-to-best left to the caller. */
  byRoute: RouteCoverage[];
  /** In-window stories some route found that the final list does not carry. */
  lostToFiltering: number;
};

/**
 * Score a harvest: what each route caught, and what the union caught.
 *
 * `byRoute` is the number that decides whether a route earns the request it
 * costs. A route with a high `caught` and an `only` of zero is duplicating
 * work; a route with a low `caught` and a high `only` is cheap insurance and
 * should be kept. Neither is visible from article counts alone.
 */
export function coverageOf(
  final: Windowed[],
  byRoute: Record<string, Windowed[]>,
  {
    hours = DEFAULT_WINDOW_HOURS,
    now = Date.now(),
    sitemap = [],
  }: { hours?: number; now?: number; sitemap?: Windowed[] } = {},
): CoverageReport {
  const everything = Object.values(byRoute).flat();
  const reference = referenceOf(sitemap, everything, hours, now);

  const keysOf = (articles: Windowed[]) =>
    new Set(inWindow(articles, hours, now).map((article) => canonicalUrl(article.link)));

  const perRoute = Object.entries(byRoute).map(([route, articles]) => ({
    route,
    keys: keysOf(articles),
  }));

  const routes: RouteCoverage[] = perRoute.map(({ route, keys }) => {
    let only = 0;
    for (const key of keys) {
      if (!perRoute.some((other) => other.route !== route && other.keys.has(key))) only += 1;
    }
    const hit = [...keys].filter((key) => reference.links.has(key)).length;
    return {
      route,
      caught: keys.size,
      recall: reference.count === 0 ? 0 : round(hit / reference.count),
      only,
    };
  });

  const finalKeys = keysOf(final);
  const caught = [...finalKeys].filter((key) => reference.links.has(key)).length;
  const everythingKeys = keysOf(everything);
  let lost = 0;
  for (const key of everythingKeys) if (!finalKeys.has(key)) lost += 1;

  return {
    windowHours: hours,
    caught,
    published: reference.count,
    recall: reference.count === 0 ? 0 : round(caught / reference.count),
    basis: reference.basis,
    byRoute: routes.sort((a, b) => b.recall - a.recall),
    lostToFiltering: lost,
  };
}

function round(value: number) {
  return Math.round(value * 1000) / 1000;
}
