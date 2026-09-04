"use client";

import type { SourceMeta } from "./types";

export type Source = SourceMeta & { id: string; kind: "feed" | "topic" | "page" | "x" };
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

export type ViewMode = "magazine" | "cards" | "list";

export type Settings = {
  view: ViewMode;
  /** Hide articles already opened, rather than only dimming them. */
  hideRead: boolean;
};

export const DEFAULT_SETTINGS: Settings = { view: "cards", hideRead: false };

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
