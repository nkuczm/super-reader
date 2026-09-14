/**
 * Collect everything a site is publishing, from every route it offers.
 *
 * The old shape of this was a ladder: try each route in turn, return the
 * first that answers. That is the right shape for *identifying* a source and
 * the wrong shape for *collecting* from one, because the routes do not rank
 * consistently. Measured from the deployment:
 *
 *   The Guardian   news sitemap 429 stories   ·  section feed a few dozen
 *   New York Times news sitemap 442 stories   ·  one declared feed
 *   CNN            news sitemap 108 stories   ·  no declared feed at all
 *   The Verge      news sitemap  17 stories   ·  feed carries more
 *   TechCrunch     news sitemap  11 stories   ·  search feed a year deep
 *
 * There is no ordering of those routes that wins everywhere. A ladder that
 * puts sitemaps first loses stories at the Verge; one that puts feeds first
 * loses three hundred at the Guardian. So this runs them together and merges,
 * which is strictly better than any single choice and costs a few parallel
 * requests.
 *
 * Merging is where the care goes. The same story arrives from three routes
 * with three different amounts of detail — the sitemap knows the headline and
 * the exact publication time, the feed knows the summary and the image, the
 * scrape knows almost nothing — so records are combined field by field rather
 * than one winning outright. What comes out is better than any route produced
 * on its own.
 */

import { canonicalUrl } from "./url";
import { fetchText, looksLikeFeed, parseFeed } from "./feed";
import { harvestSitemap } from "./sitemap";
import { articlesFromStructured, searchTemplateFrom } from "./structured";
import { searchRoutes, webSearchFeed } from "./sitesearch";
import { scrapePage } from "./scrape";
import { keepArticles, type Options as AuthenticOptions } from "./authentic";
import { matchOf, parseQuery, rankByRelevance, type Query } from "./relevance";
import { sortNewestFirst } from "./sort";
import { parseBundle } from "./bundle";
import { coverageOf, inWindow, type CoverageReport } from "./coverage";
import type { Article } from "./types";

export type Route =
  | "feed"
  | "bundle"
  | "sitemap"
  | "structured"
  | "scrape"
  | "search";

export type RouteReport = {
  route: Route;
  /** What was read, so a thin result can be explained rather than guessed at. */
  url: string;
  ok: boolean;
  found: number;
  /** Stories this route contributed that no other route had. */
  unique?: number;
  why?: string;
  ms: number;
};

export type Harvest = {
  articles: Article[];
  routes: RouteReport[];
  /** Dropped as furniture, with the commonest reason. */
  rejected: number;
  /** Dropped for not matching the search. */
  offTopic: number;
  /**
   * How much of the window we caught. The measure that matters: a big pile
   * of old articles is not coverage, and this is what says so.
   */
  coverage: CoverageReport;
};

export const DEFAULT_LIMIT = 200;

type Plan = {
  /** Feeds already known for this source — declared, conventional, bundled. */
  feeds?: string[];
  /** The listing page, when there is one worth reading. */
  page?: { url: string; body?: string };
  /** The site root, used for sitemaps and site-scoped search. */
  origin?: string;
  /** A search to satisfy, if this is a question rather than a subscription. */
  query?: string;
  limit?: number;
  /** Skip routes that cost a request when the caller only wants a preview. */
  cheap?: boolean;
  /**
   * The period coverage is measured over. Not a filter — articles outside it
   * are still collected and still shown; this is the window recall is scored
   * against, so a route can be judged on what it caught rather than on how
   * much it returned.
   */
  windowHours?: number;
};

/** Read one feed URL into articles, tolerating anything that is not one. */
async function readFeedRoute(url: string): Promise<{ articles: Article[]; why?: string }> {
  const { body, finalUrl } = await fetchText(url, 12000);
  if (!looksLikeFeed(body)) return { articles: [], why: "answered, but not with a feed" };
  const { articles } = parseFeed(body, finalUrl);
  return { articles };
}

