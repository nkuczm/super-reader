/**
 * Top stories, one row per story.
 *
 * Ranked by size, the list put a story's copies next to one another anyway —
 * the same event from five outlets scores the same — so the top of the list
 * was the same headline five times over, and the second story started a
 * screen down. Google News shows a story once, with its other outlets beside
 * it; this is that grouping.
 *
 * Two things say two stories are one:
 *
 *  - the ranking matched them to the same cluster of the outlet panel
 *    (`RankedArticle.key`, lib/pulse.ts) — the stronger signal, made over
 *    every newsroom in the panel;
 *  - their headlines match each other (lib/cluster.ts), which is what groups
 *    stories the panel never saw, or when there is no ranking at all.
 *
 * Only stories close together in time are matched by headline: an ongoing
 * story runs for weeks, and "Gaza ceasefire" a fortnight ago is not the same
 * event as today's.
 */
import { clusterStories } from "./cluster";

type Groupable = { id: string; title: string; sourceId: string; publishedAt?: string; seenAt?: number };

/** Headlines further apart than this are not matched as one story. */
export const SAME_STORY_HOURS = 72;

function timeOf(story: Groupable) {
  const published = story.publishedAt ? Date.parse(story.publishedAt) : NaN;
  return Number.isFinite(published) ? published : story.seenAt ?? 0;
}

/**
 * The stories in groups, each group in the list's own order and placed where
 * its first member stood — so a list ranked biggest first stays ranked, with
 * each story's copies gathered up beside it.
 *
 * The lead is the first member, unless `prefer` marks a later one among the
 * first three (a picture, for a card) — the copies of one story are ranked
 * alike, and the one with a picture makes the better lead.
 */
export function groupStories<T extends Groupable>(
  stories: T[],
  {
    keyOf = () => undefined,
    prefer,
    now = Date.now(),
    hours = SAME_STORY_HOURS,
  }: {
    /** The ranking's cluster, where it has one. */
    keyOf?: (story: T) => string | undefined;
    prefer?: (story: T) => boolean;
    now?: number;
    hours?: number;
  } = {},
): T[][] {
  const parent = new Map<string, string>();
  const find = (id: string): string => {
    const up = parent.get(id);
    if (up === undefined || up === id) return id;
    const root = find(up);
    parent.set(id, root);
    return root;
  };
  const join = (a: string, b: string) => {
    const [ra, rb] = [find(a), find(b)];
    if (ra !== rb) parent.set(rb, ra);
  };

  // The ranking's own clusters.
  const byKey = new Map<string, string>();
  for (const story of stories) {
    const key = keyOf(story);
    if (!key) continue;
    const first = byKey.get(key);
    if (first) join(first, story.id);
    else byKey.set(key, story.id);
  }

  // Headlines that match, among the recent ones.
  const recent = stories.filter((story) => now - timeOf(story) <= hours * 3_600_000);
  for (const cluster of clusterStories(recent.map((story) => ({ id: story.id, title: story.title, outlet: story.sourceId })))) {
    for (const member of cluster.members.slice(1)) join(cluster.members[0].id, member.id);
  }

  const groups = new Map<string, T[]>();
  for (const story of stories) {
    const root = find(story.id);
    const group = groups.get(root);
    if (group) group.push(story);
    else groups.set(root, [story]);
  }
  return [...groups.values()].map((group) => {
    if (!prefer || group.length < 2 || prefer(group[0])) return group;
    const better = group.slice(1, 3).findIndex(prefer);
    if (better < 0) return group;
    const lead = group[better + 1];
    return [lead, ...group.filter((story) => story !== lead)];
  });
}
