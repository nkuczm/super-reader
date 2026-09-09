"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Article, Attachment, DiscoverResult } from "@/lib/types";
import {
  loadFeeds,
  saveFeeds,
  loadRead,
  saveRead,
  loadSyncCode,
  saveSyncCode,
  loadSettings,
  saveSettings,
  loadCollapsed,
  saveCollapsed,
  DEFAULT_SETTINGS,
  type Settings,
  newId,
  moveSourceBetweenFeeds,
  loadSaved,
  saveSaved,
  loadVault,
  saveVault,
  loadUpdatedAt,
  saveUpdatedAt,
  loadUnlockedKeys,
  saveUnlockedKeys,
  type SavedArticle,
  type Feed,
  type Source,
} from "@/lib/store";
import AddSourceDialog from "./AddSourceDialog";
import SyncDialog from "./SyncDialog";
import InlineName from "./InlineName";
import SettingsDialog from "./SettingsDialog";
import DownloadBar from "./DownloadBar";
import Attachments from "./Attachments";
import { useSourceDrag } from "./useSourceDrag";
import { encodeKeysHeader, KEYS_HEADER } from "@/lib/vault";
import {
  downloadForOffline,
  isDownloadDue,
  currentSlot,
  markSlotDownloaded,
  lastDownloadedAt,
  readCached,
  writeCached,
  cachedUrls,
  savedLinks,
  purgeStaleVersion,
  requestPersistence,
  saveListSnapshot,
  loadListSnapshot,
  articleEndpoint,
  type OfflineTarget,
  PER_SOURCE,
} from "@/lib/offline";
import ArticleReader from "./ArticleReader";
import SourceIcon from "./SourceIcon";
import { Icon } from "./icons";
import { timeAgo, hostOf } from "./format";
import { sortNewestFirst } from "@/lib/sort";
import "./reader.css";

type Loaded = Article & { sourceId: string };

/**
 * The reader's own API keys travel in a header rather than the URL, so a key
 * never reaches a log line or a referrer. The server uses them for that one
 * request and keeps nothing.
 */
/** "Final rule (PDF)" reads better in a list than "rule-2026-04.pdf". */
function fileTitleFor(file: Attachment, parentTitle: string) {
  const kind = file.kind === "pdf" ? "PDF" : file.kind.toUpperCase();
  return `${parentTitle} (${kind})`;
}

function keyHeadersFrom(keys: Record<string, string>): HeadersInit | undefined {
  return Object.keys(keys).length === 0
    ? undefined
    : { [KEYS_HEADER]: encodeKeysHeader(keys) };
}
type Selection =
  | { type: "all" }
  | { type: "saved" }
  | { type: "feed" | "source"; id: string };