/**
 * Combine two records of the same story.
 *
 * Field by field, longest-wins for text: a sitemap headline is the desk's
 * current wording, a feed summary is real prose, and an empty string from one
 * route must never overwrite a real value from another. This is the function
 * that makes the union worth more than its parts.
 */
export function combine(a: Article, b: Article): Article {
  const better = (x?: string, y?: string) => {
    if (!x) return y;
    if (!y) return x;
    return y.length > x.length ? y : x;
  };
  return {
    ...a,
    ...b,
    id: a.id || b.id,
    link: a.link || b.link,
    title: better(a.title, b.title) ?? "",
    summary: better(a.summary, b.summary),
    image: a.image ?? b.image,
    author: a.author ?? b.author,
    // The earliest credible publication date: a sitemap's lastmod drifts
    // forward every time a story is touched, and the first one is the truth.
    publishedAt: earliest(a.publishedAt, b.publishedAt),
    attachments: a.attachments ?? b.attachments,
    comments: a.comments ?? b.comments,
    commentCount: a.commentCount ?? b.commentCount,
  };
}

function earliest(a?: string, b?: string): string | undefined {
  if (!a) return b;
  if (!b) return a;
  const at = Date.parse(a);
  const bt = Date.parse(b);
  if (!Number.isFinite(at)) return b;
  if (!Number.isFinite(bt)) return a;
  return at <= bt ? a : b;
}

/**
 * Run every route this source offers and merge what they return.
 *
 * Routes run in parallel and none of them can fail the whole harvest: a
 * publisher that 403s its sitemap while serving its feed should give us the
 * feed, not an error. A route that returns nothing is reported, because a
 * route that has silently stopped working is the failure this whole design
 * exists to make visible.
 */
