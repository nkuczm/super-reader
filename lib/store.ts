"use client";

import { canonicalUrl } from "./url";
import type { Article, SourceMeta } from "./types";

export type Source = SourceMeta & { id: string; kind: "feed" | "topic" | "page" | "sitemap" | "x" | "instagram" | "api" };
export type Feed = { id: string; name: string; sources: Source[] };

const KEY = "super-reader:v1";

export function newId() {
  return Math.random().toString(36).slice(2, 10);
}

export function loadFeeds(): Feed[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as Feed[]) : [];
  } catch {
    return [];
  }
}

export function saveFeeds(feeds: Feed[]) {
  try {
    window.localStorage.setItem(KEY, JSON.stringify(feeds));
  } catch {
    /* storage may be unavailable (private mode); the session still works */
  }
}

/**
 * A bookmarked article. The whole record is kept, not just its id: an article
 * drops out of its feed after a few weeks, and a saved one has to outlive
 * that — the point of saving it is that it is still there later.
 */
export type SavedArticle = Article & {
  /** Which source it came from, for the byline when the feed no longer has it. */
  sourceId?: string;
  sourceTitle?: string;
  favicon?: string;
  savedAt: number;
};

/**
 * A record that an article was *un*saved, and when.
 *
 * Saved articles sync as a union of what every device has, which is the only
 * merge that never loses a bookmark someone made while another device was
 * offline. The cost of a union is that removing something cannot be expressed
 * — the other device still has it, so it comes straight back. A tombstone is
 * how the removal travels: the newest of "saved at" and "unsaved at" wins.
 */
export type SavedTombstone = { link: string; at: number };

/** After this, a tombstone has done its job on every device that is still in use. */
const TOMBSTONE_DAYS = 90;

/**
 * How many saved articles are sent to the server.
 *
 * They are stored whole — headline, summary, image, source — so the list is
 * far heavier than the feed list beside it, and the payload has a ceiling.
 * The newest are the ones a second device wants; anything past this stays on
 * the device that saved it rather than being deleted anywhere.
 */
export const MAX_SYNCED_SAVED = 400;

const SAVED_KEY = "super-reader:saved:v1";
const UNSAVED_KEY = "super-reader:unsaved:v1";

export function loadSaved(): SavedArticle[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(SAVED_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? (parsed as SavedArticle[]) : [];
  } catch {
    return [];
  }
}

export function saveSaved(articles: SavedArticle[]) {
  try {
    window.localStorage.setItem(SAVED_KEY, JSON.stringify(articles));
  } catch {
    /* storage unavailable; the list just won't persist */
  }
}

export function loadUnsaved(): SavedTombstone[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(UNSAVED_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? (parsed as SavedTombstone[]) : [];
  } catch {
    return [];
  }
}

export function saveUnsaved(tombstones: SavedTombstone[]) {
  try {
    window.localStorage.setItem(UNSAVED_KEY, JSON.stringify(tombstones));
  } catch {
    /* storage unavailable */
  }
}

/** One key per article, so the same story saved from two feeds is one entry. */
function savedKey(link: string) {
  return canonicalUrl(link);
}

/**
 * Bring two devices' Saved lists together.
 *
 * Everything else in the synced document resolves by "most recent change
 * wins", which is right for the feed list — it is edited rarely and
 * deliberately. Bookmarks are not like that: they are added a few at a time,
 * on whichever device is to hand, and often while the other one is asleep. A
 * whole-document replace would mean saving something on a phone in the
 * morning and losing it the moment a laptop that had not pulled yet saved
 * something of its own. That is the bug people would actually hit.
 *
 * So Saved merges instead: the union of both lists, each article at its
 * earliest save, minus anything a device has since removed. Removals travel
 * as tombstones, and the newest timestamp decides — save it again after
 * removing it and it stays.
 */
