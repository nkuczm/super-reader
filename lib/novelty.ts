/**
 * Discover: stories that matter and that hardly anyone else is running.
 *
 * Top stories answers "what is everyone covering?". This answers the
 * opposite question, the way a music service's discovery list does: what
 * you have probably not come across, that you will probably care about.
 * Three things decide it, and each is something already measured elsewhere
 * in the app, so nothing new has to be fetched to know it:
 *
 *  - **It might matter.** An editor at a serious newsroom put it on the
 *    front page, or readers are talking about it (comments, subreddits). A
 *    story from a source that files rarely counts as considered: a weekly
 *    column is not one of fifty desk briefs.
 *  - **Few others have it.** One or two newsrooms in the outlet panel, and
 *    not several of the reader's own sources. A story the press is already
 *    shouting about belongs in Top stories, not here.
 *  - **It is near what this reader reads, without being what they have.**
 *    A story from outside the reader's sources shares words with the feed
 *    it is shown in, but is not the same story as anything already in it.
 *
 * The candidates from outside the reader's sources come from the panel
 * sweep that ranking already runs (lib/pulse.ts keeps the quiet ones it
 * used to throw away), and are scored on the device, against the device's
 * own list: the server learns nothing about what anyone follows.
 *
 * Pure, so it is testable without the network or a database.
 */

import { idfOver, similarity, tokensOf } from "./cluster";

/** A story few newsrooms ran, as the pulse payload carries it. */
export type QuietStory = {
  url: string;
  title: string;
  /** The newsroom whose copy this is. */
  newsroom: string;
  tier: 1 | 2 | 3;
  /** Whether it sat on a front-page feed, where order is an editor's. */
  front: boolean;
  /** Its best position in that feed, 0-based. */
  slot: number;
  comments?: number;
  /** Subreddits carrying it, and the one it did best in. */
  subreddits?: number;
  subreddit?: string;
  /** Every newsroom in the panel that ran it: one or two. */
  newsrooms: string[];
  seenAt: number;
  /** 0..1: how much the evidence says it might matter, before the reader. */
  prior: number;
};

/** How many quiet stories the payload carries: the best by prior. */
export const QUIET_KEEP = 300;

/**
 * More than this many newsrooms and it is not under-covered: Top stories
 * has it. Counted over independent newsrooms, not aggregators.
 */
export const QUIET_MAX_NEWSROOMS = 2;

/**
 * Headlines that are rarely news, however few outlets ran them: shopping,
 * games, how-tos, live pages, horoscopes. Low coverage is their natural
 * state, so without this they would fill the list.
 */
const FLUFF =
  /\b(deals?|sale|discount|coupon|promo code|gift guide|best .{0,30}(to buy|for \d{4})|how to|recipes?|quiz|crossword|wordle|connections hints|horoscope|what to watch|where to watch|streaming now|live updates?|live blog|podcast|newsletter|photos of the|in pictures|today's|tonight's|review:|unboxing)\b/i;

/** Words that say a story was dug up rather than handed out. */
const SUBSTANCE =
  /\b(exclusive|investigat\w*|reveal\w*|leak\w*|obtained|documents? show|records show|internal|whistleblower|quietly|lawsuit|sues?|sued|indict\w*|probe|audit|inspector general|ruling|study finds|data shows?|analysis)\b/i;

function logScale(value: number, ceiling: number) {
  if (value <= 0) return 0;
  return Math.min(1, Math.log1p(value) / Math.log1p(ceiling));
}

const TIER_VALUE = { 1: 1, 2: 0.7, 3: 0.45 } as const;

/**
 * How much the panel's evidence says a quiet story might matter, 0..1.
 *
 * A front page is the strongest thing here: an editor chose it as one of the
 * day's stories, and nobody else followed. A section feed is a timeline, so
 * its top slot mostly means "recent" and counts for little.
 */
export function quietPrior(story: {
  title: string;
  tier: 1 | 2 | 3;
  front: boolean;
  slot: number;
  comments?: number;
  redditMass?: number;
}) {
  const tier = TIER_VALUE[story.tier];
  const place = story.front
    ? Math.max(0, 1 - Math.min(story.slot, 15) / 15)
    : 0.25 * Math.max(0, 1 - Math.min(story.slot, 20) / 20);
  const engagement = Math.max(logScale(story.redditMass ?? 0, 4), logScale(story.comments ?? 0, 400));
  let prior = 0.4 * tier + 0.35 * place + 0.25 * engagement;
  if (SUBSTANCE.test(story.title)) prior += 0.1;
  if (FLUFF.test(story.title)) prior *= 0.3;
  return Math.round(Math.min(1, prior) * 1000) / 1000;
}

// ---------------------------------------------------------------------------
// On the device

type Held = {
  id: string;
  title: string;
  link: string;
  sourceId: string;
  publishedAt?: string;
  seenAt?: number;
};

