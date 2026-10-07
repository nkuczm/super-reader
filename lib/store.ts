"use client";

import { DEFAULT_ANTHROPIC_MODEL, DEFAULT_QUICK_MODEL, modelFor } from "./models";

/** A quick-tools model as stored: an offered Claude model, or any named OpenAI one; else the default. */
function quickModel(provider: "anthropic" | "openai", value: unknown): string {
  if (typeof value !== "string" || !value.trim()) return DEFAULT_QUICK_MODEL[provider];
  return provider === "openai" ? value.trim() : modelFor("anthropic", value);
}
import type { Article, SourceMeta } from "./types";
import type { SavedArticle, SavedRemoval } from "./saved";
import type { WatchMarks } from "./alerts";
import { PARTS, type PartStamps } from "./sync-doc";
import { cleanFeeds, sanitizeTeams } from "./feed-merge";
export { cleanFeeds, unionFeeds, unionTeams, unionRead, sanitizeTeams } from "./feed-merge";

export type Source = SourceMeta & {
  id: string;
  kind: "feed" | "topic" | "page" | "x" | "api";
  /**
   * Whether this follows a whole publisher or one section of one.
   *
   * Recorded at the moment it is added, because only discovery knows: by the
   * time a source is refreshed, all that is left is a feed URL, and a section
   * feed and a site feed are indistinguishable from one. It decides whether
   * the publisher's news sitemap may be merged in — doing that to a section
   * would quietly turn "BBC Technology" into "the BBC".
   */
  scope?: "section" | "site";
  /**
   * Watch this source for new posts: highlight it in the sidebar and list it
   * in Notifications until it has been looked at. Kept on the source itself
   * so it travels with the feed list that already syncs.
   */
  notify?: boolean;
};
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
    return cleanFeeds(JSON.parse(raw));
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

export type { SavedArticle, SavedRemoval } from "./saved";

const SAVED_KEY = "super-reader:saved:v1";