export async function harvest(plan: Plan): Promise<Harvest> {
  const limit = plan.limit ?? DEFAULT_LIMIT;
  const query: Query = parseQuery(plan.query ?? "");
  const routes: RouteReport[] = [];
  const collected: { article: Article; from: AuthenticOptions["from"] }[] = [];
  /** What each route returned, kept separately so coverage can be scored. */
  const byRoute: Record<string, Article[]> = {};

  const run = async (
    route: Route,
    url: string,
    from: AuthenticOptions["from"],
    work: () => Promise<{ articles: Article[]; why?: string }>,
  ) => {
    const started = Date.now();
    try {
      const { articles, why } = await work();
      routes.push({ route, url, ok: articles.length > 0, found: articles.length, why, ms: Date.now() - started });
      (byRoute[route] ??= []).push(...articles);
      for (const article of articles) collected.push({ article, from });
    } catch (error) {
      routes.push({
        route,
        url,
        ok: false,
        found: 0,
        why: error instanceof Error ? error.message : "failed",
        ms: Date.now() - started,
      });
    }
  };

  const jobs: Promise<void>[] = [];

  // 1. Every feed we already know about — declared, conventional, or the
  //    members of a bundle. All of them, not the first that answers.
  const feeds = (plan.feeds ?? []).flatMap((url) => parseBundle(url) ?? [url]);
  for (const url of [...new Set(feeds)].slice(0, 10)) {
    jobs.push(run("feed", url, "feed", () => readFeedRoute(url)));
  }

  // 2. The news sitemap. The single largest source of stories at the
  //    publishers that keep one, and the only structured route at CNN.
  if (plan.origin && !plan.cheap) {
    const site = plan.page?.url ?? plan.origin;
    jobs.push(
      run("sitemap", `${plan.origin}/robots.txt`, "sitemap", async () => {
        const found = await harvestSitemap(site, { limit });
        return {
          articles: found.articles,
          why: found.read.length === 0 ? "no news sitemap published" : undefined,
        };
      }),
    );
  }

  // 3. What the listing page declares about itself, then what it links.
  //    Both read from one already-fetched body, so they cost no extra request.
  const body = plan.page?.body;
  const pageUrl = plan.page?.url;
  if (body && pageUrl) {
    jobs.push(
      run("structured", pageUrl, "structured", async () => {
        const articles = articlesFromStructured(body, pageUrl);
        return { articles, why: articles.length ? undefined : "no listing data declared" };
      }),
    );
    jobs.push(
      run("scrape", pageUrl, "scrape", async () => {
        try {
          const { articles } = scrapePage(body, pageUrl);
          return { articles };
        } catch (error) {
          return { articles: [], why: error instanceof Error ? error.message : "nothing to scrape" };
        }
      }),
    );
  }

  // 4. The archive, when there is a question to ask it. This is what reaches
  //    past every window the other routes are limited to.
  if (!query.empty && plan.origin && !plan.cheap) {
    const declared = body ? searchTemplateFrom(body) : undefined;
    for (const route of searchRoutes(plan.origin, plan.query ?? "", declared).slice(0, 2)) {
      jobs.push(run("search", route.url, "search", () => readFeedRoute(route.url)));
    }
  }

  await Promise.all(jobs);

  // Merge: one record per story, richest version of every field.
  const byKey = new Map<string, { article: Article; from: AuthenticOptions["from"] }>();
  const firstSeenBy = new Map<string, Route>();
  for (const entry of collected) {
    if (!entry.article?.link) continue;
    const key = canonicalUrl(entry.article.link);
    const existing = byKey.get(key);
    if (existing) {
      byKey.set(key, {
        article: combine(existing.article, entry.article),
        // Trust the strongest claim anyone made about this story.
        from: strongest(existing.from, entry.from),
      });
    } else {
      byKey.set(key, entry);
      if (!firstSeenBy.has(key)) firstSeenBy.set(key, routeFor(entry.from));
    }
  }

  // Furniture out, one judgement per story using the best claim we have.
  let rejected = 0;
  const real: Article[] = [];
  for (const entry of byKey.values()) {
    const { kept, dropped } = keepArticles([entry.article], {
      origin: plan.origin,
      from: entry.from,
    });
    rejected += dropped.length;
    real.push(...kept);
  }

  // Then, if a question was asked, only things that answer it.
  let offTopic = 0;
  let answered = real;
  if (!query.empty) {
    answered = real.filter((article) => matchOf(article, query).matches);
    offTopic = real.length - answered.length;
  }

  const ordered = query.empty
    ? sortNewestFirst(answered)
    : rankByRelevance(answered, query);

  // Report what each route uniquely contributed — the number that says
  // whether a route is earning the request it costs. Counted inside the
  // window, because a route that only ever turns up year-old archive pieces
  // is not improving coverage however many it returns.
  const windowHours = plan.windowHours;
  const inside = new Set(
    inWindow(ordered, windowHours).map((article) => canonicalUrl(article.link)),
  );
  const uniqueBy = new Map<Route, number>();
  for (const [key, route] of firstSeenBy) {
    if (inside.has(key)) uniqueBy.set(route, (uniqueBy.get(route) ?? 0) + 1);
  }
  for (const report of routes) {
    if (report.route !== "bundle") report.unique = uniqueBy.get(report.route) ?? 0;
  }

  // The final list is capped for the reader; coverage is scored on everything
  // that survived filtering, so a cap can never flatter the measurement.
  const coverage = coverageOf(ordered, byRoute, {
    hours: windowHours,
    sitemap: byRoute.sitemap ?? [],
  });

  return { articles: ordered.slice(0, limit), routes, rejected, offTopic, coverage };
}

const TRUST_ORDER: AuthenticOptions["from"][] = ["scrape", "search", "structured", "sitemap", "feed"];

function strongest(
  a: AuthenticOptions["from"],
  b: AuthenticOptions["from"],
): AuthenticOptions["from"] {
  return TRUST_ORDER.indexOf(a) >= TRUST_ORDER.indexOf(b) ? a : b;
}

function routeFor(from: AuthenticOptions["from"]): Route {
  switch (from) {
    case "feed": return "feed";
    case "sitemap": return "sitemap";
    case "structured": return "structured";
    case "search": return "search";
    default: return "scrape";
  }
}