/** What the reader's own ranking says about a held story (RankedArticle). */
type Rank = { newsrooms: number; key?: string };

export type DiscoverPick<T> =
  | { kind: "held"; story: T; score: number; why: string }
  | { kind: "outside"; story: QuietStory; score: number; why: string };

/** How recent a story must be to be discovered: this is about now. */
const WINDOW_HOURS = 72;
/** Half-life of a story's claim on the list. */
const HALF_LIFE_HOURS = 36;
/** The list is a short one, the way a discovery playlist is. */
export const DISCOVER_LIMIT = 40;
/** A prior this strong is shown even with nothing in common with the feed. */
const STANDS_ALONE = 0.85;
/** Headlines at least this alike are the same story (lib/cluster.ts). */
const SAME_STORY = 0.46;

function timeOf(story: { publishedAt?: string; seenAt?: number }) {
  const published = story.publishedAt ? Date.parse(story.publishedAt) : NaN;
  return Number.isFinite(published) ? published : story.seenAt ?? 0;
}

function freshness(at: number, now: number) {
  const hours = Math.max(0, (now - at) / 3_600_000);
  return Math.pow(0.5, hours / HALF_LIFE_HOURS);
}

/** "nytimes.com/x?utm=y" and "www.nytimes.com/x" are one address. */
function plainUrl(url: string) {
  try {
    const parsed = new URL(url);
    return `${parsed.hostname.replace(/^www\./, "")}${parsed.pathname.replace(/\/$/, "")}`.toLowerCase();
  } catch {
    return url.toLowerCase();
  }
}

function newsroomsText(names: string[]) {
  return names.length <= 1 ? `Only ${names[0] ?? "one outlet"} has this` : `Only ${names[0]} and ${names[1]}`;
}

/** The single strongest reason a quiet panel story was picked. */
function signalText(story: QuietStory) {
  if (story.front && story.slot < 10) {
    return story.slot === 0 ? "leading its front page" : `#${story.slot + 1} on its front page`;
  }
  if ((story.comments ?? 0) >= 50) return `${story.comments} comments`;
  if (story.subreddit) return (story.subreddits ?? 1) > 1 ? `${story.subreddits} subreddits` : `on r/${story.subreddit}`;
  return "";
}

/**
 * The Discover list for one view: the reader's own quiet stories and the
 * panel's, scored on one scale and spread so no outlet or story fills it.
 *
 *  - `held` is the list in view; its sources define what this reader reads.
 *  - `quiet` is the panel's quiet stories (empty without a database, in
 *    which case the list is made from the reader's own stories alone).
 *  - `ranking` is what the panel said about the held stories.
 *  - `matches` is which held headlines are one story (lib/story-groups.ts).
 *  - `crowded` says a headline is about something the feed is already full
 *    of (a trending topic).
 */