export function loadSaved(): SavedArticle[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(SAVED_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed)
      ? (parsed as SavedArticle[]).filter((article) => article && typeof article.link === "string")
      : [];
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

const REMOVED_KEY = "super-reader:saved-removed:v1";

/**
 * Un-saves, dated. Without these a device that still holds the article puts
 * it straight back on the next sync — see lib/saved.ts.
 */
export function loadSavedRemovals(): SavedRemoval[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(REMOVED_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? (parsed as SavedRemoval[]) : [];
  } catch {
    return [];
  }
}

export function saveSavedRemovals(removals: SavedRemoval[]) {
  try {
    window.localStorage.setItem(REMOVED_KEY, JSON.stringify(removals));
  } catch {
    /* storage unavailable; an un-save may come back after a sync */
  }
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

/**
 * Put a source at a place: in `toFeedId`, beside `targetSourceId` (after it
 * when `after`), or at the end with no target. The same feed reorders it;
 * another feed moves it, unless that feed already follows the same address.
 */
export function placeSource(
  feeds: Feed[],
  sourceId: string,
  fromFeedId: string,
  toFeedId: string,
  targetSourceId: string | null,
  after: boolean,
): Feed[] {
  const source = feeds.find((f) => f.id === fromFeedId)?.sources.find((s) => s.id === sourceId);
  const target = feeds.find((f) => f.id === toFeedId);
  if (!source || !target || targetSourceId === sourceId) return feeds;
  if (toFeedId !== fromFeedId && target.sources.some((s) => s.feedUrl === source.feedUrl)) {
    return feeds.map((f) => (f.id === fromFeedId ? { ...f, sources: f.sources.filter((s) => s.id !== sourceId) } : f));
  }
  return feeds.map((feed) => {
    let sources = feed.id === fromFeedId ? feed.sources.filter((s) => s.id !== sourceId) : feed.sources;
    if (feed.id === toFeedId) {
      const at = targetSourceId ? sources.findIndex((s) => s.id === targetSourceId) : -1;
      const index = at < 0 ? sources.length : at + (after ? 1 : 0);
      sources = [...sources.slice(0, index), source, ...sources.slice(index)];
    }
    return sources === feed.sources ? feed : { ...feed, sources };
  });
}

/** Move a whole feed beside another (after it when `after`). */
export function placeFeed(feeds: Feed[], feedId: string, targetFeedId: string, after: boolean): Feed[] {
  const moving = feeds.find((f) => f.id === feedId);
  if (!moving || feedId === targetFeedId) return feeds;
  const rest = feeds.filter((f) => f.id !== feedId);
  const at = rest.findIndex((f) => f.id === targetFeedId);
  if (at < 0) return feeds;
  const index = at + (after ? 1 : 0);
  return [...rest.slice(0, index), moving, ...rest.slice(index)];
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
   * Whether the offline download shows a progress bar across the top of the
   * screen. Off by default: the download runs on every visit, and a bar that
   * appears unbidden reads as the app loading something you asked for. Settings
   * still reports what is on the device, which is the question that matters.
   */
  showDownloadBar: boolean;
  /**
   * Whether highlighting text in an article offers to quote it into a note.
   * A switch because it changes what a selection does: with it off, selecting
   * text is just selecting text.
   */
  quoteToNote: boolean;
  /**
   * Hosts whose articles open on their own site instead of in the reader.
   * Subscription sites are the case: the text is only available in a browser
   * that is logged in, so attempting reader view just wastes a tap.
   */
  openOnSite: string[];
  /**
   * Subjects: notes grown into boards of story cards, text boxes and AI
   * insights (lib/subjects.ts). Off by default, and with it off notes look
   * and behave exactly as they did before.
   */
  subjects: boolean;
  /** In a subject's document view, draw a story's or text box's border only on hover or while editing it. */
  hideSubjectBoxes: boolean;
  /** A new text box's width in pixels; 0 is the default (full column in the document, 280 on the whiteboard). */
  textBoxWidth: number;
  /** Which AI the Subjects insights use, with the reader's own key for it. */
  aiProvider: "anthropic" | "openai";
  /** The OpenAI model, when that is the provider. */
  openaiModel: string;
  /** The Claude model, when Anthropic is the provider — for deep analysis. */
  anthropicModel: string;
  /** The models for quick tools (transcript search, suggested reading), per provider. */
  anthropicQuickModel: string;
  openaiQuickModel: string;
};

export const DEFAULT_SETTINGS: Settings = {
  view: "cards",
  sort: "new",
  bigStoryMetric: "score",
  hideRead: false,
  showDownloadBar: false,
  quoteToNote: true,
  openOnSite: [],
  subjects: true,
  hideSubjectBoxes: false,
  textBoxWidth: 0,
  aiProvider: "anthropic",
  openaiModel: "gpt-5-mini",
  anthropicModel: DEFAULT_ANTHROPIC_MODEL,
  anthropicQuickModel: DEFAULT_QUICK_MODEL.anthropic,
  openaiQuickModel: DEFAULT_QUICK_MODEL.openai,
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
      subjects: true,
      hideSubjectBoxes: parsed.hideSubjectBoxes === true,
      textBoxWidth:
        typeof parsed.textBoxWidth === "number" && parsed.textBoxWidth >= 160 && parsed.textBoxWidth <= 1000
          ? Math.round(parsed.textBoxWidth)
          : 0,
      aiProvider: parsed.aiProvider === "openai" ? "openai" : "anthropic",
      openaiModel:
        typeof parsed.openaiModel === "string" && parsed.openaiModel.trim()
          ? parsed.openaiModel.trim()
          : DEFAULT_SETTINGS.openaiModel,
      anthropicModel: modelFor("anthropic", parsed.anthropicModel),
      anthropicQuickModel: quickModel("anthropic", parsed.anthropicQuickModel),
      openaiQuickModel: quickModel("openai", parsed.openaiQuickModel),
      showDownloadBar: Boolean(parsed.showDownloadBar),
      quoteToNote: parsed.quoteToNote !== false,
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

/**
 * The settings that follow a person between their devices.
 *
 * Most settings are deliberately per device — a phone and a desktop want
 * different layouts. These are not about layout but about how the reader
 * works: whether notes are Subjects, and which AI they use. With them kept
 * per device, a laptop with Subjects on and a phone with it off showed the
 * same synced subjects in two different shapes. Most recent change wins.
 */
export type SharedPrefs = {
  subjects: boolean;
  aiProvider: "anthropic" | "openai";
  openaiModel: string;
  anthropicModel: string;
  anthropicQuickModel: string;
  openaiQuickModel: string;
  /** When these last changed, on the device that changed them. 0 = never chosen. */
  at: number;
};

const PREFS_KEY = "super-reader:shared-prefs:v1";

export function sharedPrefsOf(settings: Settings, at: number): SharedPrefs {
  return { subjects: settings.subjects, aiProvider: settings.aiProvider, openaiModel: settings.openaiModel, anthropicModel: settings.anthropicModel,
    anthropicQuickModel: settings.anthropicQuickModel, openaiQuickModel: settings.openaiQuickModel, at };
}

export function sameSharedPrefs(a: SharedPrefs, b: Settings | SharedPrefs) {
  return a.subjects === b.subjects && a.aiProvider === b.aiProvider && a.openaiModel === b.openaiModel && a.anthropicModel === b.anthropicModel
    && a.anthropicQuickModel === b.anthropicQuickModel && a.openaiQuickModel === b.openaiQuickModel;
}

/**
 * What this device has chosen. A device that turned Subjects on before these
 * synced has no stamp yet; its choice is dated now, so it reaches the others,
 * while a device still on the defaults stays at 0 and takes theirs.
 */
export function loadSharedPrefs(settings: Settings): SharedPrefs {
  if (typeof window !== "undefined") {
    try {
      const stored = JSON.parse(window.localStorage.getItem(PREFS_KEY) ?? "null");
      if (stored && typeof stored.at === "number") return sharedPrefsOf(settings, stored.at);
    } catch {
      /* fall through */
    }
  }
  // A device with no record of when these were chosen claims no date at all,
  // so whatever another device chose wins over its leftovers. Stamping "now"
  // here let a stale copy override a real choice made elsewhere.
  return sharedPrefsOf(settings, 0);
}

export function saveSharedPrefs(prefs: SharedPrefs) {
  try {
    window.localStorage.setItem(PREFS_KEY, JSON.stringify({ at: prefs.at }));
  } catch {
    /* the choice still applies on this device */
  }
}

/** A synced copy, checked: only well-formed values are taken. */
export function cleanSharedPrefs(input: unknown): SharedPrefs | null {
  if (!input || typeof input !== "object") return null;
  const p = input as Partial<SharedPrefs>;
  if (typeof p.at !== "number" || typeof p.subjects !== "boolean") return null;
  return {
    subjects: p.subjects,
    aiProvider: p.aiProvider === "openai" ? "openai" : "anthropic",
    openaiModel: typeof p.openaiModel === "string" && p.openaiModel.trim() ? p.openaiModel.trim() : DEFAULT_SETTINGS.openaiModel,
    // A copy from before the Claude model could be chosen means the default.
    anthropicModel: modelFor("anthropic", p.anthropicModel),
    anthropicQuickModel: quickModel("anthropic", p.anthropicQuickModel),
    openaiQuickModel: quickModel("openai", p.openaiQuickModel),
    at: p.at,
  };
}

const MARKS_KEY = "super-reader:watch-marks:v1";

/**
 * How far each watched source has been read up to. Synced as well as stored,
 * so looking at a source on one device clears its badge on the other.
 */
export function loadWatchMarks(): WatchMarks {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(MARKS_KEY);
    const parsed = raw ? JSON.parse(raw) : {};
    return parsed && typeof parsed === "object" ? (parsed as WatchMarks) : {};
  } catch {
    return {};
  }
}

export function saveWatchMarks(marks: WatchMarks) {
  try {
    window.localStorage.setItem(MARKS_KEY, JSON.stringify(marks));
  } catch {
    /* storage unavailable; badges just won't persist across reloads */
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

/**
 * The team feeds this device is connected to: a name and the connect code
 * that reaches the shared list. The articles themselves are not kept here —
 * they live on the server, because several people write to them.
 */
export type TeamFeed = { code: string; name: string };

const TEAMS_KEY = "super-reader:teams:v1";

export function loadTeams(): TeamFeed[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(TEAMS_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? sanitizeTeams(parsed) : [];
  } catch {
    return [];
  }
}

export function saveTeams(teams: TeamFeed[]) {
  try {
    window.localStorage.setItem(TEAMS_KEY, JSON.stringify(teams));
  } catch {
    /* storage unavailable; the connection just won't persist */
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

const PART_STAMPS_KEY = "super-reader:part-stamps:v1";

/**
 * When this device last changed each part that sync replaces whole (the feed
 * list, read marks, team list, vault). A device from before these existed
 * dates every part at its one old stamp, which is what sync used to go by.
 */
export function loadPartStamps(): PartStamps {
  if (typeof window === "undefined") return {};
  try {
    const parsed = JSON.parse(window.localStorage.getItem(PART_STAMPS_KEY) ?? "null");
    if (parsed && typeof parsed === "object") {
      return Object.fromEntries(PARTS.map((part) => [part, Number(parsed[part]) || 0]));
    }
  } catch {
    /* fall through */
  }
  const legacy = loadUpdatedAt();
  return Object.fromEntries(PARTS.map((part) => [part, legacy]));
}

export function savePartStamps(stamps: PartStamps) {
  try {
    window.localStorage.setItem(PART_STAMPS_KEY, JSON.stringify(stamps));
  } catch {
    /* sync falls back to the server's copy */
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