/** A topic with no site attached: the web search, filtered to real answers. */
export async function harvestTopic(topic: string, limit = 60): Promise<Harvest> {
  return harvest({
    feeds: [webSearchFeed(topic)],
    query: topic,
    limit,
  });
}

/**
 * Add what a site's news sitemap is carrying to what its feeds returned.
 *
 * The refresh path already knows how to read a source's feeds and who the
 * source is; what it cannot see is everything the feeds left out. At the
 * Guardian that is several hundred stories a day, at CNN it is the only
 * structured route there is, and at the Verge it is a handful — so this is
 * always additive and never replaces what the feeds said.
 *
 * Failure here is not failure of the refresh. A site with no sitemap, or one
 * that refuses us, must still get its feed articles through unchanged.
 */
/**
 * The path every article in a feed sits under.
 *
 * This is how a section source stays a section. A site's news sitemap lists
 * the whole newsroom, so merging it wholesale into "BBC Technology" would
 * quietly turn it into "BBC" — the exact failure the rest of this design
 * exists to prevent, arriving from the other direction.
 *
 * Nothing stores whether a source is a section, so it is inferred from what
 * the source actually carries: if every story a feed returned lives under
 * /news/technology, that is the beat, and only sitemap entries under it may
 * join. A feed whose stories are spread across the site yields "/", which
 * constrains nothing — which is right, because that feed is the whole site.
 */
export function sharedPathPrefix(articles: Article[]): string {
  const paths: string[][] = [];
  for (const article of articles) {
    try {
      paths.push(new URL(article.link).pathname.split("/").filter(Boolean));
    } catch {
      /* an unusable link cannot narrow anything */
    }
  }
  // Too few stories to generalise from: two articles sharing a folder is a
  // coincidence, not a section.
  if (paths.length < 4) return "/";

  const common: string[] = [];
  for (let i = 0; i < paths[0].length; i += 1) {
    const segment = paths[0][i];
    // A date segment is not a section — /2026/09/14 is every story there is.
    if (/^\d{1,4}$/.test(segment)) break;
    if (!paths.every((path) => path[i] === segment)) break;
    common.push(segment);
  }
  return common.length > 0 ? `/${common.join("/")}` : "/";
}

function underPrefix(link: string, prefix: string): boolean {
  if (prefix === "/") return true;
  try {
    const path = new URL(link).pathname;
    return path === prefix || path.startsWith(`${prefix}/`);
  } catch {
    return false;
  }
}

export async function augment(
  articles: Article[],
  {
    origin,
    limit = DEFAULT_LIMIT,
    windowHours,
  }: { origin?: string; limit?: number; windowHours?: number },
): Promise<{ articles: Article[]; added: number; coverage: CoverageReport }> {
  const byRoute: Record<string, Article[]> = { feed: articles };
  let fromSitemap: Article[] = [];

  if (origin) {
    try {
      fromSitemap = (await harvestSitemap(origin, { limit })).articles;
    } catch {
      // No sitemap, or the site refused. The feeds still stand.
    }
  }
  byRoute.sitemap = fromSitemap;

  // A section source must not be widened into the whole site by its own
  // publisher's sitemap.
  const prefix = sharedPathPrefix(articles);
  const inScope = fromSitemap.filter((article) => underPrefix(article.link, prefix));

  // Only the sitemap entries need judging: feed items are already declared
  // articles, and a plain sitemap lists every page a site has.
  const { kept } = keepArticles(inScope, { origin, from: "sitemap" });

  const merged = new Map<string, Article>();
  for (const article of [...kept, ...articles]) {
    if (!article?.link) continue;
    const key = canonicalUrl(article.link);
    const existing = merged.get(key);
    merged.set(key, existing ? combine(existing, article) : article);
  }

  const all = sortNewestFirst([...merged.values()]);
  const coverage = coverageOf(all, byRoute, { hours: windowHours, sitemap: fromSitemap });
  return {
    articles: all.slice(0, limit),
    added: Math.max(0, merged.size - articles.length),
    coverage,
  };
}
