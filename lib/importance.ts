/**
 * How big a story is, from evidence rather than opinion.
 *
 * Every signal here answers a different question, which is why no single one
 * is trusted on its own:
 *
 *  breadth    — how many *different newsrooms* independently ran it. The
 *               strongest signal there is: twelve editors making the same
 *               call is close to the definition of a big story. Counted per
 *               newsroom, not per feed, so the WSJ running it in World and
 *               in Markets is still one newsroom.
 *  placement  — where it sat. A front-page feed is ordered by an editor, so
 *               position 1 in one means "this is today's story" in a way
 *               that position 1 of a section timeline does not.
 *  engagement — what readers did with it: how many communities carried it,
 *               how near the top of their own rankings, and comment counts
 *               where a feed reports them.
 *  velocity   — how fast breadth arrived. Ten outlets in two hours is
 *               breaking news; ten over three days is a slow-burning topic.
 *  freshness  — whether it is still being covered. Measured from the most
 *               recent copy, not the first: a story nobody has published on
 *               for a day is finished, however many newsrooms ran it
 *               yesterday, and the reader is being shown it as what is
 *               happening now.
 *
 * Each is normalised to 0..1 against a "this is as big as it gets" ceiling,
 * then weighted. The result is 0..100 with the reasons kept alongside, so the
 * app can say *why* something is ranked where it is instead of showing a
 * number nobody can argue with.
 */

import { tierWeight } from "./outlets";

export type StoryEvidence = {
  /** The newsroom, not the feed: "The New York Times", not "nyt-world". */
  newsroom: string;
  tier: 1 | 2 | 3;
  /** Index in the feed it was found in, 0-based. */
  position: number;
  /** Found in a front-page/top-stories feed, where order is editorial. */
  front: boolean;
  /** When this copy was first seen, epoch ms. */
  seenAt: number;
  /**
   * An aggregator rather than a newsroom. Hacker News carrying a story is
   * not a twelfth newsroom deciding to run it — it is readers voting, which
   * is the engagement signal, counted once over there. Left in the evidence
   * because its comment count is worth having.
   */
  aggregator?: boolean;
  /** Comments, where the feed reports them (Hacker News, slash:comments). */
  comments?: number;
};

export type RedditEvidence = {
  subreddit: string;
  weight: 1 | 2 | 3;
  /** Index in that subreddit's top-of-day ranking, 0-based. */
  position: number;
};

export type ClusterEvidence = {
  key: string;
  stories: StoryEvidence[];
  reddit?: RedditEvidence[];
};

export type Importance = {
  /** 0..100. */
  score: number;
  /** Weighted count of distinct newsrooms — the headline number. */
  breadth: number;
  newsrooms: number;
  parts: {
    breadth: number;
    placement: number;
    engagement: number;
    velocity: number;
    freshness: number;
  };
  /** The evidence behind the parts, for explaining the number. */
  evidence: {
    /** Weighted newsroom count, and the ceiling it is measured against. */
    weighted: number;
    ceiling: number;
    /** Best placement seen, when any copy sat in a front-page feed. */
    front?: { newsroom: string; position: number };
    /** Best placement in a section feed, for when there is no front page. */
    section?: { newsroom: string; position: number };
    subreddits: { subreddit: string; position: number }[];
    comments: number;
    /** Hours between the first copy seen and now. */
    ageHours: number;
    /** Hours since the most recent copy — how long since anyone added to it. */
    quietHours?: number;
  };
  /** Short phrases, strongest first, for the badge and its tooltip. */
  reasons: string[];
};

/**
 * What each signal is worth. Exported because the app explains the score to
 * the reader, and the explanation has to be the arithmetic that actually ran
 * rather than a second copy of it that can drift.
 */
export const WEIGHTS = {
  breadth: 0.45,
  placement: 0.2,
  engagement: 0.25,
  velocity: 0.1,
} as const;

/**
 * Freshness is a discount, not a fifth signal.
 *
 * It was a weighted part first, and that was wrong in a way worth recording:
 * almost every story in a 48-hour window is inside a news cycle, so the part
 * scored 1 for nearly all of them and amounted to a flat fifteen points added
 * to everything. Every band moved up and the thresholds stopped meaning what
 * they were tuned to mean.
 *
 * Being current is not evidence that a story is big. Having gone quiet *is*
 * evidence that it has stopped happening — so it marks a story down rather
 * than marking a live one up, and the four signals keep their calibration.
 *
 * Full marks for twelve hours after the most recent copy, then a fade to
 * FRESH_FLOOR by the end of the window the corpus keeps. The floor matters:
 * yesterday's big story should sit below today's, not vanish beneath a quiet
 * one that happened an hour ago.
 */
const FRESH_HOURS = 12;
const STALE_HOURS = 48;
const FRESH_FLOOR = 0.6;

/** Twelve tier-1 newsrooms on one story is the practical ceiling. */
const BREADTH_CEILING = 9;
/** Beyond the top 20 of a feed, position stops meaning much. */
const POSITION_DEPTH = 20;

function positionValue(position: number, front: boolean) {
  const depth = Math.max(0, 1 - Math.min(position, POSITION_DEPTH) / POSITION_DEPTH);
  // A section feed is a timeline: being at the top of one mostly means
  // "recent", so it counts for much less than an editor's front page.
  return front ? depth : depth * 0.35;
}

function logScale(value: number, ceiling: number) {
  if (value <= 0) return 0;
  return Math.min(1, Math.log1p(value) / Math.log1p(ceiling));
}

function plural(count: number, one: string, many = `${one}s`) {
  return `${count} ${count === 1 ? one : many}`;
}