export default function Reader() {
  const [feeds, setFeeds] = useState<Feed[]>([]);
  const [ready, setReady] = useState(false);
  const [articles, setArticles] = useState<Loaded[]>([]);
  const [read, setRead] = useState<Set<string>>(new Set());
  const [selection, setSelection] = useState<Selection>({ type: "all" });
  const [dialogOpen, setDialogOpen] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [reading, setReading] = useState<{
    url: string;
    title: string;
    feedUrl?: string;
    summary?: string;
  } | null>(null);
  const [syncCode, setSyncCode] = useState<string | null>(null);
  const [syncOpen, setSyncOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  // Naming and deleting happen inline in the sidebar rather than in
  // browser prompt()/confirm() dialogs.
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<string | null>(null);
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [saved, setSaved] = useState<SavedArticle[]>([]);
  /** Whether the browser promised to keep this cache rather than evict it. */
  const [persisted, setPersisted] = useState(false);
  const [vault, setVault] = useState<unknown | null>(null);
  const [apiKeys, setApiKeys] = useState<Record<string, string>>({});
  // refresh() is created once and reads the keys through this, rather than
  // being rebuilt — and re-running every feed fetch — whenever a key changes.
  const apiKeysRef = useRef<Record<string, string>>({});
  const [offline, setOffline] = useState<{
    state: "idle" | "working" | "done" | "error";
    done?: number;
    total?: number;
    at?: number | null;
    /** How the last run ended, so Settings can say more than "it ran". */
    result?: { saved: number; failed: number };
  }>({ state: "idle" });
  /**
   * Which articles are on the device already. Kept as a set of links so the
   * list can mark them without asking IndexedDB per row on every render.
   */
  const [savedOffline, setSavedOffline] = useState<Set<string>>(new Set());
  const downloading = useRef(false);
  const prefetched = useRef<Set<string>>(new Set());
  const [syncState, setSyncState] = useState<
    "idle" | "working" | "saved" | "error"
  >("idle");
  // Set while applying data pulled from the server, so the save effect below
  // does not immediately push it straight back.
  const applying = useRef(false);
  /**
   * When this device's synced data last changed. Held in a ref as well as
   * state: the stamping effect reads it, and depending on the state it sets
   * would make it re-stamp on every render.
   */
  const [updatedAt, setUpdatedAt] = useState(0);
  const updatedAtRef = useRef(0);
  /**
   * Nothing may be pushed until the first pull has answered. Without this the
   * debounced save fires ~900ms after load, carrying whatever was in local
   * storage — which is how a desktop left closed for a week overwrote a
   * phone's newer feeds the moment it was opened.
   */
  const pulled = useRef(false);
  const hydrated = useRef(false);
  const pushedAt = useRef(0);

  useEffect(() => {
    setFeeds(loadFeeds());
    setRead(loadRead());
    setSyncCode(loadSyncCode());
    setSettings(loadSettings());
    setCollapsed(loadCollapsed());
    setSaved(loadSaved());
    setVault(loadVault());
    setApiKeys(loadUnlockedKeys());
    updatedAtRef.current = loadUpdatedAt();
    setUpdatedAt(updatedAtRef.current);
    setReady(true);
  }, []);

  // Lets the app open with no connection.
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;
    navigator.serviceWorker.register("/sw.js").catch(() => {
      /* unsupported or blocked; everything else still works */
    });
  }, []);

  const applyRemote = useCallback((payload: { feeds?: Feed[]; read?: string[]; vault?: unknown; updatedAt?: number }) => {
    applying.current = true;
    if (Array.isArray(payload.feeds)) setFeeds(payload.feeds);
    // The vault arrives encrypted; it stays locked until a passphrase is
    // entered on this device, which is the whole point of it.
    if (payload.vault) {
      setVault(payload.vault);
      saveVault(payload.vault);
    }
    if (Array.isArray(payload.read)) {
      const next = new Set(payload.read);
      setRead(next);
      saveRead(next);
    }
    if (typeof payload.updatedAt === "number" && payload.updatedAt > 0) {
      updatedAtRef.current = payload.updatedAt;
      setUpdatedAt(payload.updatedAt);
      saveUpdatedAt(payload.updatedAt);
      pushedAt.current = payload.updatedAt;
    }
    // Release on the next tick, after the state updates have flushed.
    setTimeout(() => {
      applying.current = false;
    }, 0);
  }, []);

  const pull = useCallback(
    async (code: string) => {
      const res = await fetch(`/api/sync?code=${encodeURIComponent(code)}`);
      const data = await res.json();
      // Even a failed pull opens the gate: a device that cannot read must not
      // be stuck unable to write for the rest of the session.
      pulled.current = true;
      if (!res.ok) throw new Error(data.error ?? "Could not fetch synced feeds");

      const remote = data.payload ?? {};
      const theirs = Number(remote.updatedAt ?? 0);
      // Older than what this device has? Keep ours; the push below sends it.
      if (theirs >= loadUpdatedAt()) applyRemote(remote);
    },
    [applyRemote],
  );

  useEffect(() => {
    if (ready) saveFeeds(feeds);
  }, [feeds, ready]);

  /**
   * Stamp a real local change. The first run is the load from storage, which
   * is not a change — stamping it would make a stale device look like the
   * freshest one.
   */
  useEffect(() => {
    if (!ready) return;
    if (!hydrated.current) {
      hydrated.current = true;
      return;
    }
    if (applying.current) return;
    // Always outrank what this device last saw. Wall clocks disagree between
    // devices, and a stamp pulled from one running ahead would otherwise
    // freeze this device out of syncing anything ever again.
    const now = Math.max(Date.now(), updatedAtRef.current + 1);
    updatedAtRef.current = now;
    setUpdatedAt(now);
    saveUpdatedAt(now);
  }, [feeds, read, vault, ready]);

  // Pull once the code is known, and again whenever the window regains focus,
  // so a device left open picks up changes made elsewhere.
  useEffect(() => {
    if (!ready || !syncCode) return;
    let cancelled = false;

    const sync = async () => {
      setSyncState("working");
      try {
        await pull(syncCode);
        if (!cancelled) setSyncState("saved");
      } catch {
        if (!cancelled) setSyncState("error");
      }
    };

    sync();
    window.addEventListener("focus", sync);
    return () => {
      cancelled = true;
      window.removeEventListener("focus", sync);
    };
  }, [ready, syncCode, pull]);

  // Push local changes, debounced so a burst of edits is one request.
  useEffect(() => {
    if (!ready || !syncCode || applying.current) return;
    if (!pulled.current) return; // never before knowing what is out there
    if (updatedAt === 0 || updatedAt <= pushedAt.current) return;

    const timer = setTimeout(async () => {
      setSyncState("working");
      try {
        const res = await fetch("/api/sync", {
          method: "PUT",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            code: syncCode,
            feeds,
            read: [...read],
            vault,
            updatedAt,
          }),
        });
        if (res.status === 409) {
          // Something newer arrived while this device was away; take it.
          const data = await res.json();
          applyRemote(data.payload ?? {});
          setSyncState("saved");
          return;
        }
        if (!res.ok) throw new Error("save failed");
        pushedAt.current = updatedAt;
        setSyncState("saved");
      } catch {
        setSyncState("error");
      }
    }, 900);
    return () => clearTimeout(timer);
  }, [feeds, read, ready, syncCode, vault, updatedAt, applyRemote]);

  const startSync = useCallback(async () => {
    setSyncState("working");
    const res = await fetch("/api/sync", { method: "POST" });
    const data = await res.json();
    if (!res.ok) {
      setSyncState("error");
      throw new Error(data.error ?? "Could not start syncing");
    }

    // Upload what this device already has *before* the code goes live,
    // otherwise the first pull would overwrite these feeds with the empty
    // record we just created.
    const saved = await fetch("/api/sync", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ code: data.code, feeds, read: [...read] }),
    });
    if (!saved.ok) {
      setSyncState("error");
      throw new Error("Could not upload this device's feeds");
    }

    saveSyncCode(data.code);
    setSyncCode(data.code);
    setSyncState("saved");
  }, [feeds, read]);

  const connectSync = useCallback(
    async (entered: string) => {
      setSyncState("working");
      try {
        await pull(entered);
      } catch (error) {
        setSyncState("error");
        throw error;
      }
      saveSyncCode(entered);
      setSyncCode(entered);
      setSyncState("saved");
    },
    [pull],
  );

  const stopSync = useCallback(() => {
    saveSyncCode(null);
    setSyncCode(null);
    setSyncState("idle");
    setSyncOpen(false);
  }, []);

  const allSources = useMemo(
    () => feeds.flatMap((feed) => feed.sources),
    [feeds],
  );

  /** Fetch every known feed and merge the results newest-first. */
  const refresh = useCallback(async (sources: Source[]) => {
    if (sources.length === 0) {
      setArticles([]);
      return;
    }
    setRefreshing(true);
    try {
      const params = new URLSearchParams();
      for (const source of sources) params.append("url", source.feedUrl);
      const res = await fetch(`/api/feed?${params}`, { headers: keyHeadersFrom(apiKeysRef.current) });
      const data = await res.json();

      const byUrl = new Map(sources.map((s) => [s.feedUrl, s.id]));
      const merged: Loaded[] = [];
      for (const result of data.results ?? []) {
        const sourceId = byUrl.get(result.feedUrl);
        if (!sourceId) continue;
        for (const article of result.articles as Article[]) {
          merged.push({ ...article, sourceId, id: `${sourceId}:${article.id}` });
        }
      }
      const ordered = sortNewestFirst(merged);
      setArticles(ordered);
      // Keep a copy so the list is still there with no connection.
      void saveListSnapshot(ordered);
    } catch {
      // Offline or the feeds are unreachable: show what was last saved.
      const snapshot = await loadListSnapshot<Loaded>();
      if (snapshot && snapshot.length > 0) setArticles(snapshot);
    } finally {
      setRefreshing(false);
    }
  }, []);

  // Reload whenever the set of sources changes.
  const sourceKey = allSources.map((s) => s.feedUrl).join("|");
  useEffect(() => {
    if (ready) refresh(allSources);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sourceKey, ready]);

  function addSource(result: DiscoverResult, target: string) {
    const source: Source = {
      id: newId(),
      kind: result.kind,
      feedUrl: result.feedUrl,
      siteUrl: result.siteUrl,
      title: result.title,
      description: result.description,
      favicon: result.favicon,
    };

    setFeeds((current) => {
      const exists = current.some((feed) => feed.id === target);
      if (!exists) {
        const feed: Feed = {
          id: newId(),
          name: result.title,
          sources: [source],
        };
        setSelection({ type: "feed", id: feed.id });
        return [...current, feed];
      }
      return current.map((feed) =>
        feed.id === target
          ? // Adding the same feed twice is a no-op rather than a duplicate.
            feed.sources.some((s) => s.feedUrl === source.feedUrl)
            ? feed
            : { ...feed, sources: [...feed.sources, source] }
          : feed,
      );
    });
    setDialogOpen(false);
  }

  function createFeed(name: string) {
    const trimmed = name.trim();
    if (!trimmed) return;
    const feed: Feed = { id: newId(), name: trimmed, sources: [] };
    setFeeds((current) => [...current, feed]);
    setSelection({ type: "feed", id: feed.id });
    setAdding(false);
  }

  /** Move a source into another feed, and show the feed it landed in. */
  const moveSource = useCallback(
    (sourceId: string, fromFeedId: string, toFeedId: string) => {
      setFeeds((current) =>
        moveSourceBetweenFeeds(current, sourceId, fromFeedId, toFeedId),
      );
      // A feed you just dropped something into should show what it now holds.
      setCollapsed((current) => {
        if (!current.has(toFeedId)) return current;
        const next = new Set(current);
        next.delete(toFeedId);
        saveCollapsed(next);
        return next;
      });
    },
    [],
  );

  const { drag, onPointerDown, onPointerMove, onPointerUp, onPointerCancel } =
    useSourceDrag(moveSource);

  function removeFeed(id: string) {
    setFeeds((current) => current.filter((f) => f.id !== id));
    setSelection({ type: "all" });
    setConfirming(null);
  }

  function removeSource(feedId: string, sourceId: string) {
    setFeeds((current) =>
      current.map((feed) =>
        feed.id === feedId
          ? { ...feed, sources: feed.sources.filter((s) => s.id !== sourceId) }
          : feed,
      ),
    );
    setSelection({ type: "all" });
  }

  function renameFeed(id: string, name: string) {
    const trimmed = name.trim();
    setEditing(null);
    if (!trimmed) return;
    setFeeds((current) =>
      current.map((f) => (f.id === id ? { ...f, name: trimmed } : f)),
    );
  }

  function toggleCollapsed(id: string) {
    setCollapsed((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      saveCollapsed(next);
      return next;
    });
  }

  // What was already on the device from an earlier visit. Both lists matter:
  // the links the app asked for, and the URLs the articles were filed under —
  // for most sources they are the same string. Copies from an older
  // extraction go first: a mark has to mean the article is really readable.
  useEffect(() => {
    void (async () => {
      await purgeStaleVersion();
      setPersisted(await requestPersistence());
      const [links, urls] = await Promise.all([savedLinks(), cachedUrls()]);
      setSavedOffline(new Set([...links, ...urls]));
    })();
  }, []);

  const savedMeta = useCallback(
    (link: string) => saved.find((a) => a.link === link),
    [saved],
  );

  const isSaved = useCallback(
    (link: string) => saved.some((a) => a.link === link),
    [saved],
  );

  /**
   * Bookmark an article, or take it off the list. The whole record is kept:
   * an article falls out of its feed after a few weeks, and a saved one has
   * to still be there afterwards.
   */
  const toggleSaved = useCallback(
    (article: Loaded, source?: Source) => {
      setSaved((current) => {
        const next = current.some((a) => a.link === article.link)
          ? current.filter((a) => a.link !== article.link)
          : [
              {
                ...article,
                sourceTitle: source?.title,
                favicon: source?.favicon,
                savedAt: Date.now(),
              },
              ...current,
            ];
        saveSaved(next);
        return next;
      });
    },
    [],
  );

  /**
   * A file saved on its own, rather than with the story that linked it: it
   * becomes an ordinary entry in Saved, so it downloads offline and reads
   * exactly like an article.
   */
  const toggleSavedFile = useCallback(
    (file: Attachment, parent: Loaded, source?: Source) => {
      setSaved((current) => {
        const next = current.some((a) => a.link === file.url)
          ? current.filter((a) => a.link !== file.url)
          : [
              {
                id: `file:${file.url}`,
                title: file.title ?? fileTitleFor(file, parent.title),
                link: file.url,
                publishedAt: parent.publishedAt,
                summary: `From “${parent.title}”`,
                sourceId: parent.sourceId,
                sourceTitle: source?.title,
                favicon: source?.favicon,
                savedAt: Date.now(),
              },
              ...current,
            ];
        saveSaved(next);
        return next;
      });
    },
    [],
  );

  const markSaved = useCallback((url: string) => {
    setSavedOffline((current) =>
      current.has(url) ? current : new Set(current).add(url),
    );
  }, []);

  /**
   * Subscription sites only serve their text to a logged-in browser, so for
   * those the app hands off to the site instead of failing in the reader.
   */
  const opensOnSite = useCallback(
    (link: string) => settings.openOnSite.includes(hostOf(link)),
    [settings.openOnSite],
  );

  const openArticle = useCallback(
    (article: Loaded, feedUrl?: string) => {
      markRead(article.id);
      if (opensOnSite(article.link)) {
        window.open(article.link, "_blank", "noreferrer,noopener");
        return;
      }
      setReading({
        url: article.link,
        title: article.title,
        feedUrl,
        summary: article.summary,
      });
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [opensOnSite],
  );

  const alwaysOpenOnSite = useCallback(
    (link: string) => {
      const host = hostOf(link);
      updateSettings({
        ...settings,
        openOnSite: [...new Set([...settings.openOnSite, host])],
      });
      setReading(null);
      window.open(link, "_blank", "noreferrer,noopener");
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [settings],
  );

  /** Fetch and store an article ahead of the click that opens it. */
  const prefetch = useCallback((url: string, feedUrl?: string, title?: string) => {
    if (prefetched.current.has(url)) return;
    prefetched.current.add(url);
    void (async () => {
      if (await readCached(url)) {
        markSaved(url);
        return;
      }
      try {
        const res = await fetch(articleEndpoint(url, feedUrl, title), {
          headers: keyHeadersFrom(apiKeysRef.current),
        });
        if (res.ok) {
          await writeCached(await res.json());
          markSaved(url);
        }
      } catch {
        /* a warm-up failing is not worth surfacing */
      }
    })();
  }, [markSaved]);

  useEffect(() => {
    apiKeysRef.current = apiKeys;
  }, [apiKeys]);

  /**
   * Memoised: this goes into the reader's fetch dependencies, and a fresh
   * object every render would refetch the article forever.
   */
  const keyHeaders = useMemo(() => keyHeadersFrom(apiKeys), [apiKeys]);

  /** Keys changed: keep the device copy, the vault, and the feeds in step. */
  function updateKeys(next: { vault: unknown | null; keys: Record<string, string> }) {
    setVault(next.vault);
    setApiKeys(next.keys);
    saveVault(next.vault);
    saveUnlockedKeys(next.keys);
    // An API source that was failing for want of a key should now work.
    void refresh(allSources);
  }

  function updateSettings(next: Settings) {
    setSettings(next);
    saveSettings(next);
  }

  function markRead(id: string) {
    setRead((current) => {
      const next = new Set(current).add(id);
      saveRead(next);
      return next;
    });
  }

  /**
   * Saved articles are kept whole rather than looked up in the feed, so the
   * list still shows them long after they scrolled out of their source.
   */
  const savedAsArticles = useMemo<Loaded[]>(
    () =>
      saved.map((article) => ({
        ...article,
        sourceId: article.sourceId ?? "",
      })),
    [saved],
  );

  const visible = useMemo(() => {
    if (selection.type === "all") return articles;
    if (selection.type === "saved") return savedAsArticles;
    if (selection.type === "source") {
      return articles.filter((a) => a.sourceId === selection.id);
    }
    const feed = feeds.find((f) => f.id === selection.id);
    const ids = new Set(feed?.sources.map((s) => s.id));
    return articles.filter((a) => ids.has(a.sourceId));
  }, [articles, feeds, selection, savedAsArticles]);

  const sourceById = useMemo(
    () => new Map(allSources.map((s) => [s.id, s])),
    [allSources],
  );

  /** Newest N per source — what gets saved for reading offline. */
  const offlineTargets = useCallback((): OfflineTarget[] => {
    const perSource = new Map<string, OfflineTarget[]>();
    for (const article of articles) {
      const list = perSource.get(article.sourceId) ?? [];
      if (list.length < PER_SOURCE) {
        list.push({
          url: article.link,
          feedUrl: sourceById.get(article.sourceId)?.feedUrl,
          title: article.title,
        });
      }
      perSource.set(article.sourceId, list);
    }
    // A bookmarked article is the one most worth having on the device, and it
    // must not be pruned just because it aged out of its feed.
    const bookmarks: OfflineTarget[] = saved.map((article) => ({
      url: article.link,
      feedUrl: article.sourceId
        ? sourceById.get(article.sourceId)?.feedUrl
        : undefined,
      title: article.title,
    }));

    return [...bookmarks, ...[...perSource.values()].flat()];
  }, [articles, sourceById, saved]);

  const runDownload = useCallback(async () => {
    if (downloading.current) return;
    const links = offlineTargets();
    if (links.length === 0) return;

    downloading.current = true;
    setOffline({ state: "working", done: 0, total: links.length });
    try {
      const result = await downloadForOffline(
        links,
        ({ saved, ...progress }) => {
          setOffline({ state: "working", ...progress });
          // Tick each article's mark on as it lands, not all at the end.
          if (saved) markSaved(saved);
        },
        keyHeadersFrom(apiKeysRef.current),
      );
      await markSlotDownloaded(currentSlot());
      // The download prunes anything that fell out of the newest set, so the
      // marks are re-read rather than only added to.
      const [saved, keys] = await Promise.all([savedLinks(), cachedUrls()]);
      setSavedOffline(new Set([...saved, ...keys]));
      setOffline({ state: "done", at: await lastDownloadedAt(), result });
    } catch {
      setOffline({ state: "error" });
    } finally {
      downloading.current = false;
    }
  }, [offlineTargets, markSaved]);

  /**
   * Keep the device topped up.
   *
   * A web app cannot wake itself on iOS, so the twice-daily schedule is
   * honoured on the next visit. That alone was not enough: a phone suspends
   * the page the moment you switch away, so a run interrupted after five
   * articles used to leave the other thirty-five until the next 7am or 4pm.
   * Now every visit, every return to the foreground, and every reconnection
   * downloads whatever is missing — a partial cache repairs itself instead of
   * waiting for a slot. Articles already stored cost one lookup each and are
   * skipped, so topping up is cheap when there is nothing to do.
   */
  useEffect(() => {
    if (!ready || articles.length === 0) return;
    let cancelled = false;

    const check = async () => {
      setOffline((o) => (o.state === "idle" ? { ...o, at: null } : o));
      // Re-read what is stored, not only at mount: on iOS a web app resumed
      // from the background can answer an IndexedDB read made too early with
      // nothing, which would leave downloaded articles unmarked.
      const [links, keys] = await Promise.all([savedLinks(), cachedUrls()]);
      const stored = new Set([...links, ...keys]);
      if (stored.size > 0) setSavedOffline(stored);

      if (!navigator.onLine || cancelled) return;

      const missing = offlineTargets().filter((t) => !stored.has(t.url)).length;
      if (missing > 0 || (await isDownloadDue())) {
        if (!cancelled) void runDownload();
      } else if (!cancelled) {
        setOffline({ state: "done", at: await lastDownloadedAt() });
      }
    };

    void check();
    const onVisible = () => {
      if (document.visibilityState === "visible") void check();
    };
    window.addEventListener("focus", check);
    window.addEventListener("online", check);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      cancelled = true;
      window.removeEventListener("focus", check);
      window.removeEventListener("online", check);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [ready, articles.length, runDownload, offlineTargets]);

  const shown = useMemo(
    () => (settings.hideRead ? visible.filter((a) => !read.has(a.id)) : visible),
    [visible, settings.hideRead, read],
  );

  // On a phone the drawer covers the list, so any choice should close it.
  /**
   * Open a dialog and put the drawer away with it: on a phone the sidebar sits
   * above the list, so leaving it open means the dialog closes onto a drawer
   * rather than onto the articles.
   */
  function openPanel(open: (value: boolean) => void) {
    setMenuOpen(false);
    open(true);
  }

  const choose = useCallback((next: Selection) => {
    setSelection(next);
    setMenuOpen(false);
    // Picking a feed means going back to the list; staying in the article you
    // were reading made the sidebar look unresponsive.
    setReading(null);
  }, []);

  // Count the sources behind whatever is selected, not every source there is.
  const selectedSourceCount =
    selection.type === "all"
      ? allSources.length
      : selection.type === "saved"
        ? 0
        : selection.type === "source"
          ? 1
          : (feeds.find((f) => f.id === selection.id)?.sources.length ?? 0);

  const heading =
    selection.type === "all"
      ? "All articles"
      : selection.type === "saved"
        ? "Saved"
        : selection.type === "feed"
          ? (feeds.find((f) => f.id === selection.id)?.name ?? "Feed")
          : (sourceById.get(selection.id)?.title ?? "Source");

  const unread = (items: Loaded[]) =>
    items.filter((a) => !read.has(a.id)).length;

  return (
    <div className="app">
      <aside className={`sidebar ${menuOpen ? "open" : ""}`}>
        <div className="brand">
          {Icon.logo} Super Reader
        </div>

        <div className="sidebar-scroll">
          <button
            className={`nav-item ${selection.type === "all" ? "active" : ""}`}
            onClick={() => choose({ type: "all" })}
          >
            {Icon.inbox}
            <span className="feed-name">All articles</span>
            <span className="count">{unread(articles) || ""}</span>
          </button>

          <button
            className={`nav-item ${selection.type === "saved" ? "active" : ""}`}
            onClick={() => choose({ type: "saved" })}
          >
            {Icon.bookmark}
            <span className="feed-name">Saved</span>
            <span className="count">{saved.length || ""}</span>
          </button>

          {feeds.map((feed) => {
            const ids = new Set(feed.sources.map((s) => s.id));
            const count = unread(articles.filter((a) => ids.has(a.sourceId)));
            return (
              <div
                className={`feed-group${
                  drag && drag.overFeedId === feed.id && drag.fromFeedId !== feed.id
                    ? " drop-target"
                    : ""
                }`}
                key={feed.id}
                data-feed-id={feed.id}
              >
                <div className="feed-head">
                  {editing === feed.id ? (
                    <InlineName
                      initial={feed.name}
                      onSubmit={(value) => renameFeed(feed.id, value)}
                      onCancel={() => setEditing(null)}
                    />
                  ) : confirming === feed.id ? (
                    <div className="confirm-row">
                      <span>Delete “{feed.name}”?</span>
                      <button
                        className="link-btn danger"
                        onClick={() => removeFeed(feed.id)}
                      >
                        Delete
                      </button>
                      <button
                        className="link-btn"
                        onClick={() => setConfirming(null)}
                      >
                        Keep
                      </button>
                    </div>
                  ) : (
                    <>
                      <button
                        className={`chev ${collapsed.has(feed.id) ? "" : "open"}`}
                        onClick={() => toggleCollapsed(feed.id)}
                        aria-expanded={!collapsed.has(feed.id)}
                        aria-label={`${
                          collapsed.has(feed.id) ? "Expand" : "Collapse"
                        } ${feed.name}`}
                      >
                        {Icon.chevron}
                      </button>
                      <button
                        className={`nav-item ${
                          selection.type === "feed" && selection.id === feed.id
                            ? "active"
                            : ""
                        }`}
                        onClick={() => choose({ type: "feed", id: feed.id })}
                        onDoubleClick={() => setEditing(feed.id)}
                        title="Double-click to rename"
                      >
                        <span className="feed-name">{feed.name}</span>
                        <span className="count">{count || ""}</span>
                      </button>
                      <button
                        className="icon-btn"
                        onClick={() => setEditing(feed.id)}
                        aria-label={`Rename ${feed.name}`}
                      >
                        {Icon.pencil}
                      </button>
                      <button
                        className="icon-btn danger"
                        onClick={() => setConfirming(feed.id)}
                        aria-label={`Delete ${feed.name}`}
                      >
                        {Icon.trash}
                      </button>
                    </>
                  )}
                </div>

                {!collapsed.has(feed.id) && feed.sources.length === 0 && (
                  <div className="empty-hint">No sources yet</div>
                )}

                {!collapsed.has(feed.id) &&
                  feed.sources.map((source) => (
                  <div
                    className={`source-row${
                      drag?.sourceId === source.id ? " dragging" : ""
                    }`}
                    key={source.id}
                  >
                    <button
                      className="drag-grip"
                      aria-label={`Move ${source.title} to another feed`}
                      title="Drag into another feed"
                      onPointerDown={(event) =>
                        onPointerDown(event, source, feed.id)
                      }
                      onPointerMove={onPointerMove}
                      onPointerUp={onPointerUp}
                      onPointerCancel={onPointerCancel}
                      // The row is a click target; a grip drag is not a click.
                      onClick={(event) => event.preventDefault()}
                    >
                      {Icon.grip}
                    </button>
                    <button
                      className={`nav-item ${
                        selection.type === "source" && selection.id === source.id
                          ? "active"
                          : ""
                      }`}
                      onClick={() => choose({ type: "source", id: source.id })}
                    >
                      <SourceIcon src={source.favicon} title={source.title} />
                      <span className="feed-name">{source.title}</span>
                    </button>
                    <button
                      className="icon-btn danger"
                      onClick={() => removeSource(feed.id, source.id)}
                      aria-label={`Remove ${source.title}`}
                    >
                      {Icon.trash}
                    </button>
                  </div>
                ))}
              </div>
            );
          })}
        </div>

        <div className="sidebar-foot">
          {adding ? (
            <InlineName
              placeholder="Name this feed"
              onSubmit={createFeed}
              onCancel={() => setAdding(false)}
            />
          ) : (
            <button
              className="btn ghost small"
              onClick={() => setAdding(true)}
              style={{ width: "100%" }}
            >
              {Icon.plus} New feed
            </button>
          )}
          <button
            className="sync-btn"
            onClick={() => openPanel(setSettingsOpen)}
          >
            {Icon.gear}
            Settings
          </button>
          <button
            className="sync-btn"
            onClick={() => openPanel(setSyncOpen)}
            title={syncCode ? "Syncing across devices" : "Sync across devices"}
          >
            <span className={`sync-dot ${syncCode ? syncState : "off"}`} />
            {syncCode
              ? syncState === "working"
                ? "Syncing…"
                : syncState === "error"
                  ? "Sync problem"
                  : "Synced"
              : "Sync across devices"}
          </button>
        </div>
      </aside>

      {menuOpen && (
        <button
          className="scrim"
          aria-label="Close feeds"
          onClick={() => setMenuOpen(false)}
        />
      )}

      <main className="main">
        {reading ? (
          <ArticleReader
            url={reading.url}
            fallbackTitle={reading.title}
            feedUrl={reading.feedUrl}
            summary={reading.summary}
            keyHeaders={keyHeaders}
            onOpenMenu={() => setMenuOpen(true)}
            onAlwaysOpenOnSite={alwaysOpenOnSite}
            saved={isSaved(reading.url)}
            onToggleSave={() => {
              const article =
                articles.find((a) => a.link === reading.url) ??
                savedAsArticles.find((a) => a.link === reading.url);
              if (article) toggleSaved(article, sourceById.get(article.sourceId));
            }}
            onClose={() => setReading(null)}
          />
        ) : (
          <>
        <div className="main-head">
          <button
            className="menu-btn"
            onClick={() => setMenuOpen(true)}
            aria-label="Open feeds"
          >
            {Icon.menu}
          </button>
          <div>
            <h1>{heading}</h1>
            <p className="sub">
              {shown.length} article{shown.length === 1 ? "" : "s"}
              {selectedSourceCount > 0 &&
                ` · ${selectedSourceCount} source${selectedSourceCount === 1 ? "" : "s"}`}
            </p>
          </div>
          <div className="head-actions">
            <button
              className="btn ghost small"
              onClick={() => refresh(allSources)}
              disabled={refreshing || allSources.length === 0}
            >
              {refreshing ? <span className="spinner" /> : Icon.refresh}
              Refresh
            </button>
            <button className="btn small" onClick={() => openPanel(setDialogOpen)}>
              {Icon.plus} Add source
            </button>
          </div>
        </div>

        {!ready ? null : allSources.length === 0 ? (
          <div className="state">
            <h2>Start with one link.</h2>
            <p>
              Paste a website, a Substack, or an RSS URL — or just type a topic.
              You’ll see a preview of what lands in your feed before you keep it.
            </p>
            <button className="btn small" onClick={() => openPanel(setDialogOpen)}>
              {Icon.plus} Add your first source
            </button>
          </div>
        ) : shown.length === 0 ? (
          <div className="state">
            <h2>{refreshing ? "Loading articles…" : "Nothing here yet."}</h2>
            {!refreshing &&
              (selection.type === "saved" ? (
                <p>
                  Nothing saved yet. Use <strong>Save</strong> on any article
                  and it will wait here — kept on this device, and downloaded
                  for reading offline, even after it leaves its feed.
                </p>
              ) : (
                <p>This selection has no articles right now.</p>
              ))}
          </div>
        ) : (
          <div className={`articles view-${settings.view}`}>
            {shown.map((article) => {
              const source = sourceById.get(article.sourceId);
              return (
                <article
                  className={`article ${read.has(article.id) ? "read" : ""}`}
                  key={article.id}
                >
                  {/* Magazine puts the picture on the left. Articles without
                      one keep the same column so headlines stay aligned. */}
                  {settings.view === "magazine" &&
                    (article.image ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        className="hero"
                        src={article.image}
                        alt=""
                        loading="lazy"
                        referrerPolicy="no-referrer"
                        onError={(event) => {
                          const el = event.currentTarget;
                          el.classList.add("hero-failed");
                          el.removeAttribute("src");
                        }}
                      />
                    ) : (
                      <div className="hero hero-blank" aria-hidden="true">
                        {source && (
                          <SourceIcon
                            src={source.favicon}
                            title={source.title}
                            size={22}
                          />
                        )}
                      </div>
                    ))}
                  <div className="article-body">
                    <div className="article-meta">
                      {(source || savedMeta(article.link)) && (
                        <SourceIcon
                          src={source?.favicon ?? savedMeta(article.link)?.favicon ?? ""}
                          title={
                            source?.title ??
                            savedMeta(article.link)?.sourceTitle ??
                            hostOf(article.link)
                          }
                          size={15}
                        />
                      )}
                      <span>
                        {source?.title ??
                          savedMeta(article.link)?.sourceTitle ??
                          hostOf(article.link)}
                      </span>
                      {article.author && (
                        <>
                          <span className="dot">·</span>
                          <span>{article.author}</span>
                        </>
                      )}
                      {article.publishedAt && (
                        <>
                          <span className="dot">·</span>
                          <span>{timeAgo(article.publishedAt)}</span>
                        </>
                      )}
                      {savedOffline.has(article.link) && (
                        <span
                          className="saved-check"
                          title="Saved for reading offline"
                          aria-label="Saved for reading offline"
                          role="img"
                        >
                          {Icon.check}
                        </span>
                      )}
                    </div>
                    <a
                      className="article-title"
                      href={article.link}
                      // Warm the article before the click lands.
                      onMouseEnter={() =>
                        !opensOnSite(article.link) &&
                        prefetch(article.link, source?.feedUrl, article.title)
                      }
                      onTouchStart={() =>
                        !opensOnSite(article.link) &&
                        prefetch(article.link, source?.feedUrl, article.title)
                      }
                      onClick={(event) => {
                        // Plain click reads in-app; modified clicks still open
                        // the original in a new tab.
                        if (
                          event.metaKey ||
                          event.ctrlKey ||
                          event.shiftKey ||
                          event.button !== 0
                        ) {
                          return;
                        }
                        event.preventDefault();
                        openArticle(article, source?.feedUrl);
                      }}
                    >
                      {article.title}
                    </a>
                    {article.summary && settings.view !== "list" && (
                      <p className="article-summary">{article.summary}</p>
                    )}
                    {article.attachments && article.attachments.length > 0 && (
                      <Attachments
                        attachments={article.attachments}
                        onOpen={(file) =>
                          setReading({
                            url: file.url,
                            title: file.title ?? article.title,
                            feedUrl: source?.feedUrl,
                          })
                        }
                        isSaved={isSaved}
                        keyHeaders={keyHeaders}
                        onToggleSave={(file) => toggleSavedFile(file, article, source)}
                      />
                    )}
                    <div className="article-actions">
                      <button
                        className="read-btn"
                        onClick={() => openArticle(article, source?.feedUrl)}
                      >
                        {Icon.book} Read here
                      </button>
                      {article.comments && article.comments !== article.link && (
                        // Following a subreddit for the links but losing the
                        // thread would miss the point of it. On a self post the
                        // thread is the article, so there is nothing to add.
                        <button
                          className="read-btn"
                          // In the reader, not the browser: a Reddit thread is
                          // rendered here now, post and replies together.
                          onClick={() =>
                            setReading({
                              url: article.comments!,
                              title: article.title,
                              feedUrl: source?.feedUrl,
                              summary: article.summary,
                            })
                          }
                        >
                          {Icon.chat} Discussion
                        </button>
                      )}
                      <button
                        className={`read-btn save-btn${
                          isSaved(article.link) ? " on" : ""
                        }`}
                        aria-pressed={isSaved(article.link)}
                        title={
                          isSaved(article.link)
                            ? "Remove from Saved"
                            : "Save for later"
                        }
                        onClick={() => toggleSaved(article, source)}
                      >
                        {isSaved(article.link) ? Icon.bookmarkOn : Icon.bookmark}
                        {isSaved(article.link) ? "Saved" : "Save"}
                      </button>
                    </div>
                  </div>
                  {article.image && settings.view === "cards" && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      className="thumb"
                      src={article.image}
                      alt=""
                      loading="lazy"
                      referrerPolicy="no-referrer"
                      // Drop the slot entirely if the image 404s.
                      onError={(event) => {
                        event.currentTarget.style.display = "none";
                      }}
                    />
                  )}
                </article>
              );
            })}
          </div>
        )}
          </>
        )}
      </main>

      {drag && (
        <div
          className="drag-ghost"
          style={{ left: drag.x + 14, top: drag.y - 14 }}
          aria-hidden="true"
        >
          <SourceIcon src={drag.favicon ?? ""} title={drag.title} size={15} />
          <span>{drag.title}</span>
        </div>
      )}

      <DownloadBar state={offline.state} done={offline.done} total={offline.total} />

      {settingsOpen && (
        <SettingsDialog
          settings={settings}
          onChange={updateSettings}
          onClose={() => setSettingsOpen(false)}
          offline={offline}
          storedCount={savedOffline.size}
          targetCount={offlineTargets().length}
          persisted={persisted}
          vault={vault}
          apiKeys={apiKeys}
          onKeysChange={updateKeys}
          onDownload={runDownload}
        />
      )}

      {syncOpen && (
        <SyncDialog
          code={syncCode}
          busy={syncState === "working"}
          onCreate={startSync}
          onConnect={connectSync}
          onDisconnect={stopSync}
          onClose={() => setSyncOpen(false)}
        />
      )}

      {dialogOpen && (
        <AddSourceDialog
          feeds={feeds}
          keyHeaders={keyHeaders}
          defaultFeedId={
            selection.type === "feed" ? selection.id : feeds[0]?.id
          }
          onCancel={() => setDialogOpen(false)}
          onAdd={addSource}
        />
      )}
    </div>
  );
}
