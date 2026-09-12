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
  loadSavedRemovals,
  saveSavedRemovals,
  loadTeams,
  saveTeams,
  sanitizeTeams,
  loadVault,
  saveVault,
  loadUpdatedAt,
  saveUpdatedAt,
  loadUnlockedKeys,
  saveUnlockedKeys,
  type SavedArticle,
  type TeamFeed,
  type Feed,
  type Source,
} from "@/lib/store";
import type { TeamArticle } from "@/lib/team";
import {
  loadNotes,
  saveNotes,
  addEntry,
  removeEntry,
  editComment,
  renameNote,
  releasableSaves,
  type Note,
} from "@/lib/notes";
import NotePage from "./NotePage";
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
import { sortNewestFirst, timeOf } from "@/lib/sort";
import type { RankedArticle } from "@/lib/pulse";
import type { PickedSource } from "./OutletCatalog";
import ScoreExplainer from "./ScoreExplainer";
import type { CorpusStats } from "./ScoreExplainer";
import { canonicalUrl } from "@/lib/url";
import { mergeSaved, differsFrom, slimForSync } from "@/lib/saved";
import type { SavedRemoval } from "@/lib/saved";
import "./reader.css";

type Loaded = Article & { sourceId: string };

/**
 * The reader's own API keys travel in a header rather than the URL, so a key
 * never reaches a log line or a referrer. The server uses them for that one
 * request and keeps nothing.
 */