export function mergeSaved(
  mine: SavedArticle[],
  theirs: SavedArticle[],
  myTombstones: SavedTombstone[] = [],
  theirTombstones: SavedTombstone[] = [],
  now = Date.now(),
): { saved: SavedArticle[]; unsaved: SavedTombstone[] } {
  const removed = new Map<string, number>();
  for (const tombstone of [...myTombstones, ...theirTombstones]) {
    if (!tombstone?.link) continue;
    const key = savedKey(tombstone.link);
    const at = Number(tombstone.at) || 0;
    if (at > (removed.get(key) ?? 0)) removed.set(key, at);
  }

  const kept = new Map<string, SavedArticle>();
  for (const article of [...mine, ...theirs]) {
    if (!article?.link) continue;
    const key = savedKey(article.link);
    const savedAt = Number(article.savedAt) || 0;
    // Removed more recently than it was saved: the removal is the later word.
    if ((removed.get(key) ?? 0) > savedAt) continue;
    const existing = kept.get(key);
    // The earliest save is the true one — re-saving on a second device should
    // not reorder a list the reader has been building.
    if (!existing || savedAt < (Number(existing.savedAt) || 0)) kept.set(key, article);
  }

  const cutoff = now - TOMBSTONE_DAYS * 24 * 60 * 60 * 1000;
  const unsaved = [...removed.entries()]
    .filter(([, at]) => at >= cutoff)
    .map(([link, at]) => ({ link, at }))
    .sort((a, b) => b.at - a.at);

  return {
    saved: [...kept.values()].sort(
      (a, b) => (Number(b.savedAt) || 0) - (Number(a.savedAt) || 0),
    ),
    unsaved,
  };
}

/**
 * Move a source into another feed.
 *
 * A move, not a copy: it leaves the feed it came from. If the target already
 * follows the same URL the two are merged rather than duplicated — dragging
 * something onto a feed that already has it should tidy up, not create a
 * second copy that then refreshes twice.
 */
export function moveSourceBetweenFeeds(
  feeds: Feed[],
  sourceId: string,
  fromFeedId: string,
  toFeedId: string,
): Feed[] {
  if (fromFeedId === toFeedId) return feeds;
  const source = feeds
    .find((feed) => feed.id === fromFeedId)
    ?.sources.find((s) => s.id === sourceId);
  if (!source) return feeds;
  if (!feeds.some((feed) => feed.id === toFeedId)) return feeds;

  return feeds.map((feed) => {
    if (feed.id === fromFeedId) {
      return { ...feed, sources: feed.sources.filter((s) => s.id !== sourceId) };
    }
    if (feed.id === toFeedId) {
      const already = feed.sources.some((s) => s.feedUrl === source.feedUrl);
      return already ? feed : { ...feed, sources: [...feed.sources, source] };
    }
    return feed;
  });
}

export type ViewMode = "magazine" | "cards" | "list";

/**
 * How the list is ordered. "top" ranks by how big the story is rather than
 * when it arrived — see lib/importance.ts for what that means.
 */
export type SortMode = "new" | "top";

/**
 * What the circle beside a big story's headline shows: the score out of 100,
 * or the plainer number it mostly rests on — how many newsrooms ran it.
 */
export type BigStoryMetric = "score" | "newsrooms";

export type Settings = {
  view: ViewMode;
  sort: SortMode;
  bigStoryMetric: BigStoryMetric;
  /** Hide articles already opened, rather than only dimming them. */
  hideRead: boolean;
  /**
   * Hosts whose articles open on their own site instead of in the reader.
   * Subscription sites are the case: the text is only available in a browser
   * that is logged in, so attempting reader view just wastes a tap.
   */
  openOnSite: string[];
};

export const DEFAULT_SETTINGS: Settings = {
  view: "cards",
  sort: "new",
  bigStoryMetric: "score",
  hideRead: false,
  openOnSite: [],
};

const SETTINGS_KEY = "super-reader:settings:v1";

/**
 * Kept per device rather than synced: a phone and a desktop want different
 * densities, and the feeds themselves are what needs to match.
 */
