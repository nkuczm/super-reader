/**
 * Filling the corpus.
 *
 * A sweep reads the panel's feeds and records what it saw: which article,
 * from which newsroom, in which feed, at which position. Nothing is
 * extracted or stored beyond the headline, the link and the placement — the
 * corpus exists to count coverage, not to hold a copy of the press.
 *
 * The work is cut into slices because a serverless request has a minute and
 * the panel has scores of feeds. Each slice is small enough to finish, and
 * slices are due independently, so a failing outlet delays only itself.
 */

import { fetchText, parseFeed, looksLikeFeed } from "./feed";
import { subredditFeedUrl } from "./reddit";
import { panelOutlets, panelSubreddits } from "./outlets";
import type { Outlet, SubredditEntry } from "./outlets";
import { recordRedditHits, recordStories, noteSweep, pruneCorpus, lastSweeps } from "./corpus";
import type { CorpusRedditHit, CorpusStory } from "./pulse";

/** Feeds per slice: enough to be worth a request, few enough to finish. */
const PER_SLICE = 8;
/** Spacing between Reddit requests, which are rate-limited per address. */
const REDDIT_GAP_MS = 1200;
/** How deep into a feed placement is recorded. */
const DEPTH = 25;

type Job =
  | { kind: "outlet"; outlet: Outlet }
  | { kind: "subreddit"; entry: SubredditEntry };

/**
 * The full sweep, in a fixed order so slice numbers are stable — a slice
 * number is what the schedule and the catch-up both refer to.
 */
export function sweepJobs(): Job[] {
  return [
    ...panelOutlets().map((outlet) => ({ kind: "outlet" as const, outlet })),
    ...panelSubreddits().map((entry) => ({ kind: "subreddit" as const, entry })),
  ];
}

export function sliceCount() {
  return Math.ceil(sweepJobs().length / PER_SLICE);
}

export type SweepResult = {
  slice: number;
  slices: number;
  stories: number;
  redditHits: number;
  sources: { id: string; ok: boolean; items?: number; error?: string }[];
};

/** Read one slice of the panel and record it. */
export async function sweepSlice(slice: number, now = Date.now()): Promise<SweepResult> {
  const jobs = sweepJobs();
  const slices = sliceCount();
  const mine = jobs.slice(slice * PER_SLICE, slice * PER_SLICE + PER_SLICE);

  const stories: CorpusStory[] = [];
  const hits: CorpusRedditHit[] = [];
  const sources: SweepResult["sources"] = [];

  // Outlets go in parallel: different hosts, no shared limit. Reddit does
  // not — it answers 429 to a handful of requests arriving together, and a
  // parallel slice lost five of six subreddits to throttling. They go one at
  // a time, spaced, with a single retry, because the engagement signal is
  // worth a few seconds of a background sweep.
  const outletJobs = mine.filter((job) => job.kind === "outlet");
  const redditJobs = mine.filter((job) => job.kind === "subreddit");

  await Promise.all(
    outletJobs.map(async (job) => {
      if (job.kind !== "outlet") return;
      try {
        const items = await readOutlet(job.outlet, now);
        stories.push(...items);
        sources.push({ id: job.outlet.id, ok: true, items: items.length });
      } catch (error) {
        sources.push({
          id: job.outlet.id,
          ok: false,
          error: error instanceof Error ? error.message : "failed",
        });
      }
    }),
  );

  for (const [index, job] of redditJobs.entries()) {
    if (job.kind !== "subreddit") continue;
    const id = `r/${job.entry.name}`;
    if (index > 0) await pause(REDDIT_GAP_MS);
    try {
      const items = await withRedditRetry(() => readSubreddit(job.entry));
      hits.push(...items);
      sources.push({ id, ok: true, items: items.length });
    } catch (error) {
      sources.push({
        id,
        ok: false,
        error: error instanceof Error ? error.message : "failed",
      });
    }
  }

  const written = await recordStories(stories);
  const wroteHits = await recordRedditHits(hits);
  const failed = sources.filter((source) => !source.ok).length;
  await noteSweep(
    `slice-${slice}`,
    `${written} stories, ${wroteHits} reddit${failed ? `, ${failed} failed` : ""}`,
  );
  // Cheap, and it keeps the table a window rather than an archive.
  if (slice === 0) await pruneCorpus();

  return { slice, slices, stories: written, redditHits: wroteHits, sources };
}

async function readOutlet(outlet: Outlet, now: number): Promise<CorpusStory[]> {
  const { body, finalUrl } = await fetchText(outlet.feedUrl, 12000);
  if (!looksLikeFeed(body)) throw new Error("Not a feed");
  const { articles } = parseFeed(body, finalUrl);
  return articles.slice(0, DEPTH).map((article, index) => ({
    url: article.link,
    title: article.title,
    newsroom: outlet.name,
    outletId: outlet.id,
    tier: outlet.tier,
    // Position in the feed. In a front-page feed this is an editor's ranking;
    // in a section feed it is mostly recency, which is why the two are
    // weighted differently when scoring.
    slot: index,
    front: Boolean(outlet.front),
    comments: article.commentCount,
    publishedAt: article.publishedAt,
    seenAt: now,
  }));
}

