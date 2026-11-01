/**
 * Feed and team lists, checked and combined. Pure, so the server (folding an
 * old sync code into an account) and the device use the same rules.
 */

import type { Feed, TeamFeed } from "./store";
import { canonicalUrl } from "./url";

/**
 * One source, however its address was written: with or without www, http or
 * https, a trailing slash or tracking tags. Two sources with the same key in
 * one feed are the same source.
 */
export const sourceKey = (feedUrl: string) => (typeof feedUrl === "string" && feedUrl ? canonicalUrl(feedUrl) : "");

/**
 * Feeds as they can safely be drawn. Stored and synced data outlives the code
 * that wrote it: one feed whose sources are not a list, or a source with no
 * feed URL, and rendering the sidebar throws — which takes the whole app down
 * to a blank page. Anything malformed is dropped rather than trusted.
 */
export function cleanFeeds(input: unknown): Feed[] {
  if (!Array.isArray(input)) return [];
  const feeds = input
    .filter((feed): feed is Feed => !!feed && typeof feed === "object" && typeof (feed as Feed).id === "string")
    .map((feed) => ({
      ...feed,
      name: typeof feed.name === "string" ? feed.name : "Feed",
      sources: (Array.isArray(feed.sources) ? feed.sources : [])
        .filter(
          (source) =>
            !!source &&
            typeof source === "object" &&
            typeof source.id === "string" &&
            typeof source.feedUrl === "string",
        )
        // A source without a name is drawn by its address, not left to throw.
        .map((source) => (typeof source.title === "string" ? source : { ...source, title: source.feedUrl }))
        // The same source twice in one feed (added under two spellings, or
        // merged in from another device) is shown, and kept, once.
        .filter((source, i, all) => all.findIndex((other) => sourceKey(other.feedUrl) === sourceKey(source.feedUrl)) === i),
    }));
  return oneFolderPerSource(feeds);
}

/**
 * Each source in one folder. Moving a source to another folder keeps its id,
 * and nothing else gives two folders the same one — adding an outlet a
 * second time makes a new source — so one id in two folders is a source put
 * back where it had been moved from: a device still holding the old list
 * merged it in when it opened (fixed in the Reader's sign-in join, 1 Nov
 * 2026). It showed as a folder that "keeps getting sources from different
 * feeds", and as the same outlet twice in Notifications.
 *
 * Which copy is the one the reader meant: the folder it was moved *from*
 * holds a copy of every source moved out of it, so the folder holding the
 * most of these doubled sources gives its copies up. Between two folders
 * holding as many, a copy in a trailing run of doubled sources goes — that
 * is where the merge appended them — and then the later folder's.
 */
export function oneFolderPerSource(feeds: Feed[]): Feed[] {
  const homes = new Map<string, number[]>();
  feeds.forEach((feed, f) => {
    for (const source of feed.sources) {
      const at = homes.get(source.id);
      if (!at) homes.set(source.id, [f]);
      else if (!at.includes(f)) at.push(f);
    }
  });
  const doubled = new Set([...homes].filter(([, at]) => at.length > 1).map(([id]) => id));
  if (doubled.size === 0) return feeds;

  const strays = feeds.map((feed) => feed.sources.filter((source) => doubled.has(source.id)).length);
  /** Whether everything from this source to the end of its folder is doubled: what the merge appended. */
  const trailing = (f: number, id: string) => {
    const sources = feeds[f].sources;
    return sources.slice(sources.findIndex((source) => source.id === id)).every((source) => doubled.has(source.id));
  };
  const keep = new Map<string, number>();
  for (const id of doubled) {
    const [best] = [...homes.get(id)!].sort(
      (a, b) => strays[a] - strays[b] || Number(trailing(a, id)) - Number(trailing(b, id)) || a - b,
    );
    keep.set(id, best);
  }
  return feeds.map((feed, f) => {
    const sources = feed.sources.filter((source, i, all) =>
      doubled.has(source.id) ? keep.get(source.id) === f && all.findIndex((s) => s.id === source.id) === i : true,
    );
    return sources.length === feed.sources.length ? feed : { ...feed, sources };
  });
}

/**
 * Two feed lists as one: theirs in their order, with any feed or source only
 * this device has added at the end. For a device joining a sync code, whose
 * own list must never replace the one it is joining.
 */
export function unionFeeds(theirs: Feed[], mine: Feed[]): Feed[] {
  const out = theirs.map((feed) => ({ ...feed, sources: [...feed.sources] }));
  // A source theirs holds in any folder is not missing: it was moved there.
  const placed = new Set(out.flatMap((feed) => feed.sources.map((source) => source.id)));
  for (const feed of mine) {
    const held = out.find((f) => f.id === feed.id);
    if (!held) {
      const sources = feed.sources.filter((source) => !placed.has(source.id));
      for (const source of sources) placed.add(source.id);
      out.push(sources.length === feed.sources.length ? feed : { ...feed, sources });
      continue;
    }
    for (const source of feed.sources) {
      if (placed.has(source.id)) continue;
      const key = sourceKey(source.feedUrl);
      if (!held.sources.some((s) => key && sourceKey(s.feedUrl) === key)) {
        held.sources.push(source);
        placed.add(source.id);
      }
    }
  }
  return out;
}

/** Two team lists as one, for a device joining a sync code: theirs, then any only this device joined. */
export function unionTeams(theirs: TeamFeed[], mine: TeamFeed[]): TeamFeed[] {
  const out = [...theirs];
  for (const team of mine) if (!out.some((t) => t.code === team.code)) out.push(team);
  return out;
}

/** Two read lists as one, the most recent kept when there are too many. */
export function unionRead(theirs: string[], mine: string[], max = 3000): string[] {
  const seen = new Set(theirs);
  return [...theirs, ...mine.filter((id) => !seen.has(id))].slice(-max);
}

/** A list arriving from sync is another device's data, so check its shape. */
export function sanitizeTeams(value: unknown): TeamFeed[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const teams: TeamFeed[] = [];
  for (const entry of value) {
    const team = entry as TeamFeed | null;
    if (!team || typeof team.code !== "string" || typeof team.name !== "string") continue;
    if (seen.has(team.code)) continue;
    seen.add(team.code);
    teams.push({ code: team.code, name: team.name });
  }
  return teams;
}