export function loadSettings(): Settings {
  if (typeof window === "undefined") return DEFAULT_SETTINGS;
  try {
    const raw = window.localStorage.getItem(SETTINGS_KEY);
    if (!raw) return DEFAULT_SETTINGS;
    const parsed = JSON.parse(raw) as Partial<Settings>;
    return {
      view: (["magazine", "cards", "list"] as const).includes(parsed.view as ViewMode)
        ? (parsed.view as ViewMode)
        : DEFAULT_SETTINGS.view,
      sort: parsed.sort === "top" ? "top" : DEFAULT_SETTINGS.sort,
      bigStoryMetric:
        parsed.bigStoryMetric === "newsrooms"
          ? "newsrooms"
          : DEFAULT_SETTINGS.bigStoryMetric,
      hideRead: Boolean(parsed.hideRead),
      openOnSite: Array.isArray(parsed.openOnSite)
        ? parsed.openOnSite.filter((h): h is string => typeof h === "string")
        : [],
    };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

export function saveSettings(settings: Settings) {
  try {
    window.localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  } catch {
    /* storage unavailable; the choice just won't persist */
  }
}

const COLLAPSED_KEY = "super-reader:collapsed:v1";

/** Which feeds are collapsed. Per device, like the other view preferences. */
export function loadCollapsed(): Set<string> {
  if (typeof window === "undefined") return new Set();
  try {
    const raw = window.localStorage.getItem(COLLAPSED_KEY);
    return new Set(raw ? (JSON.parse(raw) as string[]) : []);
  } catch {
    return new Set();
  }
}

export function saveCollapsed(collapsed: Set<string>) {
  try {
    window.localStorage.setItem(COLLAPSED_KEY, JSON.stringify([...collapsed]));
  } catch {
    /* storage unavailable; the groups just reopen next time */
  }
}

const CODE_KEY = "super-reader:sync-code:v1";

export function loadSyncCode(): string | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage.getItem(CODE_KEY);
  } catch {
    return null;
  }
}

export function saveSyncCode(code: string | null) {
  try {
    if (code) window.localStorage.setItem(CODE_KEY, code);
    else window.localStorage.removeItem(CODE_KEY);
  } catch {
    /* storage unavailable; sync just won't persist across reloads */
  }
}

const VAULT_KEY = "super-reader:vault:v1";
const UNLOCKED_KEY = "super-reader:keys:v1";

/**
 * The encrypted vault. This is the copy that syncs; it is useless without the
 * passphrase, which never leaves the browser.
 */
export function loadVault(): unknown | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(VAULT_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export function saveVault(blob: unknown | null) {
  try {
    if (blob) window.localStorage.setItem(VAULT_KEY, JSON.stringify(blob));
    else window.localStorage.removeItem(VAULT_KEY);
  } catch {
    /* storage unavailable; the vault just won't persist */
  }
}

/**
 * The decrypted keys, kept on this device so the passphrase is asked for once
 * per device rather than once per launch. This is the same exposure as any
 * other app secret on a phone you control — what the passphrase protects is
 * the copy that travels through sync.
 */
export function loadUnlockedKeys(): Record<string, string> {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(UNLOCKED_KEY);
    const parsed = raw ? JSON.parse(raw) : {};
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

export function saveUnlockedKeys(keys: Record<string, string> | null) {
  try {
    if (keys && Object.keys(keys).length > 0) {
      window.localStorage.setItem(UNLOCKED_KEY, JSON.stringify(keys));
    } else {
      window.localStorage.removeItem(UNLOCKED_KEY);
    }
  } catch {
    /* ignore */
  }
}

const UPDATED_KEY = "super-reader:updated-at:v1";

/**
 * When the synced data last changed on this device. Sync resolves by this
 * rather than by who wrote last, so a device that has been closed for a week
 * cannot overwrite what happened while it was away.
 */
export function loadUpdatedAt(): number {
  if (typeof window === "undefined") return 0;
  try {
    return Number(window.localStorage.getItem(UPDATED_KEY)) || 0;
  } catch {
    return 0;
  }
}

export function saveUpdatedAt(at: number) {
  try {
    window.localStorage.setItem(UPDATED_KEY, String(at));
  } catch {
    /* storage unavailable; sync falls back to whatever the server holds */
  }
}

const READ_KEY = "super-reader:read:v1";

export function loadRead(): Set<string> {
  if (typeof window === "undefined") return new Set();
  try {
    const raw = window.localStorage.getItem(READ_KEY);
    return new Set(raw ? (JSON.parse(raw) as string[]) : []);
  } catch {
    return new Set();
  }
}

export function saveRead(read: Set<string>) {
  try {
    // Cap the history so storage cannot grow without bound.
    const ids = [...read].slice(-3000);
    window.localStorage.setItem(READ_KEY, JSON.stringify(ids));
  } catch {
    /* ignore */
  }
}
