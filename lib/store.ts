"use client";

import type { Article, SourceMeta } from "./types";

export type Source = SourceMeta & { id: string; kind: "feed" | "topic" | "page" | "x" | "api" };
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

const SAVED_KEY = "super-reader:saved:v1";

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

export type ViewMode = "magazine" | "cards" | "list";

export type Settings = {
  view: ViewMode;
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
