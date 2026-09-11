/**
 * The pulse: the corpus of stories turned into rankings.
 *
 * Everything here is pure, so the interesting part — what counts as one
 * story, and what a score means — is testable without a database and without
 * the network. `lib/corpus.ts` does the storage around it.
 *
 * Shape of the thing: a sweep records every story the panel published, with
 * where it sat. Clustering joins the copies into one story. Scoring turns the
 * evidence into a number. The result is cached as a `PulsePayload`, and any
 * reader's own articles are matched against that payload — by URL first,
 * then by headline — so a feed of hand-picked sources gets ranked against
 * what the rest of the press did, which is the whole point.
 */

import { clusterStories, tokensOf, idfOver, similarity } from "./cluster";
import { canonicalUrl } from "./url";

export { canonicalUrl };
import { scoreCluster, importanceBand } from "./importance";
import type { ClusterEvidence, Importance, RedditEvidence, StoryEvidence } from "./importance";

/** One copy of a story, as recorded by a sweep. */
export type CorpusStory = {
  url: string;
  title: string;
  newsroom: string;
  outletId: string;
  tier: 1 | 2 | 3;
  slot: number;
  front: boolean;
  comments?: number;
  seenAt: number;
  /** The date the outlet gave it, when it gave one. */
  publishedAt?: string;
};

export type CorpusRedditHit = {
  url: string;
  subreddit: string;
  weight: 1 | 2 | 3;
  slot: number;
};

/** A ranked story, as cached and as served. */
export type PulseCluster = {
  key: string;
  /** The headline of the copy with the best placement — the best-known one. */
  title: string;
  /** A link for the cluster: the best-placed copy. */
  link: string;
  newsrooms: string[];
  score: number;
  band: ReturnType<typeof importanceBand>;
  reasons: string[];
  breadth: number;
  /** The four parts of the score, 0..1 each. */
  parts: Importance["parts"];
  /** What produced those parts, for explaining the number to the reader. */
  evidence: Importance["evidence"];
  firstSeen: number;
  /** Canonical URLs of every copy, for exact matching. */
  urls: string[];
  /**
   * The headlines in the cluster. What the app shows as "also covered by",
   * and the only way to check from outside whether a cluster really is one
   * story — which is how the mixed clusters in it were found.
   */
  titles: string[];
  /** Distinctive words, for matching a headline we have no URL for. */
  tokens: string[];
};

/**
 * The shape of a cached ranking. Bumped whenever a field is added to
 * PulseCluster: the built payload lives in the database and outlives a
 * deploy, so without this a new build serves its own older cache and the
 * app reads fields that are not there. The score page did exactly that.
 */
export const PULSE_SHAPE = 2;

export type PulsePayload = {
  /** PULSE_SHAPE at the time it was built. */
  shape?: number;
  builtAt: number;
  /** Stories swept, before clustering — for the "what is this built on" note. */
  storyCount: number;
  outletCount: number;
  clusters: PulseCluster[];
};

/** Newsrooms that syndicate: a copy here is not an independent decision. */
const AGGREGATORS = new Set(["Hacker News", "Techmeme", "Lobsters", "Slashdot"]);

/**
 * Cluster the corpus and score every cluster.
 *
 * Only clusters with real evidence are kept: more than one newsroom, or a
 * community carrying it, or a comment count. A single story nobody else
 * touched needs no entry — it ranks as quiet by default, and keeping the
 * other 90% of the corpus out is what makes the payload small enough to
 * cache and serve.
 */
export function buildPulsePayload(
  stories: CorpusStory[],
  reddit: CorpusRedditHit[],
  now = Date.now(),
): PulsePayload {
  const redditByUrl = new Map<string, CorpusRedditHit[]>();
  for (const hit of reddit) {
    const url = canonicalUrl(hit.url);
    const bucket = redditByUrl.get(url) ?? [];
    bucket.push(hit);
    redditByUrl.set(url, bucket);
  }

  const clusters = clusterStories(
    stories.map((story) => ({ id: story.url, title: story.title, outlet: story.newsroom })),
  );
  const byUrl = new Map(stories.map((story) => [story.url, story]));
  const tokensByUrl = new Map(stories.map((story) => [story.url, tokensOf(story.title)]));
  const idf = idfOver([...tokensByUrl.values()]);

  const ranked: PulseCluster[] = [];
  for (const cluster of clusters) {
    const members = cluster.members
      .map((member) => byUrl.get(member.id))
      .filter((story): story is CorpusStory => Boolean(story));
    if (members.length === 0) continue;

    const evidence: ClusterEvidence = {
      key: cluster.key,
      stories: members.map(
        (story): StoryEvidence => ({
          newsroom: story.newsroom,
          tier: story.tier,
          position: story.slot,
          front: story.front,
          seenAt: story.seenAt,
          comments: story.comments,
        }),
      ),
      reddit: dedupeReddit(members.flatMap((story) => redditByUrl.get(story.url) ?? [])),
    };

    const newsrooms = [...new Set(members.map((story) => story.newsroom))];
    const independent = newsrooms.filter((name) => !AGGREGATORS.has(name));
    const hasEngagement =
      (evidence.reddit?.length ?? 0) > 0 ||
      members.some((story) => (story.comments ?? 0) > 0);
    if (independent.length < 2 && !hasEngagement) continue;

    const importance = scoreCluster(evidence, now);
    // The headline that represents the cluster is its most central one, not
    // its best-placed one.
    //
    // Trump's convention speech promised $5,000 cheques and addressed the
    // Iran war, and newsrooms wrote it up as one or the other or both. The
    // cluster is fair — eight newsrooms on one speech — but taking the
    // best-placed copy titled the whole thing "$5,000 'Dividend' Offer"
    // while it held Iran war coverage, which reads as a mistake even when
    // the grouping is right. The most central headline is the one whose
    // wording the rest of the cluster shares.
    const best = mostCentral(members, tokensByUrl, idf);

    ranked.push({
      key: cluster.key,
      title: best.title,
      link: best.url,
      newsrooms,
      score: importance.score,
      band: importanceBand(importance.score),
      reasons: importance.reasons,
      breadth: importance.breadth,
      parts: importance.parts,
      evidence: importance.evidence,
      firstSeen: Math.min(...members.map((story) => story.seenAt)),
      urls: members.map((story) => story.url),
      titles: members.slice(0, 12).map((story) => `${story.newsroom}: ${story.title}`),
      tokens: tokensOf(best.title),
    });
  }

  ranked.sort((a, b) => b.score - a.score || b.firstSeen - a.firstSeen);
  return {
    shape: PULSE_SHAPE,
    builtAt: now,
    storyCount: stories.length,
    outletCount: new Set(stories.map((story) => story.outletId)).size,
    clusters: ranked,
  };
}