export function discoverStories<T extends Held>({
  held,
  quiet,
  ranking,
  matches,
  crowded = () => false,
  measured = true,
  now = Date.now(),
  limit = DISCOVER_LIMIT,
}: {
  held: T[];
  quiet: QuietStory[];
  ranking: Map<string, Rank>;
  matches?: Map<string, string>;
  crowded?: (title: string) => boolean;
  /**
   * Whether the ranking ran. Without it nothing is known about the wider
   * press, and a held story can only be said to be alone in this feed.
   */
  measured?: boolean;
  now?: number;
  limit?: number;
}): DiscoverPick<T>[] {
  const recentCutoff = now - WINDOW_HOURS * 3_600_000;
  const heldTokens = held.map((story) => tokensOf(story.title));
  const quietTokens = quiet.map((story) => tokensOf(story.title));
  const idf = idfOver([...heldTokens, ...quietTokens]);

  // What the reader reads: how many of their headlines use each word.
  const df = new Map<string, number>();
  for (const tokens of heldTokens) for (const token of tokens) df.set(token, (df.get(token) ?? 0) + 1);

  // How often each source files, over the last week, for "files rarely".
  const weekAgo = now - 7 * 86_400_000;
  const perSource = new Map<string, number>();
  for (const story of held) {
    if (timeOf(story) >= weekAgo) perSource.set(story.sourceId, (perSource.get(story.sourceId) ?? 0) + 1);
  }

  // Which sources share a story with which, from the headline matches.
  const sourcesByMatch = new Map<string, Set<string>>();
  if (matches) {
    const byId = new Map(held.map((story) => [story.id, story]));
    for (const [id, lead] of matches) {
      const story = byId.get(id);
      if (!story) continue;
      const set = sourcesByMatch.get(lead) ?? new Set<string>();
      set.add(story.sourceId);
      sourcesByMatch.set(lead, set);
    }
  }

  const picks: (DiscoverPick<T> & { tokens: string[]; outlet: string })[] = [];

  // The reader's own stories that the press has left alone.
  held.forEach((story, index) => {
    const at = timeOf(story);
    if (at < recentCutoff || at > now + 3_600_000) return;
    const rank = ranking.get(story.id);
    if (rank && rank.newsrooms > QUIET_MAX_NEWSROOMS) return;
    const lead = matches?.get(story.id);
    const alsoHere = lead ? sourcesByMatch.get(lead)?.size ?? 1 : 1;
    if (alsoHere > 2) return;
    if (FLUFF.test(story.title)) return;

    const perDay = (perSource.get(story.sourceId) ?? 1) / 7;
    // Thirty a day is a wire desk; one a week is a column.
    const rarity = 1 - logScale(perDay, 30);
    const substance = SUBSTANCE.test(story.title) ? 1 : 0;
    const prior = 0.3 + 0.35 * rarity + 0.15 * substance;
    const coverage = (!rank || rank.newsrooms <= 1 ? 1 : 0.75) * (alsoHere > 1 ? 0.6 : 1);
    const score = prior * coverage * freshness(at, now) * (crowded(story.title) ? 0.6 : 1) * 0.7;

    const why = [
      !measured
        ? alsoHere > 1
          ? "Only two of your sources have this"
          : "None of your other sources has this"
        : !rank || rank.newsrooms <= 1
          ? "No other outlet has this"
          : "Only two newsrooms have this",
      rarity > 0.8 ? "from a source that files rarely" : "",
    ]
      .filter(Boolean)
      .join(" · ");
    picks.push({ kind: "held", story, score, why, tokens: heldTokens[index], outlet: story.sourceId });
  });

  // The panel's quiet stories that this reader does not have.
  const heldUrls = new Set(held.map((story) => plainUrl(story.link)));
  const postings = new Map<string, number[]>();
  heldTokens.forEach((tokens, index) => {
    for (const token of tokens) {
      const list = postings.get(token) ?? [];
      list.push(index);
      postings.set(token, list);
    }
  });
  const sameAsHeld = (tokens: string[]) => {
    // Compared only with headlines sharing one of its rarer words: the
    // common ones are in hundreds of headlines and never the only link.
    const seen = new Set<number>();
    for (const token of tokens) {
      const list = postings.get(token);
      if (!list || list.length > 300) continue;
      for (const index of list) {
        if (seen.has(index)) continue;
        seen.add(index);
        if (similarity(tokens, heldTokens[index], idf) >= SAME_STORY) return true;
      }
    }
    return false;
  };

  quiet.forEach((story, index) => {
    if (story.seenAt < recentCutoff) return;
    if (heldUrls.has(plainUrl(story.url))) return;
    const tokens = quietTokens[index];
    if (tokens.length < 2 || sameAsHeld(tokens)) return;

    // The share of its distinctive words this reader's feed uses.
    // One word in common is a coincidence ("settles" in a football result
    // and an antitrust case), so it takes two.
    let total = 0;
    let known = 0;
    let shared = 0;
    for (const token of tokens) {
      const weight = idf.get(token) ?? 1;
      const uses = df.get(token) ?? 0;
      total += weight;
      known += weight * Math.min(1, uses / 2);
      if (uses > 0) shared += 1;
    }
    const affinity = total > 0 && shared >= 2 ? known / total : 0;
    // Nothing in common is a stranger, not a discovery — unless the evidence
    // that it matters is strong enough to stand on its own.
    if (affinity < 0.08 && story.prior < STANDS_ALONE) return;

    const coverage = story.newsrooms.length <= 1 ? 1 : 0.75;
    const score =
      story.prior * (0.3 + 0.7 * affinity) * coverage * freshness(story.seenAt, now) * (crowded(story.title) ? 0.6 : 1);
    const why = [newsroomsText(story.newsrooms), signalText(story)].filter(Boolean).join(" · ");
    picks.push({ kind: "outside", story, score, why, tokens, outlet: `panel:${story.newsroom}` });
  });

  picks.sort((a, b) => b.score - a.score);

  // Spread: one copy of a story, and no outlet more than three times in the
  // list — a discovery list that is one outlet's archive discovers nothing.
  const chosen: typeof picks = [];
  const perOutlet = new Map<string, number>();
  for (const pick of picks) {
    if (chosen.length >= limit) break;
    if ((perOutlet.get(pick.outlet) ?? 0) >= 3) continue;
    if (chosen.some((other) => similarity(pick.tokens, other.tokens, idf) >= SAME_STORY)) continue;
    chosen.push(pick);
    perOutlet.set(pick.outlet, (perOutlet.get(pick.outlet) ?? 0) + 1);
  }
  return chosen.map(({ tokens: _tokens, outlet: _outlet, ...pick }) => pick as DiscoverPick<T>);
}
