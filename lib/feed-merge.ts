/**
 * Feed and team lists, checked and combined. Pure, so the server (folding an
 * old sync code into an account) and the device use the same rules.
 */

import type { Feed, TeamFeed } from "./store";

/**
 * Feeds as they can safely be drawn. Stored and synced data outlives the code
 * that wrote it: one feed whose sources are not a list, or a source with no
 * feed URL, and rendering the sidebar throws — which takes the whole app down
 * to a blank page. Anything malformed is dropped rather than trusted.
 */
export function cleanFeeds(input: unknown): Feed[] {
  if (!Array.isArray(input)) return [];
  return input
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
        .map((source) => (typeof source.title === "string" ? source : { ...source, title: source.feedUrl })),
    }));
}

/**
 * Two feed lists as one: theirs in their order, with any feed or source only
 * this device has added at the end. For a device joining a sync code, whose
 * own list must never replace the one it is joining.
 */
export function unionFeeds(theirs: Feed[], mine: Feed[]): Feed[] {
  const out = theirs.map((feed) => ({ ...feed, sources: [...feed.sources] }));
  for (const feed of mine) {
    const held = out.find((f) => f.id === feed.id);
    if (!held) {
      out.push(feed);
      continue;
    }
    for (const source of feed.sources) if (!held.sources.some((s) => s.id === source.id)) held.sources.push(source);
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