/**
 * The member whose headline the others most agree with, with placement as
 * the tie-break so a cluster of near-identical wordings still leads with the
 * copy an editor put highest.
 */
function mostCentral(
  members: CorpusStory[],
  tokens: Map<string, string[]>,
  idf: Map<string, number>,
) {
  if (members.length === 1) return members[0];
  const scored = members.map((story) => {
    let total = 0;
    for (const other of members) {
      if (other.url === story.url) continue;
      total += similarity(tokens.get(story.url) ?? [], tokens.get(other.url) ?? [], idf);
    }
    return { story, centrality: total / (members.length - 1) };
  });
  scored.sort(
    (a, b) =>
      b.centrality - a.centrality ||
      Number(b.story.front) - Number(a.story.front) ||
      a.story.slot - b.story.slot,
  );
  return scored[0].story;
}

/** One subreddit counts once, at its best placement. */
function dedupeReddit(hits: CorpusRedditHit[]): RedditEvidence[] {
  const best = new Map<string, RedditEvidence>();
  for (const hit of hits) {
    const current = best.get(hit.subreddit);
    if (!current || hit.slot < current.position) {
      best.set(hit.subreddit, {
        subreddit: hit.subreddit,
        weight: hit.weight,
        position: hit.slot,
      });
    }
  }
  return [...best.values()];
}

export type RankedArticle = {
  id: string;
  score: number;
  band: ReturnType<typeof importanceBand>;
  reasons: string[];
  newsrooms: number;
  /** Who they are, so "8 newsrooms" can be checked rather than taken. */
  newsroomNames: string[];
  /** Which cluster it matched, so the app can group a story's copies. */
  key: string;
  /**
   * Everything behind the number, so the app can show its working. Optional
   * because a ranking cached by an older build can still be in the database
   * — see PULSE_SHAPE.
   */
  parts?: PulseCluster["parts"];
  evidence?: PulseCluster["evidence"];
  /** "Newsroom: headline" for each copy — the count, spelled out. */
  titles?: string[];
  firstSeen: number;
  /** How the match was made, which is worth being honest about in the UI. */
  via: "url" | "headline";
};

/**
 * An index over a cached payload, for matching a reader's articles to it.
 * Built once per request and reused across every article in it.
 */
export function pulseIndex(payload: PulsePayload) {
  const byUrl = new Map<string, PulseCluster>();
  const byToken = new Map<string, PulseCluster[]>();
  for (const cluster of payload.clusters) {
    for (const url of cluster.urls) byUrl.set(canonicalUrl(url), cluster);
    for (const token of cluster.tokens) {
      const bucket = byToken.get(token) ?? [];
      bucket.push(cluster);
      byToken.set(token, bucket);
    }
  }
  const idf = idfOver(payload.clusters.map((cluster) => cluster.tokens));
  return { byUrl, byToken, idf };
}

/**
 * Score a reader's own articles against the pulse.
 *
 * URL first: an exact match is certain, and it is the common case for
 * anything the panel also carried. Otherwise the headline is matched against
 * the clusters sharing a distinctive word with it — which is how a story
 * from a source nobody else follows still gets ranked, as long as the press
 * covered the same event.
 */
export function rankAgainstPulse(
  payload: PulsePayload,
  articles: { id: string; link: string; title: string }[],
  { threshold = 0.55 }: { threshold?: number } = {},
): RankedArticle[] {
  const index = pulseIndex(payload);
  const out: RankedArticle[] = [];

  for (const article of articles) {
    const exact = index.byUrl.get(canonicalUrl(article.link));
    if (exact) {
      out.push(asRanked(article.id, exact, "url"));
      continue;
    }

    const tokens = tokensOf(article.title);
    const seen = new Set<string>();
    let best: { cluster: PulseCluster; score: number } | null = null;
    for (const token of tokens) {
      for (const cluster of index.byToken.get(token) ?? []) {
        if (seen.has(cluster.key)) continue;
        seen.add(cluster.key);
        const score = similarity(tokens, cluster.tokens, index.idf);
        if (score >= threshold && (!best || score > best.score)) {
          best = { cluster, score };
        }
      }
    }
    if (best) out.push(asRanked(article.id, best.cluster, "headline"));
  }

  return out;
}

function asRanked(id: string, cluster: PulseCluster, via: "url" | "headline"): RankedArticle {
  return {
    id,
    score: cluster.score,
    band: cluster.band,
    reasons: cluster.reasons,
    newsrooms: cluster.newsrooms.length,
    newsroomNames: cluster.newsrooms.slice(0, 12),
    key: cluster.key,
    parts: cluster.parts,
    evidence: cluster.evidence,
    titles: cluster.titles,
    firstSeen: cluster.firstSeen,
    via,
  };
}