/**
 * A subreddit's top-of-day ranking, read for the links it points at.
 *
 * Reddit's JSON API answers 403 to serverless requests, so scores and
 * comment counts are out of reach; the ordering of the `top` feed is the
 * community's own verdict and is what gets recorded. Self posts are skipped:
 * a discussion with no article behind it is not coverage of anything.
 */
const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** One retry after a longer wait, for the throttle specifically. */
async function withRedditRetry<T>(read: () => Promise<T>): Promise<T> {
  try {
    return await read();
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (!/429|too many requests/i.test(message)) throw error;
    await pause(3000);
    return read();
  }
}

async function readSubreddit(entry: SubredditEntry): Promise<CorpusRedditHit[]> {
  const url = subredditFeedUrl({ name: entry.name, sort: "top", window: "day" });
  const { body, finalUrl } = await fetchText(url, 12000);
  if (!looksLikeFeed(body)) throw new Error("Not a feed");
  const { articles } = parseFeed(body, finalUrl);

  const hits: CorpusRedditHit[] = [];
  articles.slice(0, DEPTH).forEach((article, index) => {
    // tidyRedditPost points a link post at what it links to and leaves a self
    // post pointing at reddit.com, which is how the two are told apart here.
    if (/^https?:\/\/(www\.|old\.)?reddit\.com\//i.test(article.link)) return;
    hits.push({
      url: article.link,
      subreddit: entry.name,
      weight: entry.weight,
      slot: index,
    });
  });
  return hits;
}

/** How stale a slice may get before it is swept again. */
export const SWEEP_INTERVAL_MS = 30 * 60 * 1000;

/**
 * Which slices are overdue, oldest first.
 *
 * Sweeping is driven by use rather than only by a schedule: a reader opening
 * the app runs the slices that have gone stale, in the background, after the
 * response. A deployment nobody visits has nothing to rank anyway, and this
 * keeps the corpus current without depending on a cron plan's frequency.
 */
export async function dueSlices(now = Date.now()): Promise<number[]> {
  const ran = new Map(
    (await lastSweeps()).map((sweep) => [sweep.slice, Date.parse(sweep.ranAt)]),
  );
  const due: { slice: number; last: number }[] = [];
  for (let slice = 0; slice < sliceCount(); slice++) {
    const last = ran.get(`slice-${slice}`) ?? 0;
    if (now - last > SWEEP_INTERVAL_MS) due.push({ slice, last });
  }
  return due.sort((a, b) => a.last - b.last).map((entry) => entry.slice);
}

/**
 * Run the overdue slices, after the response, without making the caller
 * wait. Called from the endpoints the app actually uses — ranking included,
 * since that is the request a reader makes on every refresh and there may be
 * no other traffic at all.
 */
export async function catchUpSweeps(limit = 2) {
  const due = await dueSlices();
  for (const slice of due.slice(0, limit)) {
    try {
      await sweepSlice(slice);
    } catch {
      /* the next sweep's report records what failed */
    }
  }
  return due.length;
}

export type AuditResult = {
  slice: number;
  slices: number;
  checked: { id: string; feedUrl: string; ok: boolean; items?: number; error?: string }[];
};

/** Feeds per audit slice — nothing is written, so these can go wider. */
const AUDIT_PER_SLICE = 12;

/**
 * Check the directory against reality, writing nothing.
 *
 * A menu of a hundred and fifty feeds rots: outlets move their RSS, kill it,
 * or start refusing anything that is not a browser. This is how that gets
 * found — the sweep reports cover only the panel, and the rest of the
 * directory would fail silently in someone's sidebar instead.
 */
export async function auditSlice(slice: number): Promise<AuditResult> {
  const { OUTLETS } = await import("./outlets");
  const slices = Math.ceil(OUTLETS.length / AUDIT_PER_SLICE);
  const mine = OUTLETS.slice(slice * AUDIT_PER_SLICE, slice * AUDIT_PER_SLICE + AUDIT_PER_SLICE);

  const checked = await Promise.all(
    mine.map(async (outlet) => {
      try {
        const { body, finalUrl } = await fetchText(outlet.feedUrl, 12000);
        if (!looksLikeFeed(body)) throw new Error("Not a feed");
        const { articles } = parseFeed(body, finalUrl);
        if (articles.length === 0) throw new Error("Feed is empty");
        return { id: outlet.id, feedUrl: outlet.feedUrl, ok: true, items: articles.length };
      } catch (error) {
        return {
          id: outlet.id,
          feedUrl: outlet.feedUrl,
          ok: false,
          error: error instanceof Error ? error.message : "failed",
        };
      }
    }),
  );

  return { slice, slices, checked };
}

export function auditSliceCount() {
  return Math.ceil(sweepJobs().filter((job) => job.kind === "outlet").length / AUDIT_PER_SLICE);
}