export function scoreCluster(
  cluster: ClusterEvidence,
  now = Date.now(),
): Importance {
  const byNewsroom = new Map<string, StoryEvidence[]>();
  for (const story of cluster.stories) {
    // An aggregator is not a newsroom that ran the story. Counting Hacker
    // News towards breadth credited a link-voting site as an editorial
    // decision, and inflated exactly the clusters that are only popular.
    if (story.aggregator) continue;
    const bucket = byNewsroom.get(story.newsroom) ?? [];
    bucket.push(story);
    byNewsroom.set(story.newsroom, bucket);
  }

  let weighted = 0;
  for (const [, copies] of byNewsroom) {
    // One newsroom counts once, at its best tier.
    const best = copies.reduce((a, b) => (a.tier <= b.tier ? a : b));
    weighted += tierWeight(best.tier);
  }
  const breadth = logScale(weighted, BREADTH_CEILING);

  // Placement: the best few, so one outlet's odd ordering cannot carry a
  // story on its own, and one outlet burying it cannot sink it either.
  const placements = cluster.stories
    .filter((story) => !story.aggregator)
    .map((story) => positionValue(story.position, story.front))
    .sort((a, b) => b - a)
    .slice(0, 3);
  const placement =
    placements.length > 0
      ? placements.reduce((sum, value) => sum + value, 0) / placements.length
      : 0;

  const reddit = cluster.reddit ?? [];
  const redditMass = reddit.reduce(
    (sum, hit) =>
      sum + (4 - hit.weight) * (1 - Math.min(hit.position, 25) / 25),
    0,
  );
  const commentTotal = cluster.stories.reduce(
    (sum, story) => sum + (story.comments ?? 0),
    0,
  );
  // Two signals, one axis: communities carrying it, and people talking under
  // it. A thousand comments and five subreddits are about equally loud.
  const engagement = Math.max(
    logScale(redditMass, 6),
    logScale(commentTotal, 900),
  );

  const firstSeen = Math.min(...cluster.stories.map((s) => s.seenAt));
  const lastSeen = Math.max(...cluster.stories.map((s) => s.seenAt));
  const hours = Math.max((now - firstSeen) / 3_600_000, 0.5);
  const quiet = Math.max((now - lastSeen) / 3_600_000, 0);
  // Full marks inside a news cycle, then a straight fade to nothing by the
  // end of the window the corpus keeps.
  const fade =
    quiet <= FRESH_HOURS
      ? 0
      : Math.min(1, (quiet - FRESH_HOURS) / (STALE_HOURS - FRESH_HOURS));
  const freshness = 1 - fade * (1 - FRESH_FLOOR);
  // Breadth per hour over the first stretch, against "six newsrooms in the
  // first hour" as the ceiling — the shape of a genuine breaking story.
  const velocity = logScale(weighted / Math.min(hours, 24), 6);

  const score =
    100 *
    freshness *
    (WEIGHTS.breadth * breadth +
      WEIGHTS.placement * placement +
      WEIGHTS.engagement * engagement +
      WEIGHTS.velocity * velocity);

  const reasons: string[] = [];
  if (byNewsroom.size > 1) {
    reasons.push(`${plural(byNewsroom.size, "newsroom")} covering it`);
  }
  const bestFront = cluster.stories
    .filter((story) => story.front && !story.aggregator)
    .sort((a, b) => a.position - b.position)[0];
  if (bestFront) {
    reasons.push(
      bestFront.position === 0
        ? `leading ${bestFront.newsroom}`
        : `#${bestFront.position + 1} on ${bestFront.newsroom}`,
    );
  }
  if (reddit.length > 0) {
    const top = [...reddit].sort((a, b) => a.position - b.position)[0];
    reasons.push(
      reddit.length > 1
        ? `${plural(reddit.length, "subreddit")}, top on r/${top.subreddit}`
        : `r/${top.subreddit}`,
    );
  }
  if (commentTotal >= 50) reasons.push(`${plural(commentTotal, "comment")}`);
  if (velocity > 0.55 && hours < 12) reasons.push("picked up fast");
  // Worth saying out loud: a big story that has gone quiet still ranks, and
  // the reader should know which of the two they are looking at.
  if (freshness < 0.9) reasons.push(`nothing new for ${Math.round(quiet)}h`);

  const bestSection = [...cluster.stories]
    .filter((story) => !story.front && !story.aggregator)
    .sort((a, b) => a.position - b.position)[0];

  return {
    score: Math.round(score),
    breadth: Math.round(weighted * 10) / 10,
    evidence: {
      weighted: Math.round(weighted * 10) / 10,
      ceiling: BREADTH_CEILING,
      front: bestFront
        ? { newsroom: bestFront.newsroom, position: bestFront.position }
        : undefined,
      section: bestSection
        ? { newsroom: bestSection.newsroom, position: bestSection.position }
        : undefined,
      subreddits: [...reddit]
        .sort((a, b) => a.position - b.position)
        .map((hit) => ({ subreddit: hit.subreddit, position: hit.position })),
      comments: commentTotal,
      ageHours: Math.round(hours * 10) / 10,
      quietHours: Math.round(quiet * 10) / 10,
    },
    newsrooms: byNewsroom.size,
    parts: {
      breadth: Math.round(breadth * 100) / 100,
      placement: Math.round(placement * 100) / 100,
      engagement: Math.round(engagement * 100) / 100,
      velocity: Math.round(velocity * 100) / 100,
      freshness: Math.round(freshness * 100) / 100,
    },
    reasons,
  };
}

/**
 * A one-word band for the badge. Thresholds are deliberately high: if most
 * of a feed lit up as "big", the ranking would be telling the reader
 * nothing.
 */
export function importanceBand(score: number): "major" | "big" | "notable" | "quiet" {
  if (score >= 62) return "major";
  if (score >= 42) return "big";
  if (score >= 24) return "notable";
  return "quiet";
}
