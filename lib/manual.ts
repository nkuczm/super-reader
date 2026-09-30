/**
 * Stories pasted in by hand.
 *
 * A link copied from anywhere becomes a story in the reader. If it belongs to
 * a source already followed it is filed under that source, beside what the
 * feed delivers; otherwise it goes into "Added by you", a list of its own for
 * stories that no feed brought. Either way it is recorded here, so a refresh
 * — which rebuilds the list from the feeds — can never drop it.
 *
 * Synced like bookmarks: per link, the most recent change wins, and removing
 * one is a dated deletion rather than a disappearance, so the other device
 * does not put it back.
 */

import { canonicalUrl } from "./url";

export type ManualStory = {
  link: string;
  title: string;
  summary?: string;
  image?: string;
  publishedAt?: string;
  /** The site's own name for itself, for a story with no source. */
  siteName?: string;
  /** The followed source it was filed under, if any. */
  sourceId?: string;
  /** When it was pasted in, or last changed. */
  at: number;
  deleted?: boolean;
};

/** Keyed by canonical link, so the same story pasted twice is one. */
export type ManualStories = Record<string, ManualStory>;

/** The pseudo-source id of the "Added by you" list. */
export const MANUAL_SOURCE = "manual";

const KEY = "super-reader:manual:v1";
const TOMBSTONE_TTL_MS = 90 * 24 * 60 * 60 * 1000;
const MAX_STORIES = 500;

export function loadManual(): ManualStories {
  if (typeof window === "undefined") return {};
  try {
    const parsed = JSON.parse(window.localStorage.getItem(KEY) ?? "{}");
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

export function saveManual(stories: ManualStories) {
  try {
    window.localStorage.setItem(KEY, JSON.stringify(stories));
  } catch {
    /* storage full; the story still shows this session */
  }
}

export function liveManual(stories: ManualStories): ManualStory[] {
  return Object.values(stories ?? {})
    .filter((story) => !story.deleted)
    .sort((a, b) => b.at - a.at);
}

export function mergeManual(mine: ManualStories, theirs: ManualStories, now = Date.now()): ManualStories {
  const merged: ManualStories = {};
  for (const source of [mine ?? {}, theirs ?? {}]) {
    for (const [key, story] of Object.entries(source)) {
      if (!story || typeof story.link !== "string" || typeof story.at !== "number") continue;
      if (!merged[key] || story.at > merged[key].at) merged[key] = story;
    }
  }
  const kept = Object.entries(merged)
    .filter(([, story]) => !(story.deleted && now - story.at > TOMBSTONE_TTL_MS))
    .sort((a, b) => b[1].at - a[1].at)
    .slice(0, MAX_STORIES);
  return Object.fromEntries(kept);
}

export function sameManual(a: ManualStories, b: ManualStories) {
  const keys = Object.keys(a ?? {});
  if (keys.length !== Object.keys(b ?? {}).length) return false;
  return keys.every((key) => b[key] && b[key].at === a[key].at && !!b[key].deleted === !!a[key].deleted);
}

/**
 * The link in whatever was copied: a bare URL, a URL in a sentence, or a
 * share sheet's "Headline — https://…". Trailing punctuation that belongs to
 * the sentence rather than the link is left behind.
 */
export function linkIn(text: string): string | null {
  const match = String(text ?? "").match(/https?:\/\/[^\s<>"'“”‘’]+/i);
  if (!match) return null;
  const link = match[0].replace(/[),.;:!?\]]+$/, "");
  try {
    const url = new URL(link);
    return url.protocol === "http:" || url.protocol === "https:" ? url.toString() : null;
  } catch {
    return null;
  }
}

function hostOf(link: string | undefined) {
  if (!link) return "";
  try {
    return new URL(link).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return "";
  }
}

/**
 * The followed source a story belongs to, by host.
 *
 * The site a source reads is the evidence: a story on nytimes.com goes to the
 * source whose site is nytimes.com. Matched on a dot boundary, so a story on
 * cooking.nytimes.com finds nytimes.com but notnytimes.com finds nothing.
 * Where several sources share the host — a paper's sections — the one whose
 * site path the story's path starts with wins, then the most specific host.
 */
export function sourceFor<S extends { id: string; siteUrl?: string; feedUrl: string; kind?: string }>(
  link: string,
  sources: S[],
): S | null {
  const host = hostOf(link);
  if (!host) return null;
  let path = "";
  try {
    path = new URL(link).pathname;
  } catch {
    /* host is enough */
  }
  let best: { source: S; score: number } | null = null;
  for (const source of sources) {
    if (source.kind === "topic") continue;
    const own = hostOf(source.siteUrl) || hostOf(source.feedUrl);
    if (!own || (host !== own && !host.endsWith(`.${own}`))) continue;
    let sitePath = "";
    try {
      sitePath = source.siteUrl ? new URL(source.siteUrl).pathname.replace(/\/$/, "") : "";
    } catch {
      /* no path to compare */
    }
    const score = own.length + (sitePath && path.startsWith(`${sitePath}/`) ? 1000 + sitePath.length : 0);
    if (!best || score > best.score) best = { source, score };
  }
  return best?.source ?? null;
}

/** A story's key in the manual list and in the reader's own list. */
export function manualKey(link: string) {
  return canonicalUrl(link);
}