/** "Final rule (PDF)" reads better in a list than "rule-2026-04.pdf". */
/** What each band is called where the number alone is not enough. */
const BAND_LABELS: Record<"major" | "big" | "notable" | "quiet", string> = {
  major: "Major story",
  big: "Big story",
  notable: "Notable",
  quiet: "No wider coverage found",
};

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
  /** A shared list: its id is the team's connect code. */
  | { type: "team"; id: string }
  | { type: "note"; id: string }
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
    /** A passage to go to on arrival, when a note's quote sent us here. */
    quote?: string;
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
  /** Importance by article id, from the shared story corpus. */
  const [ranking, setRanking] = useState<Map<string, RankedArticle>>(new Map());
  /**
   * What the ranking is built on — or why there isn't one. Three states worth
   * telling apart: no database on this deployment, a corpus still filling,
   * and a corpus of N stories from M feeds.
   */
  const [rankState, setRankState] = useState<"unavailable" | "warming" | string | null>(null);
  /** What the ranking was measured against, shown on the score page. */
  const [corpusStats, setCorpusStats] = useState<CorpusStats | null>(null);
  /** The article whose score is being explained, if any. */
  const [explaining, setExplaining] = useState<string | null>(null);
  /** The scrolling column: pull-to-refresh and jump-to-top both need it. */
  const listRef = useRef<HTMLElement | null>(null);
  /** How far the list has been dragged past its top, in pixels. */
  const [pullDistance, setPullDistance] = useState(0);
  /** Whether the refresh in flight was started by pulling the list. */
  const [pullRefresh, setPullRefresh] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [saved, setSaved] = useState<SavedArticle[]>([]);
  /** Un-saves, dated, so they survive syncing with a device that still has it. */
  const [savedRemovals, setSavedRemovals] = useState<SavedRemoval[]>([]);
  /** Notes, and the quotes pulled into them. Per device, like Settings. */
  const [notes, setNotes] = useState<Note[]>([]);
  const [addingNote, setAddingNote] = useState(false);
  const [editingNote, setEditingNote] = useState<string | null>(null);
  const [confirmingNote, setConfirmingNote] = useState<string | null>(null);
  /** The team feeds this device has joined. */
  const [teams, setTeams] = useState<TeamFeed[]>([]);
  /**
   * What is on each team feed, by connect code. Not kept in local storage:
   * several people write to a team feed, so the server's copy is the only one
   * that can be trusted to be current.
   */
  const [teamArticles, setTeamArticles] = useState<Record<string, TeamArticle[]>>({});
  const [teamsBusy, setTeamsBusy] = useState(false);
  /** The article whose "Save to Team" menu is open, when there are several. */
  const [teamMenu, setTeamMenu] = useState<string | null>(null);
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
  /** The bookmark list as it stands, for merging inside applyRemote. */
  const savedRef = useRef<SavedArticle[]>([]);
  const removalsRef = useRef<SavedRemoval[]>([]);
  /** The notes as they stand, for writes that land in the same click. */
  const notesRef = useRef<Note[]>([]);

  useEffect(() => {
    setFeeds(loadFeeds());
    setRead(loadRead());
    setSyncCode(loadSyncCode());
    setSettings(loadSettings());
    setCollapsed(loadCollapsed());
    setSaved(loadSaved());
    setSavedRemovals(loadSavedRemovals());
    setTeams(loadTeams());
    const storedNotes = loadNotes();
    notesRef.current = storedNotes;
    setNotes(storedNotes);
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

  const applyRemote = useCallback((payload: {
    feeds?: Feed[];
    read?: string[];
    saved?: SavedArticle[];
    savedRemovals?: SavedRemoval[];
    teams?: unknown;
    vault?: unknown;
    updatedAt?: number;
  }) => {
    applying.current = true;
    if (Array.isArray(payload.feeds)) setFeeds(payload.feeds);
    // Which team feeds this person is on travels between their own devices;
    // what is *in* those feeds does not, and never touches local storage.
    if (Array.isArray(payload.teams)) {
      const next = sanitizeTeams(payload.teams);
      setTeams(next);
      saveTeams(next);
    }
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
    /*
     * Bookmarks are merged, not taken. Everything else in this document
     * resolves by "most recent change wins", which for a bookmark list would
     * mean the phone saving something on the train deleting what the desktop
     * saved that morning. The merge keeps both sides, and a dated un-save
     * still removes an article the other device is holding.
     */
    const bookmarks = mergeSaved(
      { saved: savedRef.current, removals: removalsRef.current },
      { saved: payload.saved ?? [], removals: payload.savedRemovals ?? [] },
    );
    setSaved(bookmarks.saved);
    saveSaved(bookmarks.saved);
    setSavedRemovals(bookmarks.removals);
    saveSavedRemovals(bookmarks.removals);
    // If the merge kept something the other side had not seen, this device
    // still has news — so it must not mark itself up to date.
    const owes = differsFrom(bookmarks, {
      saved: payload.saved ?? [],
      removals: payload.savedRemovals ?? [],
    });

    if (typeof payload.updatedAt === "number" && payload.updatedAt > 0) {
      updatedAtRef.current = payload.updatedAt;
      setUpdatedAt(payload.updatedAt);
      saveUpdatedAt(payload.updatedAt);
      // Only call this device up to date when it has nothing left to send.
      pushedAt.current = owes ? 0 : payload.updatedAt;
    }
    if (owes) {
      // Stamp the union as a change of this device's own, so the push effect
      // sends it rather than sitting on bookmarks the other device lacks.
      const now = Math.max(Date.now(), updatedAtRef.current + 1);
      updatedAtRef.current = now;
      setUpdatedAt(now);
      saveUpdatedAt(now);
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

  useEffect(() => {
    savedRef.current = saved;
    removalsRef.current = savedRemovals;
  }, [saved, savedRemovals]);

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
  }, [feeds, read, saved, savedRemovals, vault, teams, ready]);

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
            // Trimmed: a few hundred full records would push the document
            // past the size the route accepts, and then nothing syncs.
            saved: slimForSync(saved),
            savedRemovals,
            teams,
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
  }, [feeds, read, saved, savedRemovals, teams, ready, syncCode, vault, updatedAt, applyRemote]);

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
    // record we just created. Bookmarks go with it: turning sync on should
    // carry the list that is already here, not wait for the next change to
    // it. (Named `upload`, not `saved` — that name is the bookmark list.)
    const upload = await fetch("/api/sync", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        code: data.code,
        feeds,
        read: [...read],
        saved: slimForSync(saved),
        savedRemovals,
        teams,
        vault,
        updatedAt: Math.max(Date.now(), updatedAtRef.current + 1),
      }),
    });
    if (!upload.ok) {
      setSyncState("error");
      throw new Error("Could not upload this device's feeds");
    }

    saveSyncCode(data.code);
    setSyncCode(data.code);
    setSyncState("saved");
  }, [feeds, read, saved, savedRemovals, teams, vault]);

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

  /* ---------- team feeds ---------- */

  /**
   * Pull one team feed. Whoever else is on it may have added something since,
   * so the server's copy always wins here — there is no local copy to merge.
   */
  const refreshTeam = useCallback(async (code: string) => {
    const res = await fetch(`/api/team?code=${encodeURIComponent(code)}`);
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error(data.error ?? "Could not reach that team feed");
    }
    const data = (await res.json()) as { name: string; articles: TeamArticle[] };
    setTeamArticles((current) => ({ ...current, [code]: data.articles ?? [] }));
    // The name is the team's, not this device's: a rename elsewhere lands here.
    setTeams((current) => {
      if (!current.some((team) => team.code === code && team.name !== data.name)) {
        return current;
      }
      const next = current.map((team) =>
        team.code === code ? { ...team, name: data.name } : team,
      );
      saveTeams(next);
      return next;
    });
    return data;
  }, []);

  // Load every joined feed on open, and again on focus — the same moment sync
  // pulls, and the moment someone comes back to see what the team shared.
  useEffect(() => {
    if (!ready || teams.length === 0) return;
    const load = () => {
      for (const team of teams) {
        refreshTeam(team.code).catch(() => {
          /* offline or unreachable: keep showing what was last loaded */
        });
      }
    };
    load();
    window.addEventListener("focus", load);
    return () => window.removeEventListener("focus", load);
  }, [ready, teams, refreshTeam]);

  const createTeam = useCallback(async (name: string) => {
    setTeamsBusy(true);
    try {
      const res = await fetch("/api/team", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Could not create a team feed");
      setTeams((current) => {
        const next = [...current, { code: data.code as string, name: data.name as string }];
        saveTeams(next);
        return next;
      });
      setTeamArticles((current) => ({ ...current, [data.code]: [] }));
    } finally {
      setTeamsBusy(false);
    }
  }, []);

  const joinTeam = useCallback(
    async (entered: string) => {
      const code = entered.trim();
      setTeamsBusy(true);
      try {
        // Fetch first: joining a code that does not resolve should say so
        // rather than adding an entry that never loads.
        const data = await refreshTeam(code);
        setTeams((current) => {
          if (current.some((team) => team.code === code)) return current;
          const next = [...current, { code, name: data.name }];
          saveTeams(next);
          return next;
        });
      } finally {
        setTeamsBusy(false);
      }
    },
    [refreshTeam],
  );

  /**
   * Leave on this device only. The shared list itself stays where it is —
   * other people are still on it, and the code still works.
   */
  const leaveTeam = useCallback((code: string) => {
    setTeams((current) => {
      const next = current.filter((team) => team.code !== code);
      saveTeams(next);
      return next;
    });
    setTeamArticles((current) => {
      const next = { ...current };
      delete next[code];
      return next;
    });
    setSelection((current) =>
      current.type === "team" && current.id === code ? { type: "all" } : current,
    );
  }, []);

  // A picker left open over a list that has moved on is just in the way.
  useEffect(() => {
    if (!teamMenu) return;
    const close = (event: MouseEvent) => {
      if (!(event.target as HTMLElement | null)?.closest(".team-share")) {
        setTeamMenu(null);
      }
    };
    window.addEventListener("mousedown", close);
    return () => window.removeEventListener("mousedown", close);
  }, [teamMenu]);

  /** Which of the joined feeds already carry this article. */
  const teamsWith = useCallback(
    (link: string) =>
      teams.filter((team) =>
        (teamArticles[team.code] ?? []).some((a) => a.link === link),
      ),
    [teams, teamArticles],
  );

  /**
   * Share one article, or take it back off. Only the article is sent: the
   * request carries no feeds, no read state and nothing saying who sent it.
   */
  const toggleTeam = useCallback(
    async (code: string, article: Loaded, source?: Source) => {
      const shared = (teamArticles[code] ?? []).some((a) => a.link === article.link);
      setTeamsBusy(true);
      try {
        const res = shared
          ? await fetch(
              `/api/team?code=${encodeURIComponent(code)}&link=${encodeURIComponent(article.link)}`,
              { method: "DELETE" },
            )
          : await fetch("/api/team", {
              method: "PUT",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({
                code,
                article: {
                  id: article.id,
                  title: article.title,
                  link: article.link,
                  author: article.author,
                  publishedAt: article.publishedAt,
                  summary: article.summary,
                  image: article.image,
                  sourceTitle: source?.title,
                  favicon: source?.favicon,
                },
              }),
            });
        if (!res.ok) return;
        const data = (await res.json()) as { articles: TeamArticle[] };
        setTeamArticles((current) => ({ ...current, [code]: data.articles ?? [] }));
      } catch {
        /* offline: the list stays as it was, and a later save can retry */
      } finally {
        setTeamsBusy(false);
        setTeamMenu(null);
      }
    },
    [teamArticles],
  );

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
      // One article, once. Two of a paper's feeds carry the same story with
      // different tracking parameters, which is how the list ended up showing
      // the same WSJ piece twice in a row.
      const seen = new Set<string>();
      const unique = merged.filter((article) => {
        const key = canonicalUrl(article.link);
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });
      const ordered = sortNewestFirst(unique);
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

  /**
   * Add several directory sources at once. Nothing is previewed first: these
   * are feeds the app ships the URLs for, and the refresh that follows is
   * what fills them in — previewing twenty feeds one by one would take longer
   * than just fetching them.
   */
  function addSources(picked: PickedSource[], target: string) {
    if (picked.length === 0) return;
    const made: Source[] = picked.map((source) => ({
      id: newId(),
      kind: "feed",
      feedUrl: source.feedUrl,
      siteUrl: source.siteUrl,
      title: source.title,
      favicon: source.favicon,
    }));

    setFeeds((current) => {
      const exists = current.some((feed) => feed.id === target);
      if (!exists) {
        const feed: Feed = { id: newId(), name: "Outlets", sources: made };
        setSelection({ type: "feed", id: feed.id });
        return [...current, feed];
      }
      return current.map((feed) => {
        if (feed.id !== target) return feed;
        const have = new Set(feed.sources.map((source) => source.feedUrl));
        return {
          ...feed,
          sources: [...feed.sources, ...made.filter((source) => !have.has(source.feedUrl))],
        };
      });
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
   * Note an un-save, dated. Without this the other device — which still has
   * the article — simply puts it back at the next sync.
   */
  const noteRemoval = useCallback((link: string) => {
    setSavedRemovals((current) => {
      const next = [
        { link, at: Date.now() },
        ...current.filter((removal) => removal.link !== link),
      ];
      saveSavedRemovals(next);
      return next;
    });
  }, []);

  /**
   * Bookmark an article, or take it off the list. The whole record is kept:
   * an article falls out of its feed after a few weeks, and a saved one has
   * to still be there afterwards.
   */
  const toggleSaved = useCallback(
    (article: Loaded, source?: Source) => {
      if (saved.some((a) => a.link === article.link)) noteRemoval(article.link);
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
    [saved, noteRemoval],
  );

  /**
   * A file saved on its own, rather than with the story that linked it: it
   * becomes an ordinary entry in Saved, so it downloads offline and reads
   * exactly like an article.
   */
  const toggleSavedFile = useCallback(
    (file: Attachment, parent: Loaded, source?: Source) => {
      if (saved.some((a) => a.link === file.url)) noteRemoval(file.url);
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
    [saved, noteRemoval],
  );

  /**
   * Write the notes through, and let go of any article that was only saved
   * because a quote needed it. An article the reader saved themselves is
   * never released — quoting something must not be able to lose a bookmark.
   */
  const commitNotes = useCallback(
    (update: (current: Note[]) => Note[]) => {
      // Functional, and through a ref, because two of these can land in one
      // click: quoting into a note that the same click created. Reading the
      // rendered `notes` for the second write would undo the first.
      const next = update(notesRef.current);
      notesRef.current = next;
      setNotes(next);
      saveNotes(next);

      const releasable = releasableSaves(savedRef.current, next);
      if (releasable.length === 0) return;
      const drop = new Set(releasable);
      for (const link of releasable) noteRemoval(link);
      setSaved((current) => {
        const kept = current.filter((article) => !drop.has(article.link));
        saveSaved(kept);
        return kept;
      });
    },
    [noteRemoval],
  );

  const createNote = useCallback(
    (name: string) => {
      const note: Note = {
        id: newId(),
        name: name.trim().slice(0, 60) || "Note",
        entries: [],
        at: Date.now(),
      };
      commitNotes((current) => [...current, note]);
      return note.id;
    },
    [commitNotes],
  );

  /**
   * A highlighted passage becomes a quote, and the article behind it becomes
   * a bookmark if it was not one already — a quote whose article has scrolled
   * out of its feed and off the device is a quote with nothing behind it.
   * That automatic save is marked, so it can be released when the quote goes.
   */
  const quoteIntoNote = useCallback(
    (noteId: string, text: string) => {
      const link = reading?.url;
      if (!link || !text) return;

      const known =
        articles.find((a) => a.link === link) ??
        savedRef.current.find((a) => a.link === link);
      const source = known?.sourceId
        ? allSources.find((entry) => entry.id === known.sourceId)
        : undefined;
      const title = known?.title ?? reading?.title ?? link;

      commitNotes((current) =>
        addEntry(current, noteId, {
          id: newId(),
          kind: "quote",
          text,
          link,
          articleTitle: title,
          sourceTitle: source?.title ?? (known as SavedArticle | undefined)?.sourceTitle,
          at: Date.now(),
        }),
      );

      if (savedRef.current.some((a) => a.link === link)) return;
      setSaved((current) => {
        const next: SavedArticle[] = [
          {
            id: known?.id ?? `note:${link}`,
            title,
            link,
            publishedAt: known?.publishedAt,
            summary: known?.summary ?? reading?.summary,
            image: known?.image,
            sourceId: known?.sourceId,
            sourceTitle: source?.title ?? (known as SavedArticle | undefined)?.sourceTitle,
            favicon: source?.favicon,
            savedAt: Date.now(),
            viaNote: true,
          },
          ...current,
        ];
        saveSaved(next);
        return next;
      });
    },
    [reading, articles, allSources, commitNotes],
  );

  const removeNote = useCallback(
    (id: string) => {
      commitNotes((current) => current.filter((note) => note.id !== id));
      setConfirmingNote(null);
      setSelection((current) =>
        current.type === "note" && current.id === id ? { type: "all" } : current,
      );
    },
    [commitNotes],
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

  /** A team feed's articles, in the same shape the list renders. */
  const teamAsArticles = useCallback(
    (code: string): Loaded[] =>
      (teamArticles[code] ?? []).map((article) => ({ ...article, sourceId: "" })),
    [teamArticles],
  );

  const visible = useMemo(() => {
    if (selection.type === "all") return articles;
    if (selection.type === "saved") return savedAsArticles;
    if (selection.type === "team") return teamAsArticles(selection.id);
    if (selection.type === "source") {
      return articles.filter((a) => a.sourceId === selection.id);
    }
    const feed = feeds.find((f) => f.id === selection.id);
    const ids = new Set(feed?.sources.map((s) => s.id));
    return articles.filter((a) => ids.has(a.sourceId));
  }, [articles, feeds, selection, savedAsArticles, teamAsArticles]);

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

  /**
   * Ask the server how big each story is.
   *
   * The articles have to be sent because the feeds live on this device, and
   * only the link and the headline go — the ranking is a fact about the
   * press, not about the reader. Runs whenever the list changes; the answer
   * is cached server-side, so this is one small request per refresh.
   */
  useEffect(() => {
    if (!ready || articles.length === 0) return;
    const payload = articles.slice(0, 600).map((article) => ({
      id: article.id,
      link: article.link,
      title: article.title,
    }));
    let live = true;
    const timer = window.setTimeout(() => {
      fetch("/api/rank", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ articles: payload }),
      })
        .then((res) => res.json())
        .then(
          (data: {
            available?: boolean;
            warming?: boolean;
            ranked?: RankedArticle[];
            outletCount?: number;
            storyCount?: number;
            windowHours?: number;
          }) => {
            if (!live) return;
            if (!data.available) {
              // Ranking needs the shared corpus; without it the app works as
              // before and the sub-line says so rather than implying the
              // stories were weighed and found wanting.
              setRanking(new Map());
              setRankState("unavailable");
              return;
            }
            setRanking(new Map((data.ranked ?? []).map((entry) => [entry.id, entry])));
            setCorpusStats({
              storyCount: data.storyCount ?? 0,
              outletCount: data.outletCount ?? 0,
              windowHours: data.windowHours,
            });
            setRankState(
              data.warming
                ? "warming"
                : `${(data.storyCount ?? 0).toLocaleString()} stories from ${data.outletCount} feeds`,
            );
          },
        )
        .catch(() => {
          /* offline: the list is simply unranked */
        });
    }, 400);
    return () => {
      live = false;
      window.clearTimeout(timer);
    };
  }, [articles, ready]);

  const shown = useMemo(() => {
    const list = settings.hideRead ? visible.filter((a) => !read.has(a.id)) : visible;
    if (settings.sort !== "top") return list;
    // Ranked first, by score; everything else keeps its date order below,
    // which is what an unranked story deserves — not a guess at a score.
    return [...list].sort((a, b) => {
      const scoreA = ranking.get(a.id)?.score ?? -1;
      const scoreB = ranking.get(b.id)?.score ?? -1;
      return scoreB - scoreA || timeOf(b) - timeOf(a);
    });
  }, [visible, settings.hideRead, settings.sort, read, ranking]);

  /** The article whose score page is open, with its ranking. */
  const explainRank = useMemo(() => {
    if (!explaining) return null;
    const rank = ranking.get(explaining);
    const article = articles.find((entry) => entry.id === explaining);
    return rank && article ? { rank, title: article.title } : null;
  }, [explaining, ranking, articles]);

  /** How many of the shown articles the corpus had something to say about. */
  const rankedCount = useMemo(
    () => shown.filter((article) => ranking.has(article.id)).length,
    [shown, ranking],
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

  /** Back to the first headline. */
  const scrollToTop = useCallback(() => {
    listRef.current?.scrollTo({ top: 0, behavior: "auto" });
  }, []);

  const choose = useCallback(
    (next: Selection) => {
      setSelection(next);
      setMenuOpen(false);
      setTeamMenu(null);
      // Picking a feed means going back to the list; staying in the article you
      // were reading made the sidebar look unresponsive.
      setReading(null);
      setExplaining(null);
      // A new feed starts at its own top, not at whatever scroll position the
      // last one was left at — which on a long list meant landing in the
      // middle of a feed you had just opened.
      scrollToTop();
    },
    [scrollToTop],
  );

  /**
   * Pull the list past its top to refresh.
   *
   * There is no Refresh button any more, so this is the gesture that replaces
   * it. It only engages when the list is already scrolled to the very top and
   * the drag is downward, so it can never fight an ordinary scroll; and the
   * indicator only promises a refresh once the pull is past the threshold,
   * rather than firing on any stray touch.
   */
  const PULL_TRIGGER = 72;
  const pullFrom = useRef<number | null>(null);

  const onListTouchStart = useCallback((event: React.TouchEvent<HTMLElement>) => {
    const list = listRef.current;
    if (!list || list.scrollTop > 0 || refreshing) {
      pullFrom.current = null;
      return;
    }
    pullFrom.current = event.touches[0].clientY;
  }, [refreshing]);

  const onListTouchMove = useCallback(
    (event: React.TouchEvent<HTMLElement>) => {
      if (pullFrom.current === null) return;
      const travelled = event.touches[0].clientY - pullFrom.current;
      // An upward drag is a scroll, not a pull: let go of the gesture.
      if (travelled <= 0) {
        pullFrom.current = null;
        setPullDistance(0);
        return;
      }
      // Rubber-band it, so the list follows the finger without racing it.
      setPullDistance(Math.min(travelled * 0.45, PULL_TRIGGER * 1.6));
    },
    [],
  );

  const onListTouchEnd = useCallback(() => {
    const travelled = pullDistance;
    pullFrom.current = null;
    setPullDistance(0);
    if (travelled >= PULL_TRIGGER && !refreshing) {
      setPullRefresh(true);
      void refresh(allSources);
    }
  }, [pullDistance, refreshing, refresh, allSources]);

  // The note above the list belongs to the pull. A refresh started from the
  // desktop button reports itself in the button instead.
  useEffect(() => {
    if (!refreshing) setPullRefresh(false);
  }, [refreshing]);

  // Count the sources behind whatever is selected, not every source there is.
  const selectedSourceCount =
    selection.type === "all"
      ? allSources.length
      : selection.type === "saved" || selection.type === "team"
        ? 0
        : selection.type === "source"
          ? 1
          : (feeds.find((f) => f.id === selection.id)?.sources.length ?? 0);

  const heading =
    selection.type === "all"
      ? "All articles"
      : selection.type === "saved"
        ? "Saved"
        : selection.type === "team"
          ? (teams.find((team) => team.code === selection.id)?.name ?? "Team")
          : selection.type === "feed"
          ? (feeds.find((f) => f.id === selection.id)?.name ?? "Feed")
          : (sourceById.get(selection.id)?.title ?? "Source");

  /** The note being read, if the sidebar is on one. */
  const openNote =
    selection.type === "note"
      ? (notes.find((note) => note.id === selection.id) ?? null)
      : null;

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

          {/* Team feeds sit right beside Saved: the same kind of list, shared
              with other people rather than kept on this device. */}
          {teams.map((team) => (
            <button
              key={team.code}
              className={`nav-item ${
                selection.type === "team" && selection.id === team.code ? "active" : ""
              }`}
              onClick={() => choose({ type: "team", id: team.code })}
            >
              {Icon.people}
              <span className="feed-name">{team.name}</span>
              <span className="count">
                {(teamArticles[team.code] ?? []).length || ""}
              </span>
            </button>
          ))}

          {/* Notes sit with Saved and the team feeds: places things are kept,
              above the feeds things arrive in. */}
          {(notes.length > 0 || addingNote) && (
            <div className="notes-nav">
              {notes.map((note) => (
                <div className="note-row" key={note.id}>
                  {editingNote === note.id ? (
                    <InlineName
                      initial={note.name}
                      onSubmit={(value) => {
                        commitNotes((current) => renameNote(current, note.id, value));
                        setEditingNote(null);
                      }}
                      onCancel={() => setEditingNote(null)}
                    />
                  ) : confirmingNote === note.id ? (
                    <div className="confirm-row">
                      <span>Delete “{note.name}”?</span>
                      <button
                        className="link-btn danger"
                        onClick={() => removeNote(note.id)}
                      >
                        Delete
                      </button>
                      <button
                        className="link-btn"
                        onClick={() => setConfirmingNote(null)}
                      >
                        Keep
                      </button>
                    </div>
                  ) : (
                    <>
                      <button
                        className={`nav-item ${
                          selection.type === "note" && selection.id === note.id
                            ? "active"
                            : ""
                        }`}
                        onClick={() => choose({ type: "note", id: note.id })}
                        onDoubleClick={() => setEditingNote(note.id)}
                        title="Double-click to rename"
                      >
                        {Icon.note}
                        <span className="feed-name">{note.name}</span>
                        <span className="count">{note.entries.length || ""}</span>
                      </button>
                      <button
                        className="icon-btn"
                        onClick={() => setEditingNote(note.id)}
                        aria-label={`Rename ${note.name}`}
                      >
                        {Icon.pencil}
                      </button>
                      <button
                        className="icon-btn danger"
                        onClick={() => setConfirmingNote(note.id)}
                        aria-label={`Delete ${note.name}`}
                      >
                        {Icon.trash}
                      </button>
                    </>
                  )}
                </div>
              ))}
              {addingNote && (
                <InlineName
                  placeholder="Name this note"
                  onSubmit={(value) => {
                    const name = value.trim();
                    setAddingNote(false);
                    if (name) choose({ type: "note", id: createNote(name) });
                  }}
                  onCancel={() => setAddingNote(false)}
                />
              )}
            </div>
          )}

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
            <div className="foot-row">
              <button
                className="btn ghost small"
                onClick={() => setAdding(true)}
              >
                {Icon.plus} New feed
              </button>
              {settings.quoteToNote && (
                <button
                  className="btn ghost small"
                  onClick={() => {
                    setAddingNote(true);
                    setMenuOpen(true);
                  }}
                >
                  {Icon.plus} New note
                </button>
              )}
            </div>
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

      <main
        className="main"
        ref={listRef}
        onTouchStart={onListTouchStart}
        onTouchMove={onListTouchMove}
        onTouchEnd={onListTouchEnd}
        onTouchCancel={onListTouchEnd}
      >
        {explainRank ? (
          <ScoreExplainer
            rank={explainRank.rank}
            title={explainRank.title}
            corpus={corpusStats}
            onClose={() => setExplaining(null)}
            onOpenMenu={() => setMenuOpen(true)}
          />
        ) : reading ? (
          <ArticleReader
            url={reading.url}
            fallbackTitle={reading.title}
            feedUrl={reading.feedUrl}
            summary={reading.summary}
            keyHeaders={keyHeaders}
            onOpenMenu={() => setMenuOpen(true)}
            onAlwaysOpenOnSite={alwaysOpenOnSite}
            notes={notes}
            highlight={reading.quote}
            onQuote={settings.quoteToNote ? quoteIntoNote : undefined}
            onCreateNote={settings.quoteToNote ? createNote : undefined}
            saved={isSaved(reading.url)}
            onToggleSave={() => {
              const article =
                articles.find((a) => a.link === reading.url) ??
                savedAsArticles.find((a) => a.link === reading.url);
              if (article) toggleSaved(article, sourceById.get(article.sourceId));
            }}
            onClose={() => setReading(null)}
          />
        ) : openNote ? (
          <NotePage
            note={openNote}
            onOpenMenu={() => setMenuOpen(true)}
            onOpenArticle={(link, title, quote) =>
              setReading({ url: link, title, quote })
            }
            onAddComment={(text) =>
              commitNotes((current) =>
                addEntry(current, openNote.id, {
                  id: newId(),
                  kind: "text",
                  text,
                  at: Date.now(),
                }),
              )
            }
            onEditComment={(entryId, text) =>
              commitNotes((current) => editComment(current, openNote.id, entryId, text))
            }
            onRemoveEntry={(entryId) =>
              commitNotes((current) => removeEntry(current, openNote.id, entryId))
            }
          />
        ) : (
          <>
        {/* The pull-to-refresh indicator. It says what will happen, and only
            promises a refresh once the pull is far enough to cause one. */}
        {(pullDistance > 0 || (refreshing && pullRefresh)) && (
          <div
            className="pull-note"
            style={{ height: refreshing ? 34 : Math.round(pullDistance) }}
            aria-live="polite"
          >
            {refreshing ? (
              <>
                <span className="spinner" /> Refreshing…
              </>
            ) : pullDistance >= 72 ? (
              "Release to refresh"
            ) : (
              "Pull to refresh"
            )}
          </div>
        )}

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
              {settings.sort === "top" &&
                (rankState === "unavailable"
                  ? " · ranking needs a database on this deployment"
                  : rankState === "warming"
                    ? " · still reading the outlet panel — ranking fills in shortly"
                    : rankState
                      ? ` · ${rankedCount} ranked against ${rankState}`
                      : "")}
            </p>
          </div>
          <div className="head-actions">
            <div
              className="scope-switch sort-switch"
              role="group"
              aria-label="Order articles by"
            >
              <button
                className={settings.sort === "new" ? "on" : ""}
                onClick={() => updateSettings({ ...settings, sort: "new" })}
                title="Newest first"
              >
                Newest
              </button>
              <button
                className={settings.sort === "top" ? "on" : ""}
                onClick={() => updateSettings({ ...settings, sort: "top" })}
                title={
                  rankState && rankState !== "unavailable" && rankState !== "warming"
                    ? `Biggest stories first — measured against ${rankState}`
                    : "Biggest stories first"
                }
              >
                Top stories
              </button>
            </div>
            {/* Desktop keeps a button: there is no pull gesture with a mouse.
                Hidden on a phone, where the pull is the gesture and a button
                would only crowd the row. */}
            <button
              className="btn ghost small refresh-btn"
              onClick={() => refresh(allSources)}
              disabled={refreshing || allSources.length === 0}
            >
              {refreshing ? <span className="spinner" /> : Icon.refresh}
              Refresh
            </button>
            <button
              className="btn small add-btn"
              onClick={() => openPanel(setDialogOpen)}
              aria-label="Add a source"
              title="Add a source"
            >
              {Icon.plus}
            </button>
          </div>
        </div>

        {/* A team feed is readable on its own: someone can join one with a
            connect code before they follow a single source of their own, and
            "start with one link" over a list of shared stories is wrong. */}
        {!ready ? null : allSources.length === 0 &&
          shown.length === 0 &&
          selection.type !== "team" ? (
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
              (selection.type === "team" ? (
                <p>
                  Nothing shared yet. Use <strong>Save to Team</strong> on any
                  article and everyone with this feed&rsquo;s connect code will
                  see it here.
                </p>
              ) : selection.type === "saved" ? (
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
                      <span className="meta-name">
                        {source?.title ??
                          savedMeta(article.link)?.sourceTitle ??
                          hostOf(article.link)}
                      </span>
                      {article.author && (
                        <>
                          <span className="dot">·</span>
                          <span className="meta-author">{article.author}</span>
                        </>
                      )}
                      {article.publishedAt && (
                        <>
                          <span className="dot">·</span>
                          <span className="meta-when">
                            {timeAgo(article.publishedAt)}
                          </span>
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
                    <div className="title-row">
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
                    {(() => {
                      const rank = ranking.get(article.id);
                      // Only a story with wider coverage behind it gets a
                      // circle. Marking most of a feed would say nothing.
                      if (!rank || rank.band === "quiet") return null;
                      const shown =
                        settings.bigStoryMetric === "newsrooms"
                          ? rank.newsrooms
                          : rank.score;
                      return (
                        <button
                          className={`score-dot rank-${rank.band}`}
                          onClick={() => setExplaining(article.id)}
                          aria-label={`${BAND_LABELS[rank.band]}, scoring ${rank.score} out of 100 — how this was worked out`}
                          title={`${BAND_LABELS[rank.band]} · ${rank.reasons.join(" · ")}\nTap for how this number was worked out`}
                        >
                          {shown}
                        </button>
                      );
                    })()}
                    </div>
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
                      {/* Sharing is its own button, never a side effect of
                          saving: what goes to the team is a deliberate act. */}
                      {teams.length > 0 &&
                        (() => {
                          const on = teamsWith(article.link);
                          const menuOpenHere = teamMenu === article.link;
                          return (
                            <div className="team-share">
                              <button
                                className={`read-btn team-btn${on.length > 0 ? " on" : ""}`}
                                aria-pressed={on.length > 0}
                                aria-expanded={teams.length > 1 ? menuOpenHere : undefined}
                                disabled={teamsBusy}
                                title={
                                  on.length > 0
                                    ? `Shared with ${on.map((t) => t.name).join(", ")}`
                                    : "Save to a team feed"
                                }
                                onClick={() => {
                                  // One team is a straight toggle; several
                                  // need to know which one.
                                  if (teams.length === 1) {
                                    void toggleTeam(teams[0].code, article, source);
                                  } else {
                                    setTeamMenu(menuOpenHere ? null : article.link);
                                  }
                                }}
                              >
                                {on.length > 0 ? Icon.peopleOn : Icon.people}
                                {on.length > 0 ? "Shared" : "Save to Team"}
                              </button>
                              {menuOpenHere && teams.length > 1 && (
                                <div className="team-menu" role="menu">
                                  {teams.map((team) => {
                                    const shared = on.some((t) => t.code === team.code);
                                    return (
                                      <button
                                        key={team.code}
                                        role="menuitemcheckbox"
                                        aria-checked={shared}
                                        disabled={teamsBusy}
                                        onClick={() =>
                                          void toggleTeam(team.code, article, source)
                                        }
                                      >
                                        <span className="team-check">
                                          {shared ? Icon.check : null}
                                        </span>
                                        {team.name}
                                      </button>
                                    );
                                  })}
                                </div>
                              )}
                            </div>
                          );
                        })()}
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

      {settings.showDownloadBar && (
        <DownloadBar state={offline.state} done={offline.done} total={offline.total} />
      )}

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
          noteCount={notes.length}
          teams={teams}
          teamsBusy={teamsBusy}
          onCreateTeam={createTeam}
          onJoinTeam={joinTeam}
          onLeaveTeam={leaveTeam}
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
          onAddMany={addSources}
        />
      )}
    </div>
  );
}
