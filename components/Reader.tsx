"use client";

import { STORAGE_FULL_EVENT } from "@/lib/subjects";
import { DEFAULT_ANTHROPIC_MODEL, DEFAULT_QUICK_MODEL } from "@/lib/models";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { Article, Attachment, DiscoverResult } from "@/lib/types";
import {
  cleanSharedPrefs,
  loadSharedPrefs,
  sameSharedPrefs,
  saveSharedPrefs,
  sharedPrefsOf,
  type SharedPrefs,
  cleanFeeds,
  loadFeeds,
  saveFeeds,
  loadRead,
  saveRead,
  loadSyncCode,
  saveSyncCode,
  loadSettings,
  unionFeeds,
  saveSettings,
  loadCollapsed,
  saveCollapsed,
  DEFAULT_SETTINGS,
  type Settings,
  newId,
  moveSourceBetweenFeeds,
  placeSource,
  placeFeed,
  sourceKey as feedSourceKey,
  FEED_COLORS,
  isFeedColor,
  type FeedColor,
  loadSaved,
  saveSaved,
  loadSavedRemovals,
  saveSavedRemovals,
  loadWatchMarks,
  saveWatchMarks,
  loadTeams,
  saveTeams,
  sanitizeTeams,
  loadVault,
  saveVault,
  loadUpdatedAt,
  saveUpdatedAt,
  loadPartStamps,
  savePartStamps,
  unionTeams,
  unionRead,
  loadUnlockedKeys,
  saveUnlockedKeys,
  type SavedArticle,
  type TeamFeed,
  type Feed,
  type Source,
} from "@/lib/store";
import type { TeamArticle } from "@/lib/team";
import { fitForSync, partStamp, type Part, type PartStamps } from "@/lib/sync-doc";
import { useLibrary } from "./useLibrary";
import { setSignedIn } from "@/lib/signed-in";
import type { Library } from "@/lib/library";
import { takeFromAccount, vaultStamp as vaultStampOf, type AccountPrefs, type Stamps } from "@/lib/prefs-merge";
import {
  loadNotes,
  saveNotes,
  loadNoteRemovals,
  saveNoteRemovals,
  mergeNotes,
  notesDifferFrom,
  slimNotesForSync,
  idsOf,
  addEntry,
  appendQuote,
  renameNote,
  moveEntry,
  releasableSaves,
  type Note,
  type NoteRemoval,
} from "@/lib/notes";
import NotePage from "./NotePage";
import { foldIntoNote } from "@/lib/note-flow";
import AddSourceDialog from "./AddSourceDialog";
import SyncDialog from "./SyncDialog";
import InlineName from "./InlineName";
import SettingsDialog from "./SettingsDialog";
import DownloadBar from "./DownloadBar";
import Attachments from "./Attachments";
import { useSourceDrag, type DropAt } from "./useSourceDrag";
import SubjectPage from "./SubjectPage";
import StatusPage from "./StatusPage";
import SpendPage from "./SpendPage";
import SubjectsHome from "./SubjectsHome";
import {
  linkIn,
  liveManual,
  loadManual,
  manualKey,
  titleFromUrl,
  mergeManual,
  sameManual,
  slimManualForSync,
  saveManual,
  sourceFor,
  type ManualStories,
  type ManualStory,
} from "@/lib/manual";
import {
  addStory,
  placeNew,
  cardsOf,
  metaOf,
  addQuoteNote,
  quoteNotesFor,
  cardNoteId,
  contactId,
  loadBoards,
  loadBoardsAsync,
  mergeBoards,
  pruneBoards,
  put as putItem,
  sameBoards,
  saveBoards,
  slimBoardsForSync,
  type Board,
  type Boards,
} from "@/lib/subjects";
import { loadHealth, recordRuns, saveHealth, type HealthLog } from "@/lib/health";
import { listenForClientErrors } from "@/lib/client-errors";
import { encodeKeysHeader, KEYS_HEADER } from "@/lib/vault";
import {
  EXTRACT_VERSION,
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
  storedArticles,
  storedBytes,
  type StoredArticle,
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
import { repairSources } from "@/lib/publishers";
import { mergeWindow, stamp } from "@/lib/window";
import { mergeSaved, differsFrom, slimForSync } from "@/lib/saved";
import { knownRefusal } from "@/lib/subscriptions";
import {
  loadPositions,
  mergePositions,
  samePositions,
  savePositions,
  slimPositionsForSync,
  POSITIONS_EVENT,
  type Positions,
} from "@/lib/position";
import {
  alertsFor,
  acknowledge,
  mergeMarks,
  pruneMarks,
  markFrom,
} from "@/lib/alerts";
import type { WatchMarks } from "@/lib/alerts";
import type { SavedRemoval } from "@/lib/saved";
import { useAccount, type Writing } from "./useAccount";
import type { ArticleMark } from "./ArticleReader";
import type { InboxItem } from "@/lib/inbox";
import SignInCard, { AccountStrip, describe as describeSave, signInHref } from "./SignInCard";
import {
  highlightsOverlapping,
  toggleHighlight,
  highlightsFor,
  loadHighlights,
  mergeHighlights,
  slimHighlightsForSync,
  removeHighlight,
  sameHighlights,
  saveHighlights,
  type Highlights,
} from "@/lib/highlights";
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

/**
 * How many articles are added to the rendered list at a time. Two screenfuls
 * on a phone, so the next batch is built while there is still list to scroll.
 */
const PAGE = 40;

function fileTitleFor(file: Attachment, parentTitle: string) {
  const kind = file.kind === "pdf" ? "PDF" : file.kind.toUpperCase();
  return `${parentTitle} (${kind})`;
}

/**
 * Whether applying this would actually change anything.
 *
 * A merge hands back fresh arrays whether or not it found anything new, and
 * a fresh array is a new identity — which the change-stamping effect reads as
 * a local edit, stamps, and pushes. Two devices left open then pushed to each
 * other on every focus, forever, with nothing to say. Cheap to compare: these
 * are the same documents that are about to be JSON-encoded onto the wire.
 */
/** Whether this device has read a watched source further than the other copy says. */
function marksAhead(mine: WatchMarks, theirs: WatchMarks) {
  return Object.entries(mine ?? {}).some(([id, mark]) => (mark?.at ?? 0) > (theirs?.[id]?.at ?? 0));
}

function unchanged(a: unknown, b: unknown) {
  return JSON.stringify(a) === JSON.stringify(b);
}

function keyHeadersFrom(keys: Record<string, string>): HeadersInit | undefined {
  return Object.keys(keys).length === 0
    ? undefined
    : { [KEYS_HEADER]: encodeKeysHeader(keys) };
}
/** A pasted story as a row in the list. */
function pastedAsLoaded(story: ManualStory, sourceId: string): Loaded {
  return {
    id: `${sourceId || "manual"}:${story.link}`,
    sourceId,
    link: story.link,
    title: story.title,
    summary: story.summary,
    image: story.image,
    publishedAt: story.publishedAt,
    seenAt: story.at,
  } as Loaded;
}

/** The list with every pasted story filed under a followed source in it. */
function withPastedStories(list: Loaded[], manual: ManualStories, following: ReadonlySet<string>): Loaded[] {
  const have = new Set(list.map((article) => canonicalUrl(article.link)));
  const extra = liveManual(manual)
    .filter((story) => story.sourceId && following.has(story.sourceId) && !have.has(manualKey(story.link)))
    .map((story) => pastedAsLoaded(story, story.sourceId!));
  return extra.length === 0 ? list : sortNewestFirst([...list, ...extra]);
}

const VIEW_KEY = "super-reader:view";
const SIDEBAR_KEY = "super-reader:subject-sidebar-hidden";
const READING_KEY = "super-reader:reading";
/** What went wrong signing in, in words, from the reason the callback gave. */
function signInReason(reason: string | null): string {
  if (!reason) return "Sign-in did not complete. Please try again.";
  if (reason === "expired") return "The sign-in took too long or started in another tab or browser. Please try again from this page.";
  if (reason === "access_denied") return "Google didn't grant access. If you were told the app isn't available to you, your Google account needs adding as a test user in the Google Cloud console.";
  if (reason === "unavailable") return "Sign-in isn't set up on this address of the app.";
  return `Sign-in did not complete (${reason}). Please try again.`;
}

/**
 * Coming back to the tab checks the server for other devices' changes — at
 * most this often. Each check wakes the database, and switching windows
 * every few seconds would otherwise keep it awake all day.
 */
const FOCUS_CHECK_MS = 3 * 60 * 1000;
/** Run on focus, but not again within FOCUS_CHECK_MS of the last run. */
function onFocusEvery(run: () => void, lastRun: { current: number }) {
  return () => {
    if (Date.now() - lastRun.current < FOCUS_CHECK_MS) return;
    lastRun.current = Date.now();
    run();
  };
}

const SETTINGS_AT = "super-reader:settings-at:v1";
const KEYS_AT = "super-reader:keys-at:v1";
const SETTING_STAMPS = "super-reader:setting-stamps:v1";
const KEY_STAMPS = "super-reader:key-stamps:v1";
const VAULT_AT = "super-reader:vault-at:v1";
/**
 * When this device last changed each setting and each key, so the account
 * merges them one at a time (lib/prefs-merge.ts). A device from before these
 * existed had one stamp per half; each choice it holds (anything but the
 * default) is dated at that, or at 1 — older than any change made since,
 * newer than another device's defaults.
 */
function loadStamps(key: string, legacyKey: string, chosen: string[]): Stamps {
  try {
    const held = JSON.parse(localStorage.getItem(key) ?? "null");
    if (held && typeof held === "object" && !Array.isArray(held)) return held as Stamps;
  } catch {
    /* fall through */
  }
  let whole = 0;
  try {
    whole = Number(localStorage.getItem(legacyKey)) || 0;
  } catch {
    /* none */
  }
  return Object.fromEntries(chosen.map((name) => [name, whole || 1]));
}
function saveStamps(key: string, stamps: Stamps | number) {
  try {
    localStorage.setItem(key, typeof stamps === "number" ? String(stamps) : JSON.stringify(stamps));
  } catch {
    /* kept for this session */
  }
}

const GRANDFATHER_KEY = "super-reader:subjects-before-signin";
const SIGNIN_ERA_KEY = "super-reader:signin-era";
const SUBJECT_USED_KEY = "super-reader:subject-used:v1";

type Selection =
  | { type: "all" }
  | { type: "saved" }
  /** Only what is actually on this device, readable with no connection. */
  | { type: "downloaded" }
  | { type: "alerts" }
  /** A shared list: its id is the team's connect code. */
  | { type: "team"; id: string }
  | { type: "note"; id: string }
  /** How every source is delivering — reached from Settings. */
  | { type: "status" }
  /** What the AI features have cost — reached from Settings. */
  | { type: "spend" }
  /** Every subject, as tiles — the Subjects button in the sidebar. */
  | { type: "subjects" }
  /** Stories pasted in that no followed source covers. */
  | { type: "manual" }
  | { type: "feed" | "source"; id: string };

export default function Reader() {
  const [feeds, setFeeds] = useState<Feed[]>([]);
  const [ready, setReady] = useState(false);
  const [articles, setArticles] = useState<Loaded[]>([]);
  const [read, setRead] = useState<Set<string>>(new Set());
  const [selection, setSelection] = useState<Selection>({ type: "all" });
  /** Where the reader was before opening a page from Settings, for its Back. */
  const beforeSettingsPage = useRef<Selection>({ type: "all" });
  const [dialogOpen, setDialogOpen] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  /** Whether the refresh has gone on long enough to be worth mentioning. */
  const [slowRefresh, setSlowRefresh] = useState(false);
  /**
   * Whether a refresh has replaced the list with live results yet. The stored
   * copy is only allowed to fill an empty screen; once the feeds have answered,
   * their answer stands even if it is shorter than what was saved.
   */
  const refreshed = useRef(false);
  const [reading, setReading] = useState<{
    url: string;
    title: string;
    feedUrl?: string;
    summary?: string;
    /** A passage to go to on arrival, when a note's quote sent us here. */
    quote?: string;
  } | null>(null);
  // An open article is a step in the browser's history, so Back — the
  // button, a swipe, a mouse's back key — closes it and returns to the
  // subject or list beneath, where it was left, rather than leaving the app.
  // The router's own state rides along, or Next would reload the page.
  const pushedRead = useRef(false);
  useEffect(() => {
    if (reading && !pushedRead.current) {
      window.history.pushState({ ...(window.history.state ?? {}), srReading: true }, "");
      pushedRead.current = true;
    } else if (!reading && pushedRead.current) {
      pushedRead.current = false;
      if (window.history.state?.srReading) window.history.back();
    }
  }, [reading]);
  useEffect(() => {
    const pop = () => {
      if (!pushedRead.current) return;
      pushedRead.current = false;
      setReading(null);
    };
    window.addEventListener("popstate", pop);
    return () => window.removeEventListener("popstate", pop);
  }, []);

  const [syncCode, setSyncCode] = useState<string | null>(null);
  /**
   * The signed-in Google account, mirrored here so the sync effects above the
   * account hook can see it. Signed in, everything shared goes to the account
   * and sync codes are not used at all.
   */
  const [accountId, setAccountId] = useState<string | null>(null);
  /** Whether sign-in has been checked: an old code is used only once it is known nobody is signed in. */
  const [accountChecked, setAccountChecked] = useState(false);
  /** This session has folded the device into the account (and dropped any old code). */
  const joinedAccount = useRef(false);
  const [syncOpen, setSyncOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  // Naming and deleting happen inline in the sidebar rather than in
  // browser prompt()/confirm() dialogs.
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<string | null>(null);
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  // Subjects are no longer optional, and the plain notes they replaced are
  // gone: whatever a stored or synced copy says, they are on.
  useEffect(() => {
    if (!settings.subjects) setSettings((current) => ({ ...current, subjects: true }));
  }, [settings.subjects]);
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
  /** How far each watched source has been read up to. */
  const [watchMarks, setWatchMarks] = useState<WatchMarks>({});
  /**
   * How far through each article the reader got, mirrored from local storage
   * so that a change to it is a change the sync can see. The reader writes
   * storage directly as you scroll; this is refreshed only when a place is
   * *left*, so reading does not become a stream of sync requests.
   */
  const [positions, setPositions] = useState<Positions>({});
  const positionsRef = useRef<Positions>({});
  /** Notes, and the quotes pulled into them. Per device, like Settings. */
  const [notes, setNotes] = useState<Note[]>([]);
  /** Subject boards, one per note, when Subjects is on (lib/subjects.ts). */
  const [boards, setBoards] = useState<Boards>({});
  /** This device had subjects before sign-in was required (see useAccount). */
  const [grandfathered, setGrandfathered] = useState(false);
  const [writingInAccount, setWritingInAccount] = useState(false);
  /** The sidebar tucked away while working in a subject (desktop; remembered). */
  const [sidebarHidden, setSidebarHidden] = useState(false);
  /** Signed in: writing then syncs with the account, not the sync code. */
  const signedInRef = useRef(false);
  /**
   * When each subject was last opened or added to, on this device — so the
   * Subject menu in an article lists the ones in use first.
   */
  const [subjectUsed, setSubjectUsed] = useState<Record<string, number>>({});
  /** Settings that follow the person between devices, with when they changed. */
  const [prefs, setPrefs] = useState<SharedPrefs>({ subjects: false, aiProvider: "anthropic", openaiModel: "gpt-5-mini", anthropicModel: DEFAULT_ANTHROPIC_MODEL,
    anthropicQuickModel: DEFAULT_QUICK_MODEL.anthropic, openaiQuickModel: DEFAULT_QUICK_MODEL.openai, at: 0 });
  const prefsRef = useRef<SharedPrefs>(prefs);
  /** Stories pasted in by hand (lib/manual.ts). */
  const [manual, setManual] = useState<ManualStories>({});
  const manualRef = useRef<ManualStories>({});
  /** Passages marked in articles with "Highlight" (lib/highlights.ts). */
  const [highlights, setHighlights] = useState<Highlights>({});
  const highlightsRef = useRef<Highlights>({});
  const [pasteNotice, setPasteNotice] = useState<{ kind: "busy" | "done" | "error"; text: string } | null>(null);
  const boardsRef = useRef<Boards>({});
  /** Per-source delivery history for the status page (lib/health.ts). */
  const [health, setHealth] = useState<HealthLog>({});
  const [addingNote, setAddingNote] = useState(false);
  const [noteRemovals, setNoteRemovals] = useState<NoteRemoval[]>([]);
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
    result?: { saved: number; failed: number; skipped?: number };
  }>({ state: "idle" });
  /**
   * Which articles are on the device already. Kept as a set of links so the
   * list can mark them without asking IndexedDB per row on every render.
   */
  const [savedOffline, setSavedOffline] = useState<Set<string>>(new Set());
  /** What the device is holding, for the Downloaded list. */
  const [downloaded, setDownloaded] = useState<StoredArticle[]>([]);
  const [downloadedBytes, setDownloadedBytes] = useState(0);
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
  const marksRef = useRef<WatchMarks>({});
  /** The notes as they stand, for writes that land in the same click. */
  const notesRef = useRef<Note[]>([]);
  /** Feeds and teams as they stand, so an identical pull can be recognised. */
  const feedsRef = useRef<Feed[]>([]);
  const teamsRef = useRef<TeamFeed[]>([]);
  const readRef = useRef<Set<string>>(new Set());
  /** Deletions, dated, so syncing does not put them back. */
  const noteRemovalsRef = useRef<NoteRemoval[]>([]);
  /** When this device last changed each part sync replaces whole (lib/sync-doc.ts). */
  const partStampsRef = useRef<PartStamps>({});
  /** Each replaced part as last loaded or taken from sync, to tell a change made here from one that arrived. */
  const known = useRef<Partial<Record<Part, string>>>({});
  const vaultHeld = useRef<unknown>(null);

  // Crashes on a phone are otherwise invisible; see lib/client-errors.ts.
  useEffect(() => listenForClientErrors(), []);

  useEffect(() => {
    /**
     * Repair on load: a source whose feed has died since it was added points
     * at a URL that cannot answer, and the list just quietly stops growing —
     * see repairSources in lib/publishers.ts. Each device fixes its own copy
     * the next time it opens.
     */
    setFeeds(
      loadFeeds().map((feed) => {
        const sources = repairSources(feed.sources);
        return sources === feed.sources ? feed : { ...feed, sources };
      }),
    );
    setRead(loadRead());
    setSyncCode(loadSyncCode());
    const storedSettings = loadSettings();
    setSettings(storedSettings);
    const storedPrefs = loadSharedPrefs(storedSettings);
    prefsRef.current = storedPrefs;
    setPrefs(storedPrefs);
    saveSharedPrefs(storedPrefs);
    setCollapsed(loadCollapsed());
    setSaved(loadSaved());
    setSavedRemovals(loadSavedRemovals());
    setWatchMarks(loadWatchMarks());
    setTeams(loadTeams());
    const storedNotes = loadNotes();
    // Whoever already had writing here before sign-in existed keeps using it
    // without signing in: it was theirs before the lock was.
    try {
      // Decided once, on the first load of the version with sign-in: writing
      // made after that does not earn the exemption.
      if (!localStorage.getItem(SIGNIN_ERA_KEY)) {
        if (storedNotes.length > 0) localStorage.setItem(GRANDFATHER_KEY, String(Date.now()));
        localStorage.setItem(SIGNIN_ERA_KEY, String(Date.now()));
      }
      setGrandfathered(Boolean(localStorage.getItem(GRANDFATHER_KEY)));
    } catch {
      /* storage unavailable */
    }
    notesRef.current = storedNotes;
    setNotes(storedNotes);
    try {
      setSidebarHidden(localStorage.getItem(SIDEBAR_KEY) === "1");
    } catch {
      /* shown */
    }
    // A refresh on a subject comes back to that subject, not the feed.
    try {
      // And an article open over it comes back open, where it was left.
      const open = JSON.parse(sessionStorage.getItem(READING_KEY) ?? "null");
      if (open && typeof open.url === "string") {
        setReading({ url: open.url, title: String(open.title ?? ""), feedUrl: open.feedUrl, summary: open.summary });
      }
      const view = JSON.parse(sessionStorage.getItem(VIEW_KEY) ?? "null");
      if (view?.type === "subjects") setSelection({ type: "subjects" });
      if (view?.type === "note" && storedNotes.some((n) => n.id === view.id)) setSelection({ type: "note", id: view.id });
    } catch {
      /* nothing remembered */
    }
    const storedNoteRemovals = loadNoteRemovals();
    noteRemovalsRef.current = storedNoteRemovals;
    setNoteRemovals(storedNoteRemovals);
    const storedBoards = loadBoards();
    boardsRef.current = storedBoards;
    setBoards(storedBoards);
    // The full copy is in IndexedDB; whatever happened meanwhile is merged in, not replaced.
    void loadBoardsAsync().then((held) => {
      const merged = mergeBoards(held, boardsRef.current);
      if (sameBoards(merged, boardsRef.current)) return;
      boardsRef.current = merged;
      setBoards(merged);
    });
    setHealth(loadHealth());
    try {
      const used = JSON.parse(localStorage.getItem(SUBJECT_USED_KEY) ?? "{}");
      if (used && typeof used === "object") setSubjectUsed(used);
    } catch {
      /* no history yet */
    }
    const storedManual = loadManual();
    manualRef.current = storedManual;
    setManual(storedManual);
    const storedHighlights = loadHighlights();
    highlightsRef.current = storedHighlights;
    setHighlights(storedHighlights);
    const storedVault = loadVault();
    vaultHeld.current = storedVault;
    setVault(storedVault);
    setApiKeys(loadUnlockedKeys());
    updatedAtRef.current = loadUpdatedAt();
    partStampsRef.current = loadPartStamps();
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
    watchMarks?: WatchMarks;
    positions?: Positions;
    notes?: Note[];
    noteRemovals?: NoteRemoval[];
    boards?: Boards;
    manual?: ManualStories;
    highlights?: Highlights;
    prefs?: unknown;
    teams?: unknown;
    vault?: unknown;
    stamps?: PartStamps;
    updatedAt?: number;
  },
  how: {
    /** This device is taking up a code it did not have: what the code holds wins, and this device's additions join it. */
    joining?: boolean;
    /** The answer to this device's own push, carrying the stamp it sent. */
    sent?: number;
    /** The code belongs to a Google account, so it carries no writing. */
    inAccount?: boolean;
  } = {},
  ) => {
    applying.current = true;
    const joining = Boolean(how.joining);
    const fromPush = how.sent !== undefined;
    const changedSinceSent = fromPush && updatedAtRef.current > how.sent!;
    /*
     * The feed list, read marks, team list and vault are each replaced whole,
     * by whichever device changed that part last — each by its own stamp, so
     * marking an article read never makes an old feed list look new.
     */
    const theirs = (part: Part) => partStamp(payload, part);
    const mine = (part: Part) => partStampsRef.current[part] ?? 0;
    /** Neither side has ever dated this part: nothing says which is newer, so both are kept. */
    const unions = (part: Part) => joining || (theirs(part) === 0 && mine(part) === 0);
    const takes = (part: Part) => unions(part) || theirs(part) >= mine(part);
    const settle = (part: Part) => {
      partStampsRef.current = { ...partStampsRef.current, [part]: Math.max(theirs(part), joining ? 0 : mine(part)) };
      savePartStamps(partStampsRef.current);
    };
    /** Parts this device holds a newer copy of: still to be sent. */
    const ahead: Part[] = [];
    /** Parts a join added this device's own things to: to be sent as a change of its own. */
    const added: Part[] = [];

    if (Array.isArray(payload.feeds)) {
      // Checked like stored feeds: another device's malformed list must not blank this one.
      const remote = cleanFeeds(payload.feeds);
      if (takes("feeds")) {
        // Joining (a new or cleared browser, or one signing in), the feeds the
        // code holds are taken whatever this device's stamp says, with anything
        // only this device has added kept alongside.
        const next = unions("feeds") ? unionFeeds(remote, feedsRef.current) : remote;
        if (!unchanged(next, feedsRef.current)) {
          known.current.feeds = JSON.stringify(next);
          feedsRef.current = next;
          setFeeds(next);
        }
        settle("feeds");
        if (!unchanged(next, remote)) added.push("feeds");
      } else if (!unchanged(remote, feedsRef.current)) ahead.push("feeds");
    }
    // Which team feeds this person is on travels between their own devices;
    // what is *in* those feeds does not, and never touches local storage.
    if (Array.isArray(payload.teams)) {
      const remote = sanitizeTeams(payload.teams);
      if (takes("teams")) {
        const next = unions("teams") ? unionTeams(remote, teamsRef.current) : remote;
        if (!unchanged(next, teamsRef.current)) {
          known.current.teams = JSON.stringify(next);
          teamsRef.current = next;
          setTeams(next);
          saveTeams(next);
        }
        settle("teams");
        if (!unchanged(next, remote)) added.push("teams");
      } else if (!unchanged(remote, teamsRef.current)) ahead.push("teams");
    } else if (teamsRef.current.length) ahead.push("teams");
    // The vault arrives encrypted; it stays locked until a passphrase is
    // entered on this device, which is the whole point of it.
    if (payload.vault) {
      const differs = JSON.stringify(payload.vault) !== JSON.stringify(vaultHeld.current ?? null);
      if (unions("vault") && !joining && vaultHeld.current) {
        // Undated on both sides: this device's vault is kept and sent, never dropped for the other.
        if (differs) ahead.push("vault");
      } else if (takes("vault")) {
        if (differs) {
          known.current.vault = JSON.stringify(payload.vault);
          vaultHeld.current = payload.vault;
          setVault(payload.vault);
          saveVault(payload.vault);
        }
        settle("vault");
      } else if (differs) ahead.push("vault");
    } else if (vaultHeld.current) ahead.push("vault");
    // Compared before applying: a fresh Set of the same ids is still a new
    // identity — which is how two idle devices came to push to each other on
    // every focus.
    if (Array.isArray(payload.read)) {
      const remote = [...new Set(payload.read.filter((id): id is string => typeof id === "string"))];
      const local = [...readRef.current];
      if (takes("read")) {
        const next = unions("read") ? unionRead(remote, local) : remote;
        if (!unchanged(next, local)) {
          known.current.read = JSON.stringify(next);
          const set = new Set(next);
          readRef.current = set;
          setRead(set);
          saveRead(set);
        }
        settle("read");
        if (!unchanged(next, remote)) added.push("read");
      } else if (!unchanged(remote, local)) ahead.push("read");
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
    // Watch marks merge by taking the later of each: looking at a source on
    // one device should clear its badge on the other, and a mark only ever
    // moves forward, so there is nothing to resolve. Guarded like the rest,
    // so an identical pull does not set state and start the two devices
    // talking past each other.
    // Places in articles merge the same way: per article, the more recent
    // change wins — so where you stopped on the phone is where the laptop
    // opens, and a story finished on one is not resurrected by the other.
    const places = mergePositions(positionsRef.current, payload.positions ?? {});
    if (!samePositions(places, positionsRef.current)) {
      positionsRef.current = places;
      setPositions(places);
      savePositions(places);
    }
    // Subject boards merge item by item, most recent change winning — on the
    // code only while signed out and the code is not an account's.
    const writingHere = !signedInRef.current && !how.inAccount;
    const mergedBoards = writingHere ? mergeBoards(boardsRef.current, payload.boards ?? {}) : boardsRef.current;
    if (!sameBoards(mergedBoards, boardsRef.current)) {
      boardsRef.current = mergedBoards;
      setBoards(mergedBoards);
      saveBoards(mergedBoards);
    }
    // Shared settings: the more recent choice wins, whichever device made it.
    const remotePrefs = cleanSharedPrefs(payload.prefs);
    if (remotePrefs && remotePrefs.at > prefsRef.current.at) {
      prefsRef.current = remotePrefs;
      setPrefs(remotePrefs);
      saveSharedPrefs(remotePrefs);
      setSettings((current) => {
        const next = {
          ...current,
          subjects: remotePrefs.subjects,
          aiProvider: remotePrefs.aiProvider,
          openaiModel: remotePrefs.openaiModel,
          anthropicModel: remotePrefs.anthropicModel,
          anthropicQuickModel: remotePrefs.anthropicQuickModel,
          openaiQuickModel: remotePrefs.openaiQuickModel,
        };
        saveSettings(next);
        return next;
      });
    }
    const mergedManual = mergeManual(manualRef.current, payload.manual ?? {});
    if (!sameManual(mergedManual, manualRef.current)) {
      manualRef.current = mergedManual;
      setManual(mergedManual);
      saveManual(mergedManual);
    }
    const mergedHighlights = mergeHighlights(highlightsRef.current, payload.highlights ?? {});
    if (!sameHighlights(mergedHighlights, highlightsRef.current)) {
      highlightsRef.current = mergedHighlights;
      setHighlights(mergedHighlights);
      saveHighlights(mergedHighlights);
    }
    const marks = mergeMarks(marksRef.current, payload.watchMarks ?? {});
    if (!unchanged(marks, marksRef.current)) {
      marksRef.current = marks;
      setWatchMarks(marks);
      saveWatchMarks(marks);
    }
    if (!unchanged(bookmarks.saved, savedRef.current)) {
      setSaved(bookmarks.saved);
      saveSaved(bookmarks.saved);
    }
    if (!unchanged(bookmarks.removals, removalsRef.current)) {
      setSavedRemovals(bookmarks.removals);
      saveSavedRemovals(bookmarks.removals);
    }
    // Notes merge for the same reason, and with the same shape of tombstone:
    // a quote taken on the phone must survive the desktop pushing over it.
    const merged = writingHere
      ? mergeNotes(
          { notes: notesRef.current, removals: noteRemovalsRef.current },
          { notes: payload.notes ?? [], removals: payload.noteRemovals ?? [] },
        )
      : { notes: notesRef.current, removals: noteRemovalsRef.current };
    if (!unchanged(merged.notes, notesRef.current)) {
      notesRef.current = merged.notes;
      setNotes(merged.notes);
      saveNotes(merged.notes);
    }
    if (!unchanged(merged.removals, noteRemovalsRef.current)) {
      noteRemovalsRef.current = merged.removals;
      setNoteRemovals(merged.removals);
      saveNoteRemovals(merged.removals);
    }

    // A note deleted on the other device releases the bookmark its quote was
    // holding here — that device may never have known the bookmark was one a
    // quote made, since the flag is local. Without this the article would sit
    // in Saved forever, quoted by nothing.
    const releasable = releasableSaves(bookmarks.saved, merged.notes);
    if (releasable.length > 0) {
      const drop = new Set(releasable);
      bookmarks.saved = bookmarks.saved.filter((article) => !drop.has(article.link));
      const at = Date.now();
      bookmarks.removals = [
        ...releasable.map((link) => ({ link, at })),
        ...bookmarks.removals.filter((removal) => !drop.has(removal.link)),
      ];
      setSaved(bookmarks.saved);
      saveSaved(bookmarks.saved);
      setSavedRemovals(bookmarks.removals);
      saveSavedRemovals(bookmarks.removals);
    }

    // If the merge kept something the other side had not seen, this device
    // still has news — so it must not mark itself up to date. Everything is
    // compared as it would be *sent*: the wire copy is cut to a budget, and
    // comparing the full set would report news this device can never deliver
    // — and push forever trying.
    const owes =
      ahead.length > 0 ||
      added.length > 0 ||
      differsFrom(
        { saved: slimForSync(bookmarks.saved), removals: bookmarks.removals },
        { saved: payload.saved ?? [], removals: payload.savedRemovals ?? [] },
      ) ||
      releasable.length > 0 ||
      !samePositions(slimPositionsForSync(places), slimPositionsForSync(payload.positions ?? {})) ||
      (writingHere && !sameBoards(slimBoardsForSync(mergedBoards), payload.boards ?? {})) ||
      !sameManual(slimManualForSync(mergedManual), payload.manual ?? {}) ||
      !sameHighlights(slimHighlightsForSync(mergedHighlights), payload.highlights ?? {}) ||
      marksAhead(marks, payload.watchMarks ?? {}) ||
      prefsRef.current.at > (cleanSharedPrefs(payload.prefs)?.at ?? 0) ||
      (writingHere &&
        notesDifferFrom(
          { notes: slimNotesForSync(merged.notes), removals: merged.removals },
          { notes: payload.notes ?? [], removals: payload.noteRemovals ?? [] },
        ));

    // The stamp only ever goes forward, or the next push looks like the stale one.
    const remoteUpdated = Number(payload.updatedAt) || 0;
    if (remoteUpdated > updatedAtRef.current) {
      updatedAtRef.current = remoteUpdated;
      setUpdatedAt(remoteUpdated);
      saveUpdatedAt(remoteUpdated);
    }
    // A join's additions are this device's own change, made now, so the code takes them.
    for (const part of added) stampSyncPart(part);
    if (fromPush) {
      // The server has everything that was sent. Anything changed here since
      // has its own stamp and goes in the next push; what came back is not news.
      if (!changedSinceSent) pushedAt.current = updatedAtRef.current;
    } else if (owes) {
      // Stamp the union as a change of this device's own, so the push effect
      // sends it rather than sitting on what the other device lacks.
      stampChange();
    } else {
      pushedAt.current = updatedAtRef.current;
    }
    // Release on the next tick, after the state updates have flushed.
    setTimeout(() => {
      applying.current = false;
    }, 0);
  }, []);

  const pull = useCallback(
    /** `joining`: this device is taking up a code it did not have — what the code holds wins. */
    async (code: string, joining = false) => {
      const res = await fetch(`/api/sync?code=${encodeURIComponent(code)}`);
      const data = await res.json();
      // Even a failed pull opens the gate: a device that cannot read must not
      // be stuck unable to write for the rest of the session.
      pulled.current = true;
      if (!res.ok) throw new Error(data.error ?? "Could not fetch synced feeds");

      // Signed in on another device: the subjects moved to the account, and this copy is no longer kept up to date.
      if (data.inAccount) setWritingInAccount(true);
      // Joining a code (a new or cleared browser, or one signing in), the
      // feeds, teams, read marks and vault the code holds are taken whatever
      // this device's stamps say, with anything only this device added kept
      // alongside. Otherwise each part goes by its own stamp, and everything
      // else merges whichever way round the two devices are.
      applyRemote(data.payload ?? {}, { joining, inAccount: Boolean(data.inAccount) });
    },
    [applyRemote],
  );

  useEffect(() => {
    if (ready) saveFeeds(feeds);
  }, [feeds, ready]);

  useEffect(() => {
    feedsRef.current = feeds;
  }, [feeds]);

  useEffect(() => {
    const load = () => {
      const current = loadPositions();
      if (samePositions(current, positionsRef.current)) return;
      positionsRef.current = current;
      setPositions(current);
    };
    load();
    window.addEventListener(POSITIONS_EVENT, load);
    return () => window.removeEventListener(POSITIONS_EVENT, load);
  }, []);

  // A removed source must not leave its mark behind to accumulate.
  useEffect(() => {
    if (!ready) return;
    setWatchMarks((current) => {
      const kept = pruneMarks(
        current,
        feeds.flatMap((feed) => feed.sources.map((source) => source.id)),
      );
      if (Object.keys(kept).length === Object.keys(current).length) return current;
      saveWatchMarks(kept);
      return kept;
    });
  }, [feeds, ready]);

  useEffect(() => {
    savedRef.current = saved;
    removalsRef.current = savedRemovals;
    marksRef.current = watchMarks;
    feedsRef.current = feeds;
    teamsRef.current = teams;
    readRef.current = read;
    vaultHeld.current = vault;
  }, [saved, savedRemovals, watchMarks, feeds, teams, read, vault]);

  /**
   * Stamp a real local change. The first run is the load from storage, which
   * is not a change — stamping it would make a stale device look like the
   * freshest one.
   */
  const stampChange = useCallback(() => {
    // Always outrank what this device last saw. Wall clocks disagree between
    // devices, and a stamp pulled from one running ahead would otherwise
    // freeze this device out of syncing anything ever again.
    const now = Math.max(Date.now(), updatedAtRef.current + 1);
    updatedAtRef.current = now;
    setUpdatedAt(now);
    saveUpdatedAt(now);
  }, []);
  /** A change here to a part sync replaces whole: dated past anything seen for it. */
  const stampSyncPart = useCallback((part: Part) => {
    const now = Math.max(Date.now(), (partStampsRef.current[part] ?? 0) + 1, updatedAtRef.current + 1);
    partStampsRef.current = { ...partStampsRef.current, [part]: now };
    savePartStamps(partStampsRef.current);
    updatedAtRef.current = now;
    setUpdatedAt(now);
    saveUpdatedAt(now);
  }, []);
  /**
   * A replaced part as it now stands. What was loaded, or taken from sync, is
   * recorded in `known` first, so only a change made on this device is
   * stamped — by content, not by timing, which a render can outrun.
   */
  const notice = useCallback(
    (part: Part, value: unknown) => {
      const text = JSON.stringify(value ?? null);
      if (known.current[part] === text) return;
      const first = known.current[part] === undefined;
      known.current[part] = text;
      if (!first) stampSyncPart(part);
    },
    [stampSyncPart],
  );
  useEffect(() => {
    if (ready) notice("feeds", feeds);
  }, [feeds, ready, notice]);
  useEffect(() => {
    if (ready) notice("read", [...read]);
  }, [read, ready, notice]);
  useEffect(() => {
    if (ready) notice("teams", teams);
  }, [teams, ready, notice]);
  useEffect(() => {
    if (ready) notice("vault", vault);
  }, [vault, ready, notice]);
  // Everything else merges, so one stamp says "this device has news".
  useEffect(() => {
    if (!ready) return;
    if (!hydrated.current) {
      hydrated.current = true;
      return;
    }
    if (applying.current) return;
    stampChange();
  }, [
    saved,
    savedRemovals,
    watchMarks,
    manual,
    highlights,
    prefs,
    ready,
    stampChange,
  ]);
  // Subjects ride on the sync code only while signed out; signed in, they save to the account by themselves.
  const writingSeen = useRef(false);
  useEffect(() => {
    if (!ready) return;
    if (!writingSeen.current) {
      writingSeen.current = true;
      return;
    }
    if (applying.current || signedInRef.current) return;
    stampChange();
  }, [notes, noteRemovals, boards, ready, stampChange]);
  // A reading position is announced only when it settles — leaving the
  // article, switching tabs, closing the page — so each one syncs straight away.
  const positionsSeen = useRef(false);
  useEffect(() => {
    if (!ready) return;
    if (!positionsSeen.current) {
      positionsSeen.current = true;
      return;
    }
    if (applying.current) return;
    stampChange();
  }, [positions, ready, stampChange]);

  // Pull once the account or code is known, and again whenever the window
  // regains focus, so a device left open picks up changes made elsewhere.
  //
  // Signed in, the account is the only place things are kept. The first time
  // in a session the device joins it (POST /api/account/link): an old sync
  // code it still had is folded into the account once and forgotten, and
  // what the account holds is taken with this device's own additions kept.
  useEffect(() => {
    if (!ready || (!accountId && (!syncCode || !accountChecked))) return;
    let cancelled = false;

    const sync = async () => {
      setSyncState("working");
      try {
        if (accountId) {
          if (!joinedAccount.current) {
            const res = await fetch("/api/account/link", {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({ code: loadSyncCode() }),
            });
            if (!res.ok) throw new Error("Could not reach your account");
            const data = await res.json();
            pulled.current = true;
            applyRemote(data.payload ?? {}, { joining: true, inAccount: true });
            joinedAccount.current = true;
            saveSyncCode(null);
            setSyncCode(null);
          } else {
            const res = await fetch("/api/account/state", { cache: "no-store" });
            if (!res.ok) throw new Error("Could not reach your account");
            const data = await res.json();
            applyRemote(data.payload ?? {}, { inAccount: true });
          }
        } else if (syncCode) {
          await pull(syncCode);
        }
        if (!cancelled) setSyncState("saved");
      } catch {
        if (!cancelled) setSyncState("error");
      }
    };

    sync();
    const last = { current: Date.now() };
    // Not joined yet (it failed): try again on the very next focus.
    const onFocus = onFocusEvery(() => void sync(), last);
    const onFocusNow = () => {
      if (accountId && !joinedAccount.current) void sync();
      else onFocus();
    };
    window.addEventListener("focus", onFocusNow);
    window.addEventListener("online", onFocusNow);
    return () => {
      cancelled = true;
      window.removeEventListener("focus", onFocusNow);
      window.removeEventListener("online", onFocusNow);
    };
    // syncCode is dropped on joining; that must not start another round.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, accountId, accountId ? null : syncCode, accountChecked, pull, applyRemote]);

  // Push local changes, debounced so a burst of edits is one request.
  useEffect(() => {
    if (!ready || (!accountId && (!syncCode || !accountChecked)) || applying.current) return;
    if (accountId && !joinedAccount.current) return; // never before joining the account
    if (!pulled.current) return; // never before knowing what is out there
    if (updatedAt === 0 || updatedAt <= pushedAt.current) return;

    const timer = setTimeout(async () => {
      setSyncState("working");
      try {
        const res = await fetch(accountId ? "/api/account/state" : "/api/sync", {
          method: "PUT",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(
            fitForSync({
              ...(accountId ? {} : { code: syncCode }),
              feeds,
              read: [...read],
              // Trimmed: the newest few hundred, the summaries short. The rest
              // stay here and, signed in, in the account's library.
              saved: slimForSync(saved),
              savedRemovals,
              watchMarks,
              positions: slimPositionsForSync(positions),
              // Signed in, writing goes to the account instead (useAccount).
              ...(signedInRef.current
                ? {}
                : { notes: slimNotesForSync(notes), noteRemovals, boards: slimBoardsForSync(boards) }),
              manual: slimManualForSync(manual),
              highlights: slimHighlightsForSync(highlights),
              prefs,
              teams,
              vault,
              stamps: partStampsRef.current,
              updatedAt,
            }),
          ),
        });
        if (!res.ok) throw new Error("save failed");
        // What the code now holds comes back: any part another device changed
        // more recently is taken now, rather than at the next look.
        const data = await res.json().catch(() => null);
        if (data?.payload) applyRemote(data.payload, { sent: updatedAt, inAccount: Boolean(data.inAccount) });
        pushedAt.current = Math.max(pushedAt.current, updatedAt);
        setSyncState("saved");
      } catch {
        setSyncState("error");
      }
    }, 900);
    return () => clearTimeout(timer);
  }, [
    feeds,
    read,
    saved,
    savedRemovals,
    watchMarks,
    positions,
    notes,
    noteRemovals,
    boards,
    manual,
    highlights,
    prefs,
    teams,
    ready,
    syncCode,
    accountId,
    accountChecked,
    vault,
    updatedAt,
    applyRemote,
  ]);

  // New sync codes are no longer made, nor entered: signing in with Google
  // replaced them. A device that already had one keeps using it until it signs in.

  /** An earlier feed list (kept on the server): what it had that this one lacks is added back. */
  const restoreFeeds = useCallback(
    async (id: string) => {
      const url = accountId
        ? `/api/account/state/history?id=${encodeURIComponent(id)}`
        : syncCode
          ? `/api/sync/history?code=${encodeURIComponent(syncCode)}&id=${encodeURIComponent(id)}`
          : null;
      if (!url) throw new Error("Sign in to keep earlier feed lists.");
      const res = await fetch(url, { cache: "no-store" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.version) throw new Error(data.error ?? "Could not load that feed list");
      const count = (list: Feed[]) => list.reduce((n, feed) => n + feed.sources.length, 0);
      const before = feedsRef.current;
      const next = unionFeeds(before, cleanFeeds(data.version.feeds));
      if (!unchanged(next, before)) {
        feedsRef.current = next;
        setFeeds(next);
      }
      const teamsBefore = teamsRef.current;
      const teamsNext = unionTeams(teamsBefore, sanitizeTeams(data.version.teams));
      if (!unchanged(teamsNext, teamsBefore)) {
        teamsRef.current = teamsNext;
        setTeams(teamsNext);
        saveTeams(teamsNext);
      }
      return { folders: next.length - before.length, sources: count(next) - count(before), teams: teamsNext.length - teamsBefore.length };
    },
    [syncCode, accountId],
  );

  /** Merge the account's copy of the writing into this device's. */
  const applyWriting = useCallback((doc: Writing) => {
    const mergedBoards = mergeBoards(boardsRef.current, doc.boards ?? {});
    if (!sameBoards(mergedBoards, boardsRef.current)) {
      boardsRef.current = mergedBoards;
      setBoards(mergedBoards);
      saveBoards(mergedBoards);
    }
    const merged = mergeNotes(
      { notes: notesRef.current, removals: noteRemovalsRef.current },
      { notes: doc.notes ?? [], removals: doc.noteRemovals ?? [] },
    );
    if (!unchanged(merged.notes, notesRef.current)) {
      notesRef.current = merged.notes;
      setNotes(merged.notes);
      saveNotes(merged.notes);
    }
    if (!unchanged(merged.removals, noteRemovalsRef.current)) {
      noteRemovalsRef.current = merged.removals;
      setNoteRemovals(merged.removals);
      saveNoteRemovals(merged.removals);
    }
  }, []);

  const writing = useMemo<Writing>(() => ({ notes, noteRemovals, boards }), [notes, noteRemovals, boards]);
  const auth = useAccount({ ready, writing, applyWriting });
  signedInRef.current = Boolean(auth.account);
  useEffect(() => {
    const id = auth.account?.id ?? null;
    if (!id) joinedAccount.current = false;
    setAccountId(id);
    setSignedIn(Boolean(id));
    if (auth.checked) setAccountChecked(true);
  }, [auth.account, auth.checked]);

  /*
   * Signed in, every bookmark, pasted story and highlight is also kept with
   * the account, one by one and with no cap (lib/library.ts) — the synced
   * document carries only the newest few hundred of each.
   */
  const library = useMemo(() => ({ saved, savedRemovals, manual, highlights }), [saved, savedRemovals, manual, highlights]);
  const applyLibrary = useCallback((lib: Library) => {
    const bookmarks = mergeSaved(
      { saved: savedRef.current, removals: removalsRef.current },
      { saved: lib.saved, removals: lib.savedRemovals },
    );
    if (!unchanged(bookmarks.saved, savedRef.current)) {
      savedRef.current = bookmarks.saved;
      setSaved(bookmarks.saved);
      saveSaved(bookmarks.saved);
    }
    if (!unchanged(bookmarks.removals, removalsRef.current)) {
      removalsRef.current = bookmarks.removals;
      setSavedRemovals(bookmarks.removals);
      saveSavedRemovals(bookmarks.removals);
    }
    const mergedManual = mergeManual(manualRef.current, lib.manual);
    if (!sameManual(mergedManual, manualRef.current)) {
      manualRef.current = mergedManual;
      setManual(mergedManual);
      saveManual(mergedManual);
    }
    const mergedHighlights = mergeHighlights(highlightsRef.current, lib.highlights);
    if (!sameHighlights(mergedHighlights, highlightsRef.current)) {
      highlightsRef.current = mergedHighlights;
      setHighlights(mergedHighlights);
      saveHighlights(mergedHighlights);
    }
  }, []);
  useLibrary({ account: auth.account?.id ?? null, library, apply: applyLibrary });
  /** Subjects need a Google sign-in, wherever sign-in is set up: they are saved only to the account. */
  const subjectsLocked = auth.enabled && auth.checked && !auth.account;

  // This device's storage refusing the writing is the one failure that can lose work: say so plainly.
  const [storageFull, setStorageFull] = useState(false);
  useEffect(() => {
    const on = (e: Event) => setStorageFull(Boolean((e as CustomEvent<boolean>).detail));
    window.addEventListener(STORAGE_FULL_EVENT, on);
    return () => window.removeEventListener(STORAGE_FULL_EVENT, on);
  }, []);
  // Put in <body>, not where it is written: inside the sidebar, which slides
  // with a transform on a phone, "fixed" meant fixed to the sidebar, and the
  // banner was pushed off the left of the screen and under the notch.
  const [fullHidden, setFullHidden] = useState(false);
  const fullWarning =
    storageFull &&
    !fullHidden &&
    typeof document !== "undefined" &&
    createPortal(
      <div className="storage-full" role="alert">
        <div>
          <strong>This browser is out of room.</strong>{" "}
          {auth.account && auth.status !== "error" && auth.status !== "offline"
            ? "Your changes are still being saved to your Google account — keep this tab open until it says saved."
            : "New changes are not being kept on this device yet — keep this tab open."}
          <details className="storage-full-help">
            <summary>How to fix it</summary>
            <ol>
              <li>
                {auth.account ? "You're signed in, so nothing is lost: your work is kept with your Google account." : (
                  <>
                    <a href={signInHref()}>Sign in with Google</a> first — then your work is kept with your account, not only in this browser.
                  </>
                )}
              </li>
              <li>
                Reload the page. The app now keeps subjects and pictures in the browser&rsquo;s larger storage, and moves them there on its own — this usually clears the warning.
              </li>
              <li>
                Still full? Open{" "}
                <button
                  className="link-btn"
                  onClick={() => {
                    try {
                      localStorage.setItem("super-reader:settings-tab", "account");
                    } catch {
                      /* opens on the last tab */
                    }
                    setFullHidden(true);
                    setSettingsOpen(true);
                  }}
                >
                  Settings → Account → Storage
                </button>
                {" "}to see which subjects and offline articles take the most room, and remove pictures or downloaded articles you no longer need.
              </li>
              <li>
                On iPhone, check the phone itself has free space (Settings → General → iPhone Storage) — Safari gives sites less room when the phone is nearly full.
              </li>
              <li>
                Last resort, once the top of Subjects says &ldquo;Saved&rdquo;: clear this site&rsquo;s data in your browser settings and sign in again. Everything comes back from your account.
              </li>
            </ol>
          </details>
        </div>
        <button className="storage-full-close" aria-label="Hide this warning" onClick={() => setFullHidden(true)}>
          {Icon.close}
        </button>
      </div>,
      document.body,
    );
  const accountStrip = auth.enabled && (
    <>
    {<AccountStrip
      account={auth.account}
      enabled={auth.enabled}
      status={auth.status}
      savedAt={auth.savedAt}
      backedUpAt={auth.backedUpAt}
      backupProblem={auth.backupProblem}
      onSignOut={() => void auth.signOut()}
    />}
    </>
  );

  // Back from Google: tidy the address bar, and say so if it went wrong.
  const [signInFailed, setSignInFailed] = useState<string | false>(false);
  const [cameBack, setCameBack] = useState(false);
  useEffect(() => {
    const url = new URL(window.location.href);
    if (!url.searchParams.has("signin") && !url.searchParams.has("signedin")) return;
    if (url.searchParams.get("signin") === "failed") setSignInFailed(signInReason(url.searchParams.get("reason")));
    if (url.searchParams.get("signin") === "unavailable") setSignInFailed("Sign-in isn't set up on this address of the app.");
    if (url.searchParams.has("signedin")) {
      setSelection({ type: "subjects" });
      setCameBack(true);
    }
    url.searchParams.delete("signin");
    url.searchParams.delete("signedin");
    url.searchParams.delete("reason");
    window.history.replaceState(null, "", url.toString());
  }, []);
  // Google said yes and the server started a session, yet this page has none:
  // the cookie never reached this browser (blocked, or the sign-in finished in another one).
  useEffect(() => {
    if (cameBack && auth.checked && auth.enabled && !auth.account) {
      setSignInFailed("Google signed you in, but this browser didn't keep the sign-in. If you opened Super Reader from your home screen, open it in your browser instead and sign in there; otherwise check that cookies aren't blocked for this site.");
    }
  }, [cameBack, auth.checked, auth.enabled, auth.account]);

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
    const onFocus = onFocusEvery(load, { current: Date.now() });
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
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
      refreshed.current = true;
      setArticles([]);
      return;
    }
    setRefreshing(true);
    try {
      const params = new URLSearchParams();
      for (const source of sources) params.append("url", source.feedUrl);
      // Sources that follow a whole publisher may also collect from that
      // publisher's news sitemap. Sections may not: the sitemap covers the
      // whole newsroom, and merging it in would widen the source.
      for (const source of sources) {
        if (source.scope === "site") params.append("whole", source.feedUrl);
      }
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

      /**
       * Merged into what was already held, not swapped for it. A feed is a
       * window of the last few dozen things a desk filed; showing only that
       * window meant everything published between two visits was missed, with
       * nothing to show it had happened — see lib/window.ts.
       */
      const held = (await loadListSnapshot<Loaded>()) ?? [];
      const ordered = sortNewestFirst(
        mergeWindow(stamp(unique), held, {
          sources: new Set(sources.map((source) => source.id)),
          canonical: canonicalUrl,
        }),
      );
      refreshed.current = true;
      // Stories pasted in and filed under a source are not in its feed; put
      // them back, or the refresh would take them away.
      const withPasted = withPastedStories(ordered, manualRef.current, new Set(sources.map((s) => s.id)));
      setArticles(withPasted);

      // What each source delivered, for the status page.
      const heldBySource = new Map<string, number>();
      for (const article of ordered) {
        heldBySource.set(article.sourceId, (heldBySource.get(article.sourceId) ?? 0) + 1);
      }
      const runs: Parameters<typeof recordRuns>[1] = {};
      const at = Date.now();
      for (const result of data.results ?? []) {
        const sourceId = byUrl.get(result.feedUrl);
        if (!sourceId) continue;
        const list = (result.articles ?? []) as Article[];
        const newest = list.reduce((best, a) => Math.max(best, timeOf(a) || 0), 0);
        runs[sourceId] = {
          at,
          ok: result.ok !== false,
          fetched: list.length,
          held: heldBySource.get(sourceId) ?? 0,
          newest: newest || undefined,
          error: result.ok === false ? String(result.error ?? "Fetch failed") : undefined,
        };
      }
      setHealth((current) => {
        const next = recordRuns(current, runs, new Set(sources.map((source) => source.id)));
        saveHealth(next);
        return next;
      });
      // Also what the list falls back to with no connection.
      void saveListSnapshot(withPasted);
    } catch {
      // Offline or the feeds are unreachable: show what was last saved.
      const snapshot = await loadListSnapshot<Loaded>();
      if (snapshot && snapshot.length > 0) setArticles(snapshot);
    } finally {
      setRefreshing(false);
    }
  }, []);

  /**
   * Show the last list this device held while the feeds are still being
   * fetched. Every visit used to open on a blank screen for as long as the
   * slowest source took to answer — the articles were already on the device,
   * just not on screen. The stored copy is a placeholder only: it fills an
   * empty list and is then replaced by whatever comes back, so it can never
   * hide a fresher result or resurrect something a refresh has dropped.
   */
  useEffect(() => {
    if (!ready) return;
    let cancelled = false;
    void (async () => {
      const snapshot = await loadListSnapshot<Loaded>();
      if (cancelled || refreshed.current || !snapshot?.length) return;
      setArticles((current) => (current.length > 0 ? current : snapshot));
    })();
    return () => {
      cancelled = true;
    };
  }, [ready]);

  /**
   * A refresh that answers straight away needs no announcement — the list
   * simply updates. Only one that takes a moment gets a line saying so.
   */
  useEffect(() => {
    if (!refreshing) {
      setSlowRefresh(false);
      return;
    }
    const timer = setTimeout(() => setSlowRefresh(true), 600);
    return () => clearTimeout(timer);
  }, [refreshing]);

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
      scope: result.scope,
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
        feed.id === target && !feed.sources.some((s) => feedSourceKey(s.feedUrl) === feedSourceKey(source.feedUrl))
          ? { ...feed, sources: [...feed.sources, source] }
          : feed,
      );
    });
    // Adding a source a feed already has is not a duplicate; say so rather than doing nothing silently.
    const into = feedsRef.current.find((feed) => feed.id === target);
    const held = into?.sources.find((s) => feedSourceKey(s.feedUrl) === feedSourceKey(source.feedUrl));
    if (into && held) setPasteNotice({ kind: "error", text: `${held.title} is already in ${into.name}.` });
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
        const have = new Set(feed.sources.map((source) => feedSourceKey(source.feedUrl)));
        const fresh: Source[] = [];
        for (const source of made) {
          if (have.has(feedSourceKey(source.feedUrl))) continue;
          have.add(feedSourceKey(source.feedUrl));
          fresh.push(source);
        }
        return { ...feed, sources: [...feed.sources, ...fresh] };
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
    ({ kind, id, fromFeedId, toFeedId, targetSourceId, after }: DropAt) => {
      if (kind === "feed") {
        setFeeds((current) => placeFeed(current, id, toFeedId, after));
        return;
      }
      setFeeds((current) => placeSource(current, id, fromFeedId, toFeedId, targetSourceId, after));
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

  const [coloring, setColoring] = useState<string | null>(null);
  /** A highlight behind a feed's name; it syncs with the feed list. */
  function setFeedColor(id: string, color: FeedColor | null) {
    setFeeds((current) =>
      current.map((feed) => {
        if (feed.id !== id) return feed;
        const { color: _old, ...rest } = feed;
        void _old;
        return color ? { ...rest, color } : rest;
      }),
    );
    setColoring(null);
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

  /**
   * Re-read what the device is holding.
   *
   * Called on load and after each download run rather than kept in step by
   * hand: the store is written from several places — the reader caching an
   * article it just showed, the background top-up, the prune — and a list
   * that quietly disagreed with the store would be worse than no list.
   */
  const refreshDownloaded = useCallback(async () => {
    const [rows, bytes] = await Promise.all([storedArticles(), storedBytes()]);
    setDownloaded(rows);
    setDownloadedBytes(bytes);
  }, []);

  useEffect(() => {
    void refreshDownloaded();
  }, [refreshDownloaded]);

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
      const before = notesRef.current;
      const next = update(before);
      notesRef.current = next;
      setNotes(next);
      saveNotes(next);

      // Whatever is no longer there was deleted, whichever way it went — an
      // entry, or the note around it. Dated here in one place, because the
      // other device still holds it and would otherwise put it back.
      const surviving = new Set(next.flatMap(idsOf));
      const gone = before.flatMap(idsOf).filter((id) => !surviving.has(id));
      if (gone.length > 0) {
        const at = Date.now();
        const tombstones = [
          ...gone.map((id) => ({ id, at })),
          ...noteRemovalsRef.current.filter((removal) => !gone.includes(removal.id)),
        ];
        noteRemovalsRef.current = tombstones;
        setNoteRemovals(tombstones);
        saveNoteRemovals(tombstones);
      }

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

  /** Write one subject's board through, and let go of boards whose note is gone. */
  const commitBoard = useCallback(
    (noteId: string, update: (board: Board | undefined) => Board) => {
      const current = boardsRef.current;
      const live = new Set(notesRef.current.map((note) => note.id));
      const next = pruneBoards(
        { ...current, [noteId]: update(current[noteId]) },
        new Set(noteRemovalsRef.current.map((r) => r.id).filter((id) => !live.has(id))),
      );
      boardsRef.current = next;
      setBoards(next);
      saveBoards(next);
    },
    [],
  );

  const touchSubject = useCallback((id: string) => {
    setSubjectUsed((current) => {
      const next = { ...current, [id]: Date.now() };
      try {
        localStorage.setItem(SUBJECT_USED_KEY, JSON.stringify(next));
      } catch {
        /* order just won't persist */
      }
      return next;
    });
  }, []);

  /** Subjects, most recently opened or added to first; never used ones by creation. */
  const notesByUse = useMemo(
    () => [...notes].sort((a, b) => (subjectUsed[b.id] ?? 0) - (subjectUsed[a.id] ?? 0) || b.at - a.at),
    [notes, subjectUsed],
  );

  /** The article being read, added to a subject whole — no quote needed. */
  const addReadingToSubject = useCallback(
    (noteId: string) => {
      const link = reading?.url;
      if (!link) return;
      const known =
        articles.find((a) => a.link === link) ??
        savedRef.current.find((a) => a.link === link);
      const source = known?.sourceId
        ? allSources.find((entry) => entry.id === known.sourceId)
        : undefined;
      commitBoard(noteId, (board) =>
        // Onto the tab that is open in that subject.
        placeNew(addStory(board, {
            link,
            title: known?.title ?? reading?.title ?? link,
            source: source?.title,
            publishedAt: known?.publishedAt,
            author: known?.author,
          }), canonicalUrl(link)),
      );
      touchSubject(noteId);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [reading, articles, commitBoard, touchSubject],
  );

  /** The subjects a story is in — quoted there, or added to it whole. */
  const subjectsContaining = useCallback(
    (link: string) => {
      const key = canonicalUrl(link);
      return new Set(
        notes
          .filter((note) => cardsOf(note, boards[note.id]).some((card) => card.id === key))
          .map((note) => note.id),
      );
    },
    [notes, boards],
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

  /* ---------- the browser extension's inbox (lib/inbox.ts) ---------- */

  /**
   * File what the extension saved: the article into Saved with its text in
   * the offline store — the copy the reader's own browser read — and, when a
   * subject was chosen, the story or the selected quote (and a note under
   * it) into that subject. Then the inbox lets go of it.
   */
  const fileFromExtension = useCallback(
    (item: InboxItem) => {
      // A person from a profile page: into the chosen subject's contacts.
      if (item.contact) {
        const person = item.contact;
        let target = item.subjectId && notesRef.current.some((n) => n.id === item.subjectId) ? item.subjectId : undefined;
        if (!target && item.newSubject) target = createNote(item.newSubject);
        if (!target) return;
        const id = contactId(person.name);
        commitBoard(target, (board) => {
          const held = board?.[id];
          const prior = held && held.kind === "contact" && !held.deleted ? held : undefined;
          return putItem(board, {
            id,
            kind: "contact",
            name: prior?.name ?? person.name,
            role: person.role || prior?.role || "",
            why: prior?.why ?? "",
            refs: prior?.refs ?? [],
            origin: prior?.origin ?? "you",
            email: prior?.email,
            emailFrom: prior?.emailFrom,
            phone: prior?.phone,
            linkedin: person.linkedin ?? prior?.linkedin,
            photo: person.photo ?? prior?.photo,
            notes: [prior?.notes, item.note].filter(Boolean).join("\n") || undefined,
            state: "kept",
            at: Date.now(),
          });
        });
        touchSubject(target);
        return;
      }
      const article = item.article;
      if (!article.url) return;
      // Filed under the link the story already has here, if it has one —
      // from a feed, or saved before — so the reader finds this copy when it
      // opens that link, and the offline tidy-up, which keeps only the links
      // in the lists, does not take it for a stray and delete it.
      const key = canonicalUrl(article.url);
      const existing =
        savedRef.current.find((a) => canonicalUrl(a.link) === key) ?? articles.find((a) => canonicalUrl(a.link) === key);
      const link = existing?.link ?? article.url;
      void writeCached({ ...article, url: link }, link);
      if (!savedRef.current.some((a) => canonicalUrl(a.link) === canonicalUrl(link))) {
        const entry: SavedArticle = {
          id: `ext:${link}`,
          title: article.title,
          link,
          publishedAt: article.publishedAt,
          summary: article.excerpt,
          author: article.byline,
          sourceTitle: article.siteName,
          savedAt: Date.now(),
        };
        setSaved((current) => {
          const next = [entry, ...current.filter((a) => canonicalUrl(a.link) !== canonicalUrl(link))];
          saveSaved(next);
          return next;
        });
      }
      let noteId = item.subjectId && notesRef.current.some((n) => n.id === item.subjectId) ? item.subjectId : undefined;
      if (!noteId && item.newSubject) noteId = createNote(item.newSubject);
      if (!noteId) return;
      const target = noteId;
      const story = { link, title: article.title, source: article.siteName, publishedAt: article.publishedAt, author: article.byline };
      if (item.quote) {
        const quoteId = newId();
        commitNotes((current) =>
          appendQuote(current, target, {
            id: quoteId,
            kind: "quote",
            text: item.quote!,
            link,
            articleTitle: article.title,
            sourceTitle: article.siteName,
            publishedAt: article.publishedAt,
            author: article.byline,
            at: Date.now(),
          }),
        );
        commitBoard(target, (board) => placeNew(board, canonicalUrl(link)));
        if (item.note) {
          const note = notesRef.current.find((n) => n.id === target);
          const html = `<ul><li>${item.note.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")}</li></ul>`;
          if (note) commitBoard(target, (board) => addQuoteNote(note, board, quoteId, html));
        }
      } else {
        commitBoard(target, (board) => {
          let next = placeNew(addStory(board, story), canonicalUrl(link));
          if (item.note) {
            const id = canonicalUrl(link);
            const text = item.note.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
            next = putItem(next, { id: cardNoteId(id), kind: "cardnote", card: id, html: `<p>${text}</p>`, at: Date.now() });
          }
          return next;
        });
      }
      touchSubject(target);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [createNote, commitNotes, commitBoard, touchSubject, articles],
  );

  const checkInbox = useCallback(async () => {
    // Signed in, the inbox is the account's (the session is the key); otherwise an old code's.
    const code = accountId ? null : syncCode;
    if (!accountId && !code) return;
    try {
      const res = await fetch(`/api/inbox${code ? `?code=${encodeURIComponent(code)}` : ""}`, { cache: "no-store" });
      if (!res.ok) return;
      const data = (await res.json()) as { items?: InboxItem[] };
      const items = data.items ?? [];
      if (items.length === 0) return;
      for (const item of items) fileFromExtension(item);
      await fetch("/api/inbox", {
        method: "DELETE",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ...(code ? { code } : {}), ids: items.map((i) => i.id) }),
      });
      setPasteNotice({
        kind: "done",
        text:
          items.length === 1
            ? items[0].contact
              ? `Added ${items[0].contact.name} to contacts, from Chrome.`
              : `Saved from Chrome: ${items[0].article.title}`
            : `Saved ${items.length} items from Chrome.`,
      });
    } catch {
      /* the next visit tries again */
    }
  }, [syncCode, accountId, fileFromExtension]);

  // Collected on arrival and whenever the window comes back into view.
  useEffect(() => {
    if (!ready || (!syncCode && !accountId)) return;
    void checkInbox();
    const onFocus = onFocusEvery(() => void checkInbox(), { current: Date.now() });
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [ready, syncCode, accountId, checkInbox]);

  // The extension offers subjects by name; leave it the current list.
  const subjectIndex = useMemo(() => JSON.stringify(notes.map((n) => ({ id: n.id, name: n.name }))), [notes]);
  useEffect(() => {
    if (!ready || (!syncCode && !accountId)) return;
    const timer = setTimeout(() => {
      void fetch("/api/inbox", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ...(accountId ? {} : { code: syncCode }), subjects: JSON.parse(subjectIndex) }),
      }).catch(() => {});
    }, 2000);
    return () => clearTimeout(timer);
  }, [ready, syncCode, accountId, subjectIndex]);

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
      const entryId = newId();

      const known =
        articles.find((a) => a.link === link) ??
        savedRef.current.find((a) => a.link === link);
      const source = known?.sourceId
        ? allSources.find((entry) => entry.id === known.sourceId)
        : undefined;
      const title = known?.title ?? reading?.title ?? link;

      commitNotes((current) =>
        appendQuote(current, noteId, {
          id: entryId,
          kind: "quote",
          text,
          link,
          articleTitle: title,
          sourceTitle: source?.title ?? (known as SavedArticle | undefined)?.sourceTitle,
          publishedAt: known?.publishedAt,
          author: known?.author,
          at: Date.now(),
        }),
      );
      // A new story quoted into a subject lands on the tab open there.
      commitBoard(noteId, (board) => placeNew(board, canonicalUrl(link)));

      if (savedRef.current.some((a) => a.link === link)) return entryId;
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
      return entryId;
    },
    [reading, articles, allSources, commitNotes],
  );

  /**
   * Send a quote to a different note — what the "Added to…" bubble offers
   * straight after filing one, when it went to the wrong place. A move, not a
   * copy: the entry keeps its id, so nothing counts it as deleted and the
   * article it holds stays saved.
   */
  const moveQuote = useCallback(
    (entryId: string, toNoteId: string) => {
      commitNotes((current) => moveEntry(current, entryId, toNoteId));
    },
    [commitNotes],
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

  /**
   * Set below, where the alert logic lives. Reading an article counts as
   * having seen its source, and openArticle is defined before that code.
   */
  const clearAlertsRef = useRef<(sourceIds: string[]) => void>(() => {});

  const openArticle = useCallback(
    (article: Loaded, feedUrl?: string) => {
      markRead(article.id);
      if (article.sourceId) clearAlertsRef.current([article.sourceId]);
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

  /*
   * Settings and API keys follow the Google account: a new device, or one
   * whose browser data was cleared, gets them back on signing in. Each half
   * is stamped when changed here; the more recent copy wins.
   */
  const settingStamps = useRef<Stamps>({});
  const keyStamps = useRef<Stamps>({});
  const vaultAt = useRef(0);
  const settingsRef = useRef(settings);
  settingsRef.current = settings;
  const vaultRef = useRef<unknown>(null);
  vaultRef.current = vault;
  const prefsSynced = useRef(0);
  useEffect(() => {
    const stored = loadSettings() as unknown as Record<string, unknown>;
    const defaults = DEFAULT_SETTINGS as unknown as Record<string, unknown>;
    settingStamps.current = loadStamps(
      SETTING_STAMPS,
      SETTINGS_AT,
      Object.keys(stored).filter((field) => JSON.stringify(stored[field]) !== JSON.stringify(defaults[field])),
    );
    keyStamps.current = loadStamps(KEY_STAMPS, KEYS_AT, Object.keys(loadUnlockedKeys()));
    let vaultStamp = 0;
    try {
      vaultStamp = Number(localStorage.getItem(VAULT_AT)) || (loadVault() ? Number(localStorage.getItem(KEYS_AT)) || 1 : 0);
    } catch {
      /* none */
    }
    vaultAt.current = vaultStamp;
  }, []);
  const syncAccountPrefs = useCallback(async () => {
    prefsSynced.current = Date.now();
    try {
      const res = await fetch("/api/account/prefs", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          settings: settingsRef.current,
          settingStamps: settingStamps.current,
          keys: apiKeysRef.current,
          keyStamps: keyStamps.current,
          ...(vaultRef.current ? { vault: vaultRef.current, vaultAt: vaultAt.current } : {}),
        }),
      });
      if (!res.ok) return;
      const { prefs } = (await res.json()) as { prefs?: AccountPrefs };
      if (!prefs) return;
      // The vault comes back to a device that lost it, or takes a newer one.
      if (prefs.vault && JSON.stringify(prefs.vault) !== JSON.stringify(vaultRef.current) && (!vaultRef.current || vaultStampOf(prefs) > vaultAt.current)) {
        vaultRef.current = prefs.vault;
        setVault(prefs.vault);
        saveVault(prefs.vault);
        vaultAt.current = vaultStampOf(prefs);
        saveStamps(VAULT_AT, vaultAt.current);
      }
      // Each setting and key the account holds a newer copy of, one at a time.
      const took = takeFromAccount(
        { settings: settingsRef.current as unknown as Record<string, unknown>, settingStamps: settingStamps.current, keys: apiKeysRef.current, keyStamps: keyStamps.current },
        prefs,
      );
      if (took.settings) {
        const next = { ...DEFAULT_SETTINGS, ...(took.settings as Partial<Settings>) };
        settingsRef.current = next;
        setSettings(next);
        saveSettings(next);
      }
      settingStamps.current = took.settingStamps;
      saveStamps(SETTING_STAMPS, took.settingStamps);
      if (took.keys) {
        apiKeysRef.current = took.keys;
        setApiKeys(took.keys);
        saveUnlockedKeys(took.keys);
      }
      keyStamps.current = took.keyStamps;
      saveStamps(KEY_STAMPS, took.keyStamps);
    } catch {
      /* tried again on the next change or visit */
    }
  }, []);
  // On signing in, after a change here, and on coming back to the tab (every few minutes at most).
  useEffect(() => {
    if (!ready || !auth.account) return;
    void syncAccountPrefs();
    const onFocus = () => Date.now() - prefsSynced.current > FOCUS_CHECK_MS && void syncAccountPrefs();
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [ready, auth.account, syncAccountPrefs]);
  const [prefsBump, setPrefsBump] = useState(0);
  useEffect(() => {
    if (!prefsBump || !auth.account) return;
    const timer = setTimeout(() => void syncAccountPrefs(), 1000);
    return () => clearTimeout(timer);
  }, [prefsBump, auth.account, syncAccountPrefs]);
  /** Date each name whose value differs between two copies: a change, an addition, or a removal. */
  function stampChanged(stamps: { current: Stamps }, key: string, before: Record<string, unknown>, after: Record<string, unknown>) {
    const now = Date.now();
    let changed = false;
    for (const name of new Set([...Object.keys(before), ...Object.keys(after)])) {
      if (JSON.stringify(before[name]) === JSON.stringify(after[name])) continue;
      stamps.current = { ...stamps.current, [name]: Math.max(now, (stamps.current[name] ?? 0) + 1) };
      changed = true;
    }
    if (!changed) return;
    saveStamps(key, stamps.current);
    setPrefsBump((n) => n + 1);
  }

  /** Keys changed: keep the device copy, the vault, and the feeds in step. */
  function updateKeys(next: { vault: unknown | null; keys: Record<string, string> }) {
    stampChanged(keyStamps, KEY_STAMPS, apiKeysRef.current, next.keys);
    if (JSON.stringify(next.vault ?? null) !== JSON.stringify(vaultRef.current ?? null)) {
      vaultAt.current = Math.max(Date.now(), vaultAt.current + 1);
      saveStamps(VAULT_AT, vaultAt.current);
      setPrefsBump((n) => n + 1);
    }
    apiKeysRef.current = next.keys;
    setVault(next.vault);
    setApiKeys(next.keys);
    saveVault(next.vault);
    saveUnlockedKeys(next.keys);
    // An API source that was failing for want of a key should now work.
    void refresh(allSources);
  }

  function updateSettings(next: Settings) {
    // Turning Subjects on or off, or choosing an AI, is a choice for every
    // device — but only when this change actually makes it. Changing the
    // sort, say, must not re-broadcast whatever this device happens to hold
    // for Subjects: a device whose copy was stale used to switch Subjects off
    // everywhere that way (3 Oct 2026).
    const madeChoice = !sameSharedPrefs(sharedPrefsOf(settings, 0), next);
    const settled = madeChoice
      ? next
      : { ...next, subjects: prefsRef.current.subjects, aiProvider: prefsRef.current.aiProvider, openaiModel: prefsRef.current.openaiModel, anthropicModel: prefsRef.current.anthropicModel,
          anthropicQuickModel: prefsRef.current.anthropicQuickModel, openaiQuickModel: prefsRef.current.openaiQuickModel };
    stampChanged(settingStamps, SETTING_STAMPS, settingsRef.current as unknown as Record<string, unknown>, settled as unknown as Record<string, unknown>);
    settingsRef.current = settled;
    setSettings(settled);
    saveSettings(settled);
    if (madeChoice) {
      const stamped = sharedPrefsOf(next, Math.max(Date.now(), prefsRef.current.at + 1));
      prefsRef.current = stamped;
      setPrefs(stamped);
      saveSharedPrefs(stamped);
    }
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

  /**
   * What is on the device, as list rows.
   *
   * Read from the offline store rather than filtered out of the feed: an
   * article stays downloaded long after it falls out of the window its source
   * shows, and the point of this list is to answer "what can I read on the
   * train" exactly. `sourceId` is matched back where the source is still
   * followed, so rows keep their outlet name and favicon.
   */
  const downloadedAsArticles = useMemo<Loaded[]>(() => {
    const byHost = new Map<string, string>();
    for (const source of allSources) {
      try {
        byHost.set(new URL(source.siteUrl || source.feedUrl).hostname, source.id);
      } catch {
        /* a source with no usable URL simply lends no name */
      }
    }
    return downloaded.map((row) => {
      let sourceId = "";
      try {
        sourceId = byHost.get(new URL(row.link).hostname) ?? "";
      } catch {
        /* keep it unattributed */
      }
      return {
        id: `offline:${row.url}`,
        title: row.title,
        link: row.link,
        publishedAt: row.publishedAt,
        summary: row.excerpt,
        sourceId,
      };
    });
  }, [downloaded, allSources]);

  /** A team feed's articles, in the same shape the list renders. */
  const teamAsArticles = useCallback(
    (code: string): Loaded[] =>
      (teamArticles[code] ?? []).map((article) => ({ ...article, sourceId: "" })),
    [teamArticles],
  );

  /** "Added by you": pasted stories no followed source covers. */
  const manualAsArticles = useMemo(() => {
    const following = new Set(allSources.map((source) => source.id));
    return liveManual(manual)
      .filter((story) => !story.sourceId || !following.has(story.sourceId))
      .map((story) => pastedAsLoaded(story, ""));
  }, [manual, allSources]);

  const visible = useMemo(() => {
    if (selection.type === "all") return articles;
    if (selection.type === "saved") return savedAsArticles;
    if (selection.type === "manual") return manualAsArticles;
    if (selection.type === "downloaded") return downloadedAsArticles;
    // Notifications is its own view, not a list of articles.
    if (selection.type === "alerts" || selection.type === "status" || selection.type === "spend" || selection.type === "subjects") return [];
    if (selection.type === "team") return teamAsArticles(selection.id);
    if (selection.type === "source") {
      return articles.filter((a) => a.sourceId === selection.id);
    }
    const feed = feeds.find((f) => f.id === selection.id);
    const ids = new Set(feed?.sources.map((s) => s.id));
    return articles.filter((a) => ids.has(a.sourceId));
  }, [articles, feeds, selection, savedAsArticles, downloadedAsArticles, teamAsArticles, manualAsArticles]);

  /**
   * What is marked in the article being read: its own highlights, and every
   * quote any subject took from it, with what was written under that quote
   * as a comment for the margin.
   */
  const readingMarks = useMemo<ArticleMark[]>(() => {
    if (!reading) return [];
    const key = canonicalUrl(reading.url);
    const marks: ArticleMark[] = highlightsFor(highlights, reading.url).map((h) => ({ id: h.id, text: h.text, kind: "highlight" }));
    for (const note of notes) {
      for (const entry of note.entries) {
        if (entry.kind !== "quote" || canonicalUrl(entry.link) !== key) continue;
        marks.push({
          id: entry.id,
          text: entry.text,
          kind: "quote",
          noteId: note.id,
          noteName: note.name,
          comments: settings.subjects ? quoteNotesFor(note, boards[note.id], entry.id) : [],
        });
      }
    }
    return marks;
  }, [reading, highlights, notes, boards, settings.subjects]);

  /** What the device knows of a story — for the byline on a subject's card. */
  const articleMetaMap = useMemo(() => {
    const map = new Map<string, { publishedAt?: string; author?: string; source?: string }>();
    for (const article of [...manualAsArticles, ...downloadedAsArticles, ...savedAsArticles, ...articles]) {
      const key = canonicalUrl(article.link);
      const held = map.get(key) ?? {};
      map.set(key, {
        publishedAt: held.publishedAt ?? article.publishedAt,
        author: held.author ?? article.author,
        source: held.source ?? (article as { sourceTitle?: string }).sourceTitle,
      });
    }
    return map;
  }, [articles, savedAsArticles, downloadedAsArticles, manualAsArticles]);
  const articleMeta = useCallback((link: string) => articleMetaMap.get(canonicalUrl(link)), [articleMetaMap]);

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

    /*
     * Never queue a host that has already been measured as refusing a request
     * from this app's server (lib/subscriptions.ts). Asking is not free: each
     * one is a function invocation that fetches, fails, and falls back twice
     * before answering 502 — fifteen articles a source, on every visit.
     */
    // Subjects marked "available offline" keep every story they cite.
    const subjectStories: OfflineTarget[] = [];
    for (const note of notes) {
      if (!metaOf(boards[note.id]).offline) continue;
      for (const card of cardsOf(note, boards[note.id])) {
        subjectStories.push({ url: card.link, title: card.title });
      }
    }

    return [...subjectStories, ...bookmarks, ...[...perSource.values()].flat()].filter(
      (target) => {
        try {
          return !knownRefusal(new URL(target.url).hostname);
        } catch {
          return true;
        }
      },
    );
  }, [articles, sourceById, saved, notes, boards]);

  const runDownload = useCallback(async () => {
    if (downloading.current) return;
    const links = offlineTargets();
    if (links.length === 0) return;

    downloading.current = true;
    setOffline({ state: "working", done: 0, total: links.length });
    try {
      /**
       * Topping up the offline copy can run to a couple of hundred articles,
       * and reporting every one of them was a render of the reader per
       * article — a background job making the foreground slow. The counter is
       * a progress note, so it is worth a redraw every quarter second and no
       * more; the last one always lands, whatever the clock says.
       */
      let told = 0;
      const result = await downloadForOffline(
        links,
        ({ saved, ...progress }) => {
          const now = Date.now();
          if (progress.done === progress.total || now - told > 250) {
            told = now;
            setOffline({ state: "working", ...progress });
          }
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
      void refreshDownloaded();
      setOffline({ state: "done", at: await lastDownloadedAt(), result });
    } catch {
      setOffline({ state: "error" });
    } finally {
      downloading.current = false;
    }
  }, [offlineTargets, markSaved, refreshDownloaded]);

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

    /**
     * Not straight away. This competes with the refresh for the network and
     * with the first render for the main thread, and the reader is reading —
     * a second and a half puts the top of the list on screen and answering
     * before the topping-up starts.
     */
    const settle = setTimeout(check, 1500);
    const onVisible = () => {
      if (document.visibilityState === "visible") void check();
    };
    window.addEventListener("focus", check);
    window.addEventListener("online", check);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      cancelled = true;
      clearTimeout(settle);
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
    /*
     * Hide-read triages a feed; it has no business emptying the keep-list.
     * Saved is where an article was deliberately put so it would still be
     * there later, and the read mark that would hide it often arrives from
     * another device — so the computer that synced showed one of five
     * bookmarks, while the badge beside it, counting the list itself, said
     * five.
     */
    const hideRead =
      settings.hideRead &&
      selection.type !== "saved" &&
      selection.type !== "downloaded";
    const list = hideRead ? visible.filter((a) => !read.has(a.id)) : visible;

    if (settings.sort !== "top") {
      /*
       * "Newest" sorts. It used to assume, handing back whatever order the
       * list arrived in, which was right only because every list happened to
       * be built newest-first — until one was not. The offline store is
       * ordered by when each article was *downloaded*, so On this device came
       * out in the order the top-up happened to fetch things, which is not a
       * publication order and is not what the control says.
       *
       * Saved keeps its own order: it is newest-*saved* first by design
       * (lib/saved.ts), because what you just put there is what you are
       * looking for. Undated articles sort last and, the sort being stable,
       * hold whatever order they came in.
       */
      return selection.type === "saved" ? list : sortNewestFirst(list);
    }
    // Ranked first, by score; everything else keeps its date order below,
    // which is what an unranked story deserves — not a guess at a score.
    return [...list].sort((a, b) => {
      const scoreA = ranking.get(a.id)?.score ?? -1;
      const scoreB = ranking.get(b.id)?.score ?? -1;
      return scoreB - scoreA || timeOf(b) - timeOf(a);
    });
  }, [visible, settings.hideRead, settings.sort, selection.type, read, ranking]);

  /**
   * How much of the list is actually rendered.
   *
   * A source now carries up to 250 articles (app/api/feed), so a dozen
   * sources is a few thousand — and rendering all of them meant 48,000 DOM
   * nodes, three seconds before the first headline appeared on a desktop, and
   * a phone that stopped answering taps whenever a refresh landed, because
   * every arriving article re-rendered the whole pile. Nothing scrolls past
   * the first screenful before it is asked for, so only a screenful and a
   * margin is built, and more is appended as the reader reaches the end.
   *
   * The list itself is untouched: `shown` is still the whole thing, which is
   * what the counts, the ranking and the offline copy are made from.
   */
  const [rendered, setRendered] = useState(PAGE);
  const tail = useRef<HTMLDivElement | null>(null);

  const inView = useMemo(() => shown.slice(0, rendered), [shown, rendered]);
  const more = shown.length > inView.length;

  // A different list starts at its own beginning, not part-way down the last
  // one's depth.
  const listKey = `${selection.type}:${"id" in selection ? selection.id : ""}:${settings.sort}:${settings.hideRead}`;
  useEffect(() => {
    setRendered(PAGE);
  }, [listKey]);

  /**
   * Grow the rendered list as its end comes into view. The sentinel sits a
   * long way below the fold, so the next batch is built before the reader
   * arrives at it and the scroll never stops at a seam.
   */
  useEffect(() => {
    const sentinel = tail.current;
    const root = listRef.current;
    if (!sentinel || !root || !more) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setRendered((count) => count + PAGE);
        }
      },
      { root, rootMargin: "1200px 0px" },
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [more, inView.length]);

  /** The article whose score page is open, with its ranking. */
  const explainRank = useMemo(() => {
    if (!explaining) return null;
    const rank = ranking.get(explaining);
    const article = articles.find((entry) => entry.id === explaining);
    return rank && article ? { rank, title: article.title } : null;
  }, [explaining, ranking, articles]);

  /**
   * Whether this list is still being fetched, as opposed to genuinely empty.
   * A shared feed has not been asked for until its code appears in the map,
   * so an unfetched one used to read as "nothing shared yet".
   */
  const pending =
    selection.type === "team"
      ? teamArticles[selection.id] === undefined
      : refreshing;

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

  /** Articles grouped by source, for working out what is unread per source. */
  const bySource = useMemo(() => {
    const groups = new Map<string, Loaded[]>();
    for (const article of articles) {
      const list = groups.get(article.sourceId) ?? [];
      list.push(article);
      groups.set(article.sourceId, list);
    }
    return groups;
  }, [articles]);

  const watchedSources = useMemo(
    () => allSources.filter((source) => source.notify),
    [allSources],
  );

  /** One entry per watched source with posts newer than its mark. */
  const alerts = useMemo(
    () => alertsFor(watchedSources, bySource, watchMarks),
    [watchedSources, bySource, watchMarks],
  );
  const alertBySource = useMemo(
    () => new Map(alerts.map((alert) => [alert.sourceId, alert])),
    [alerts],
  );
  const alertTotal = alerts.reduce((sum, alert) => sum + alert.articles.length, 0);

  const persistMarks = useCallback((next: WatchMarks) => {
    setWatchMarks(next);
    saveWatchMarks(next);
  }, []);

  /**
   * Mark a watched source as looked at. Called from every route by which
   * someone can be said to have seen it — opening the source, opening the
   * feed it sits in, reading one of its articles, or acknowledging it in
   * Notifications — because a badge that outlives the reading is worse than
   * no badge at all.
   */
  const clearAlerts = useCallback(
    (sourceIds: string[]) => {
      if (sourceIds.length === 0) return;
      setWatchMarks((current) => {
        let next = current;
        let changed = false;
        for (const sourceId of sourceIds) {
          const source = allSources.find((entry) => entry.id === sourceId);
          if (!source?.notify) continue;
          const updated = acknowledge(next, sourceId, bySource.get(sourceId) ?? []);
          if (updated !== next) {
            next = updated;
            changed = true;
          }
        }
        if (changed) saveWatchMarks(next);
        return next;
      });
    },
    [allSources, bySource],
  );

  /**
   * Turn watching on or off for one source.
   *
   * Whether this is switching on is decided from the state as it stands, not
   * from a flag set inside the setFeeds updater: React runs that updater
   * during the render that follows, so the flag was still false by the time
   * it was read, and the starting mark was never written. The badge then lit
   * up for every post already in the feed.
   */
  const toggleNotify = useCallback(
    (feedId: string, sourceId: string) => {
      const source = feedsRef.current
        .find((feed) => feed.id === feedId)
        ?.sources.find((entry) => entry.id === sourceId);
      if (!source) return;
      const turningOn = !source.notify;

      setFeeds((current) =>
        current.map((feed) =>
          feed.id !== feedId
            ? feed
            : {
                ...feed,
                sources: feed.sources.map((entry) =>
                  entry.id === sourceId ? { ...entry, notify: turningOn } : entry,
                ),
              },
        ),
      );

      // Start the mark at what is already there, so turning notifications on
      // announces the next post rather than the last forty.
      if (turningOn) {
        setWatchMarks((current) => {
          const next = {
            ...current,
            [sourceId]: markFrom(bySource.get(sourceId) ?? []),
          };
          saveWatchMarks(next);
          return next;
        });
      }
    },
    [bySource],
  );

  useEffect(() => {
    clearAlertsRef.current = clearAlerts;
  }, [clearAlerts]);

  const commitHighlights = useCallback((update: (current: Highlights) => Highlights) => {
    const next = update(highlightsRef.current);
    highlightsRef.current = next;
    setHighlights(next);
    saveHighlights(next);
  }, []);

  /** Back to the first headline. */
  const commitManual = useCallback((update: (current: ManualStories) => ManualStories) => {
    const next = update(manualRef.current);
    manualRef.current = next;
    setManual(next);
    saveManual(next);
  }, []);

  /**
   * The sidebar's Paste story: whatever link is on the clipboard becomes a
   * story in reader view. One the reader already has is simply opened; a new
   * one is filed under the followed source it comes from, or into "Added by
   * you" when no source covers it.
   */
  const pasteStory = useCallback(async () => {
    let text = "";
    try {
      text = await navigator.clipboard.readText();
    } catch {
      // No clipboard permission (or no clipboard API): ask instead.
      text = window.prompt("Paste a link to a story") ?? "";
    }
    const link = linkIn(text);
    if (!link) {
      setPasteNotice({
        kind: "error",
        text: text.trim() ? "That isn’t a link to a story." : "Nothing to paste — copy a story’s link first.",
      });
      return;
    }
    const key = manualKey(link);

    // Already here: open it where it is.
    const held = articles.find((article) => canonicalUrl(article.link) === key);
    if (held) {
      const source = sourceById.get(held.sourceId);
      openArticle(held, source?.feedUrl);
      setPasteNotice({ kind: "done", text: `Already in ${source?.title ?? "your list"} — opened it.` });
      return;
    }
    const kept =
      savedRef.current.find((article) => canonicalUrl(article.link) === key) ??
      (manualRef.current[key] && !manualRef.current[key].deleted ? manualRef.current[key] : null);
    if (kept) {
      setReading({ url: kept.link, title: kept.title, summary: kept.summary });
      setPasteNotice({ kind: "done", text: "You already have this one — opened it." });
      return;
    }

    setPasteNotice({ kind: "busy", text: "Reading the story…" });
    let data: { title?: string; url?: string; excerpt?: string; html?: string; publishedAt?: string; siteName?: string; via?: string } | null = null;
    let refusal: string | null = null;
    try {
      const res = await fetch(`/api/article?url=${encodeURIComponent(link)}&x=${EXTRACT_VERSION}`, { headers: keyHeaders });
      const body = await res.json().catch(() => null);
      if (res.ok) data = body;
      else refusal = body?.error ?? null;
    } catch {
      data = null;
    }
    // A site that will not hand its page to an app still has a story at that
    // address: keep it under the title its address spells out, to be read on
    // the site, rather than refusing the paste.
    let unreadable = false;
    if (!data?.title) {
      const guessed = titleFromUrl(link);
      if (!guessed) {
        setPasteNotice({ kind: "error", text: refusal ?? "Couldn’t read that page as a story." });
        return;
      }
      let host = "";
      try {
        host = new URL(link).hostname.replace(/^www\./, "");
      } catch {
        /* no host to name */
      }
      data = { title: guessed, url: link, siteName: host || undefined };
      unreadable = true;
    }
    // A site's front page is a source to follow, not a story to read.
    let path = "/";
    try {
      path = new URL(data.url || link).pathname;
    } catch {
      /* treat as a front page */
    }
    if (path === "/" || path === "") {
      setPasteNotice({ kind: "error", text: "That’s a site’s front page, not a story — use New feed to follow it." });
      return;
    }

    const source = sourceFor(link, allSources);
    const image = data.html?.match(/<img[^>]+src="(https?:[^"]+)"/i)?.[1];
    const story: ManualStory = {
      link,
      title: data.title ?? link,
      summary: data.excerpt,
      image,
      publishedAt: data.publishedAt,
      siteName: data.siteName,
      sourceId: source?.id,
      at: Date.now(),
    };
    commitManual((current) => ({ ...current, [key]: story }));
    if (source) {
      setArticles((current) => {
        const next = sortNewestFirst([
          pastedAsLoaded(story, source.id),
          ...current.filter((article) => canonicalUrl(article.link) !== key),
        ]);
        void saveListSnapshot(next);
        return next;
      });
    }
    setReading({ url: link, title: story.title, feedUrl: source?.feedUrl, summary: story.summary });
    setPasteNotice({
      kind: "done",
      text: unreadable
        ? `Saved — ${data.siteName ?? "this site"} doesn’t let apps read its articles, so it opens on the site.`
        : source
          ? `Filed under ${source.title}.`
          : "Added to “Added by you”.",
    });
  }, [articles, sourceById, openArticle, keyHeaders, allSources, commitManual]);

  useEffect(() => {
    if (!pasteNotice || pasteNotice.kind === "busy") return;
    const timer = setTimeout(() => setPasteNotice(null), 5000);
    return () => clearTimeout(timer);
  }, [pasteNotice]);

  const scrollToTop = useCallback(() => {
    listRef.current?.scrollTo({ top: 0, behavior: "auto" });
  }, []);

  // The article open in this tab, so a refresh reopens it. Its arrival
  // highlight is left out: that was for the moment it was first opened.
  useEffect(() => {
    if (!ready) return;
    try {
      if (reading) {
        const { url, title, feedUrl, summary } = reading;
        sessionStorage.setItem(READING_KEY, JSON.stringify({ url, title, feedUrl, summary }));
      } else sessionStorage.removeItem(READING_KEY);
    } catch {
      /* storage unavailable */
    }
  }, [reading, ready]);

  // Remember an open subject for this tab, so a refresh lands back on it.
  useEffect(() => {
    if (!ready) return;
    try {
      if (selection.type === "note" || selection.type === "subjects") sessionStorage.setItem(VIEW_KEY, JSON.stringify(selection));
      else sessionStorage.removeItem(VIEW_KEY);
    } catch {
      /* storage unavailable */
    }
  }, [selection, ready]);

  const choose = useCallback(
    (next: Selection) => {
      setSelection(next);
      if (next.type === "note") touchSubject(next.id);
      setMenuOpen(false);
      setTeamMenu(null);
      // Navigating to a source — or to the feed holding it — counts as having
      // seen it. "All articles" deliberately does not: it is the default
      // view, and clearing there would mean never seeing a badge at all.
      if (next.type === "source") clearAlerts([next.id]);
      if (next.type === "feed") {
        const feed = feedsRef.current.find((entry) => entry.id === next.id);
        clearAlerts((feed?.sources ?? []).map((source) => source.id));
      }
      // Picking a feed means going back to the list; staying in the article you
      // were reading made the sidebar look unresponsive.
      setReading(null);
      setExplaining(null);
      // A new feed starts at its own top, not at whatever scroll position the
      // last one was left at — which on a long list meant landing in the
      // middle of a feed you had just opened.
      scrollToTop();
    },
    [touchSubject, scrollToTop, clearAlerts],
  );
  /** Back from a page opened in Settings: to Settings, over what was showing before. */
  const backToSettings = useCallback(() => {
    choose(beforeSettingsPage.current);
    setSettingsOpen(true);
  }, [choose]);


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
      const next = Math.min(travelled * 0.45, PULL_TRIGGER * 1.6);
      // A touchmove arrives every few milliseconds, and each one that changes
      // this re-renders the list. Rounded to four pixels, which is under what
      // the eye can see move and a fraction of the renders.
      setPullDistance((current) => (Math.abs(next - current) >= 4 ? next : current));
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
      : selection.type === "saved" ||
          selection.type === "manual" ||
          selection.type === "downloaded" ||
          selection.type === "alerts" ||
          selection.type === "status" ||
          selection.type === "spend" ||
          selection.type === "subjects" ||
          selection.type === "team"
        ? 0
        : selection.type === "source"
          ? 1
          : (feeds.find((f) => f.id === selection.id)?.sources.length ?? 0);

  const heading =
    selection.type === "all"
      ? "All articles"
      : selection.type === "saved"
        ? "Saved"
        : selection.type === "manual"
          ? "Added by you"
        : selection.type === "downloaded"
          ? "On this device"
        : selection.type === "alerts"
          ? "Notifications"
          : selection.type === "team"
            ? (teams.find((team) => team.code === selection.id)?.name ?? "Team")
            : selection.type === "status" || selection.type === "spend" || selection.type === "subjects"
              ? selection.type === "status" ? "Source status" : selection.type === "spend" ? "AI spending" : "Subjects"
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

  /** A subject open and its page on screen: the only place the sidebar tucks away. */
  const focusSubject = sidebarHidden && !!openNote && settings.subjects && !reading && !subjectsLocked;

  return (
    <div className={`app${focusSubject ? " sidebar-collapsed" : ""}`}>
      <aside className={`sidebar ${menuOpen ? "open" : ""}`}>
        <div className="brand">
          {Icon.logo} Super Reader
        </div>

        <div className="sidebar-scroll">
          <button
            className="paste-btn"
            onClick={() => void pasteStory()}
            disabled={pasteNotice?.kind === "busy"}
            title="Open the story whose link is on your clipboard"
          >
            {Icon.plus} Paste story
          </button>
          {fullWarning}
          {pasteNotice && (
            <p className={`paste-notice ${pasteNotice.kind}`} role="status">
              {pasteNotice.text}
            </p>
          )}
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

          {manualAsArticles.length > 0 && (
            <button
              className={`nav-item ${selection.type === "manual" ? "active" : ""}`}
              onClick={() => choose({ type: "manual" })}
              title="Stories you pasted in that none of your sources carry"
            >
              {Icon.plus}
              <span className="feed-name">Added by you</span>
              <span className="count">{manualAsArticles.length}</span>
            </button>
          )}

          <button
            className={`nav-item ${selection.type === "downloaded" ? "active" : ""}`}
            onClick={() => choose({ type: "downloaded" })}
            title="Articles stored on this device, readable with no connection"
          >
            {Icon.download}
            <span className="feed-name">On this device</span>
            <span className="count">{downloaded.length || ""}</span>
          </button>

          {/* Only worth a row once something is being watched. */}
          {watchedSources.length > 0 && (
            <button
              className={`nav-item ${selection.type === "alerts" ? "active" : ""}${
                alertTotal > 0 ? " has-alerts" : ""
              }`}
              onClick={() => choose({ type: "alerts" })}
            >
              {alertTotal > 0 ? Icon.bellOn : Icon.bell}
              <span className="feed-name">Notifications</span>
              <span className="count alert-count">{alertTotal || ""}</span>
            </button>
          )}

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
          {/* One entry leads to every subject. */}
          {(
            <button
              className={`nav-item ${selection.type === "subjects" || selection.type === "note" ? "active" : ""}`}
              onClick={() => choose({ type: "subjects" })}
            >
              {Icon.note}
              <span className="feed-name">Subjects</span>
              <span className="count">{notes.length || ""}</span>
            </button>
          )}

          {feeds.map((feed) => {
            const ids = new Set(feed.sources.map((s) => s.id));
            const count = unread(articles.filter((a) => ids.has(a.sourceId)));
            return (
              <div
                className={`feed-group${
                  drag?.kind === "source" && drag.overFeedId === feed.id && !drag.overSourceId && drag.fromFeedId !== feed.id
                    ? " drop-target"
                    : ""
                }${
                  drag?.kind === "feed" && drag.overFeedId === feed.id && drag.sourceId !== feed.id
                    ? drag.after ? " drop-after" : " drop-before"
                    : ""
                }${drag?.kind === "feed" && drag.sourceId === feed.id ? " dragging" : ""}`}
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
                        className="drag-grip feed-grip"
                        aria-label={`Move ${feed.name} up or down (arrow keys work too)`}
                        title="Drag to move this feed up or down"
                        onPointerDown={(event) => onPointerDown(event, { id: feed.id, title: feed.name }, feed.id, "feed")}
                        onPointerMove={onPointerMove}
                        onPointerUp={onPointerUp}
                        onPointerCancel={onPointerCancel}
                        onClick={(event) => event.preventDefault()}
                        onKeyDown={(event) => {
                          if (event.key !== "ArrowUp" && event.key !== "ArrowDown") return;
                          event.preventDefault();
                          const at = feeds.findIndex((f) => f.id === feed.id);
                          const other = feeds[event.key === "ArrowUp" ? at - 1 : at + 1];
                          if (other) setFeeds((current) => placeFeed(current, feed.id, other.id, event.key === "ArrowDown"));
                        }}
                      >
                        {Icon.grip}
                      </button>
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
                        <span className={`feed-name${isFeedColor(feed.color) ? ` feed-hl feed-hl-${feed.color}` : ""}`}>{feed.name}</span>
                        <span className="count">{count || ""}</span>
                      </button>
                      <button
                        className={`icon-btn feed-color-btn${isFeedColor(feed.color) ? ` feed-hl-${feed.color}` : ""}`}
                        onClick={() => setColoring(coloring === feed.id ? null : feed.id)}
                        aria-label={`Colour for ${feed.name}`}
                        aria-expanded={coloring === feed.id}
                        title="Highlight colour"
                      >
                        <span className="feed-color-dot" />
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

                {coloring === feed.id && (
                  <div className="feed-palette" role="group" aria-label={`Colour for ${feed.name}`}>
                    {FEED_COLORS.map((color) => (
                      <button
                        key={color}
                        className={`feed-swatch feed-hl-${color}${feed.color === color ? " on" : ""}`}
                        aria-label={color}
                        aria-pressed={feed.color === color}
                        onClick={() => setFeedColor(feed.id, color)}
                      />
                    ))}
                    <button className="feed-swatch none" aria-label="No colour" aria-pressed={!feed.color} onClick={() => setFeedColor(feed.id, null)}>
                      {Icon.close}
                    </button>
                  </div>
                )}

                {!collapsed.has(feed.id) && feed.sources.length === 0 && (
                  <div className="empty-hint">No sources yet</div>
                )}

                {!collapsed.has(feed.id) &&
                  feed.sources.map((source) => (
                  <div
                    className={`source-row${
                      drag?.kind === "source" && drag.sourceId === source.id ? " dragging" : ""
                    }${
                      drag?.kind === "source" && drag.overSourceId === source.id && drag.sourceId !== source.id
                        ? drag.after ? " drop-after" : " drop-before"
                        : ""
                    }`}
                    key={source.id}
                    data-source-id={source.id}
                  >
                    <button
                      className="drag-grip"
                      aria-label={`Move ${source.title} up, down or to another feed`}
                      title="Drag up, down or into another feed"
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
                      }${alertBySource.has(source.id) ? " has-alerts" : ""}`}
                      onClick={() => choose({ type: "source", id: source.id })}
                    >
                      <SourceIcon src={source.favicon} title={source.title} />
                      <span className="feed-name">{source.title}</span>
                      {/* Stays lit until the source has been looked at. */}
                      {alertBySource.has(source.id) && (
                        <span className="count alert-count">
                          {alertBySource.get(source.id)!.articles.length}
                        </span>
                      )}
                    </button>
                    <button
                      className={`icon-btn bell-btn${source.notify ? " on" : ""}`}
                      onClick={() => toggleNotify(feed.id, source.id)}
                      aria-pressed={Boolean(source.notify)}
                      aria-label={`${
                        source.notify ? "Stop watching" : "Watch"
                      } ${source.title} for new posts`}
                      title={
                        source.notify
                          ? "Notifications on — click to turn off"
                          : "Notify me of new posts"
                      }
                    >
                      {source.notify ? Icon.bellOn : Icon.bell}
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
                    if (settings.subjects) {
                      choose({ type: "subjects" });
                      return;
                    }
                    setAddingNote(true);
                    setMenuOpen(true);
                  }}
                >
                  {Icon.plus} {settings.subjects ? "New subject" : "New note"}
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
          {auth.account ? (
            // Signed in: everything is kept with the Google account; there is nothing to set up.
            <span className="sync-btn sync-status" title={`Saved to ${auth.account.email}`}>
              <span className={`sync-dot ${syncState === "error" ? "error" : syncState === "working" ? "working" : "saved"}`} />
              {syncState === "error" ? "Can't reach your account" : syncState === "working" ? "Saving…" : "Saved to Google"}
            </span>
          ) : syncCode ? (
            // A device still on an old sync code, until it signs in.
            <button className="sync-btn" onClick={() => openPanel(setSyncOpen)} title="Syncing with an old sync code">
              <span className={`sync-dot ${syncState}`} />
              {syncState === "working" ? "Syncing…" : syncState === "error" ? "Sync problem" : "Synced"}
            </button>
          ) : auth.enabled ? (
            <a className="sync-btn signin-nudge" href={signInHref()} title="Your feeds and work are kept only in this browser until you sign in">
              <span className="sync-dot off" />
              Sign in to save across devices
            </a>
          ) : null}
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
            notes={notesByUse}
            highlight={reading.quote}
            onQuote={settings.quoteToNote && !subjectsLocked ? quoteIntoNote : undefined}
            marks={readingMarks}
            onHighlight={(text) => commitHighlights((current) => toggleHighlight(current, reading.url, text))}
            isHighlighted={(text) => highlightsOverlapping(highlights, reading.url, text).length > 0}
            onRemoveHighlight={(id) => commitHighlights((current) => removeHighlight(current, id))}
            onQuoteNote={(noteId, entryId, html) => {
              const target = notesRef.current.find((n) => n.id === noteId);
              if (target) commitBoard(noteId, (board) => addQuoteNote(target, board, entryId, html));
            }}
            onCreateNote={settings.quoteToNote && !subjectsLocked ? createNote : undefined}
            onOpenNote={(id) => choose({ type: "note", id })}
            onMoveQuote={moveQuote}
            subjects={
              settings.subjects && !subjectsLocked
                ? {
                    onAdd: addReadingToSubject,
                    onCreate: createNote,
                    containing: subjectsContaining(reading.url),
                    onOpen: (id) => choose({ type: "note", id }),
                  }
                : undefined
            }
            saved={isSaved(reading.url)}
            onToggleSave={() => {
              const article =
                articles.find((a) => a.link === reading.url) ??
                savedAsArticles.find((a) => a.link === reading.url);
              if (article) toggleSaved(article, sourceById.get(article.sourceId));
            }}
            onClose={() => setReading(null)}
          />
        ) : subjectsLocked && (selection.type === "subjects" || (openNote && settings.subjects)) ? (
          <SignInCard onOpenMenu={() => setMenuOpen(true)} failed={signInFailed} movedToAccount={writingInAccount} />
        ) : selection.type === "subjects" ? (
          <SubjectsHome
            accountStrip={accountStrip}
            notes={notes}
            boards={boards}
            onOpenMenu={() => setMenuOpen(true)}
            onOpen={(id) => choose({ type: "note", id })}
            onCreate={(name) => choose({ type: "note", id: createNote(name) })}
            onRename={(id, name) => commitNotes((current) => renameNote(current, id, name))}
            onDelete={(id) => removeNote(id)}
          />
        ) : selection.type === "spend" ? (
          <SpendPage onOpenMenu={() => setMenuOpen(true)} onBack={backToSettings} />
        ) : selection.type === "status" ? (
          <StatusPage
            sources={feeds.flatMap((feed) =>
              feed.sources.map((source) => ({
                id: source.id,
                title: source.title,
                feedUrl: source.feedUrl,
                feed: feed.name,
              })),
            )}
            health={health}
            refreshing={refreshing}
            onRefresh={() => void refresh(allSources)}
            onBack={backToSettings}
            onOpenMenu={() => setMenuOpen(true)}
          />
        ) : openNote && settings.subjects ? (
          <SubjectPage
            key={openNote.id}
            accountStrip={accountStrip}
            signedIn={Boolean(auth.account)}
            onRestored={(doc) => void auth.applyRemote(doc)}
            articleMeta={articleMeta}
            sidebarHidden={sidebarHidden}
            onToggleSidebar={() =>
              setSidebarHidden((hidden) => {
                try {
                  localStorage.setItem(SIDEBAR_KEY, hidden ? "0" : "1");
                } catch {
                  /* not remembered */
                }
                return !hidden;
              })
            }
            hideBoxes={settings.hideSubjectBoxes}
            boxWidth={settings.textBoxWidth}
            onToggleHideBoxes={() =>
              setSettings((current) => {
                const next = { ...current, hideSubjectBoxes: !current.hideSubjectBoxes };
                saveSettings(next);
                return next;
              })
            }
            saveLabel={
              auth.account ? (auth.backupProblem ? "Not backed up to Drive — see ⋯" : describeSave(auth.status, auth.savedAt)) : undefined
            }
            note={openNote}
            board={boards[openNote.id]}
            onBack={() => choose({ type: "subjects" })}
            onRename={(name) => commitNotes((current) => renameNote(current, openNote.id, name))}
            onBoard={(update) => commitBoard(openNote.id, update)}
            keyHeaders={() => keyHeaders}
            hasAiKey={Boolean(apiKeys[settings.aiProvider])}
            ai={{
              provider: settings.aiProvider,
              model: settings.aiProvider === "openai" ? settings.openaiModel : settings.anthropicModel,
              quickModel: settings.aiProvider === "openai" ? settings.openaiQuickModel : settings.anthropicQuickModel,
            }}
            onOpenMenu={() => setMenuOpen(true)}
            onOpenArticle={(link, title, quote) => setReading({ url: link, title, quote })}
            onCommitEntries={(entries) =>
              commitNotes((current) =>
                current.map((note) => (note.id === openNote.id ? { ...note, entries } : note)),
              )
            }
          />
        ) : openNote ? (
          <NotePage
            note={openNote}
            onOpenMenu={() => setMenuOpen(true)}
            onOpenArticle={(link, title, quote) =>
              setReading({ url: link, title, quote })
            }
            // The page hands back the whole note each time it changes: it is
            // one text box, and what came out of it is what the note now
            // says — bar anything that arrived while it was open, which is
            // not the page's to have an opinion about.
            onCommitEntries={(entries, known) =>
              commitNotes((current) =>
                current.map((note) =>
                  note.id === openNote.id
                    ? { ...note, entries: foldIntoNote(note.entries, entries, known) }
                    : note,
                ),
              )
            }
          />
        ) : (
          <>
        {/*
          * What a refresh looks like, said out loud for a screen reader.
          *
          * The indicators themselves sit inside the header below, where they
          * float over the list rather than pushing it: both used to be rows
          * above the header, which put them under a phone's status bar — the
          * clock sitting on top of the words — and moved the whole page down
          * and back up again every time one appeared.
          */}
        <p className="sr-only" aria-live="polite">
          {refreshing
            ? "Checking for new articles"
            : pullDistance >= PULL_TRIGGER
              ? "Release to refresh"
              : pullDistance > 0
                ? "Pull to refresh"
                : ""}
        </p>

        <div className="main-head">
          {/*
            * The pull indicator follows the finger down from under the
            * header, turning over as it passes the point where letting go
            * refreshes — the gesture's own progress, rather than a caption
            * describing it. Anchored to the header, so it clears the status
            * bar on a phone and costs the list no layout.
            */}
          {(pullDistance > 0 || (refreshing && pullRefresh)) && (
            <div
              className={`pull-ring${refreshing ? " spinning" : ""}${
                pullDistance >= PULL_TRIGGER ? " ready" : ""
              }`}
              style={{
                // Parked at a fixed spot once the refresh is under way; before
                // that it is wherever the finger has dragged it to.
                transform: `translate(-50%, ${
                  refreshing ? PULL_TRIGGER * 0.5 : Math.round(pullDistance)
                }px)`,
                // Fully there well before the trigger, so what the reader
                // is deciding about is a solid thing, not a hint of one.
                opacity: refreshing
                  ? 1
                  : Math.min(1, pullDistance / (PULL_TRIGGER * 0.35)),
              }}
              aria-hidden
            >
              {refreshing ? (
                <span className="spinner" />
              ) : (
                <span
                  className="pull-arrow"
                  style={{
                    transform: `rotate(${
                      pullDistance >= PULL_TRIGGER ? 180 : 0
                    }deg)`,
                  }}
                >
                  {Icon.arrowDown}
                </span>
              )}
            </div>
          )}

          {/* Checking for new articles over a list that is already readable,
              so a list from the last visit is not mistaken for everything
              there is. A pill on the header's edge: it says the same thing
              without the page moving under the reader's thumb. */}
          {slowRefresh && !pullRefresh && shown.length > 0 && (
            <div className="list-updating" aria-hidden>
              <span className="spinner" /> Checking for new articles…
            </div>
          )}
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
              {/* What the download is costing in storage, where that is the
                  question the list is being looked at to answer. */}
              {selection.type === "downloaded" && downloadedBytes > 0 &&
                ` · ${
                  downloadedBytes >= 1_000_000
                    ? `${(downloadedBytes / 1_000_000).toFixed(1)} MB`
                    : `${Math.max(1, Math.round(downloadedBytes / 1000))} KB`
                } of text`}
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

        {!ready ? null : selection.type === "alerts" ? (
          <div className="alerts-view">
            {alerts.length === 0 ? (
              <div className="state">
                <h2>Nothing new.</h2>
                <p>
                  {watchedSources.length === 1
                    ? "You’re watching one source. "
                    : `You’re watching ${watchedSources.length} sources. `}
                  When one of them posts, it shows up here and lights up in the
                  sidebar until you’ve looked at it.
                </p>
              </div>
            ) : (
              <>
                <div className="alerts-head">
                  <p>
                    {alertTotal} new post{alertTotal === 1 ? "" : "s"} from{" "}
                    {alerts.length} source{alerts.length === 1 ? "" : "s"}
                  </p>
                  <button
                    className="btn ghost small"
                    onClick={() => clearAlerts(alerts.map((alert) => alert.sourceId))}
                  >
                    {Icon.check} Acknowledge all
                  </button>
                </div>

                {alerts.map((alert) => {
                  const source = sourceById.get(alert.sourceId);
                  return (
                    <section className="alert-card" key={alert.sourceId}>
                      <header>
                        <SourceIcon
                          src={source?.favicon ?? ""}
                          title={source?.title ?? "Source"}
                          size={18}
                        />
                        <button
                          className="alert-source"
                          onClick={() => choose({ type: "source", id: alert.sourceId })}
                        >
                          {source?.title ?? "Source"}
                        </button>
                        <span className="alert-n">
                          {alert.articles.length} new
                        </span>
                        <button
                          className="btn ghost small"
                          onClick={() => clearAlerts([alert.sourceId])}
                        >
                          {Icon.check} Acknowledge
                        </button>
                      </header>
                      <ul>
                        {alert.articles.slice(0, 5).map((article) => (
                          <li key={article.id}>
                            <button
                              className="alert-title"
                              onClick={() =>
                                openArticle(article, source?.feedUrl)
                              }
                            >
                              {article.title}
                            </button>
                            {article.publishedAt && (
                              <span className="when">
                                {timeAgo(article.publishedAt)}
                              </span>
                            )}
                          </li>
                        ))}
                        {alert.articles.length > 5 && (
                          <li className="alert-more">
                            and {alert.articles.length - 5} more
                          </li>
                        )}
                      </ul>
                    </section>
                  );
                })}
              </>
            )}
          </div>
        ) : /* A team feed is readable on its own: someone can join one with
               a connect code before they follow a single source of their own,
               and "start with one link" over a list of shared stories is
               wrong. */
          allSources.length === 0 &&
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
            <h2>{pending ? "Loading articles…" : "Nothing here yet."}</h2>
            {!pending &&
              (selection.type === "team" ? (
                <p>
                  Nothing shared yet. Use <strong>Save to Team</strong> on any
                  article and everyone with this feed&rsquo;s connect code will
                  see it here.
                </p>
              ) : selection.type === "downloaded" ? (
                <p>
                  Nothing downloaded yet. Articles are fetched for offline
                  reading in the background — open the app on a connection for
                  a minute and they will collect here.
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
            {inView.map((article) => {
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
            {/* Where the next batch comes in. Kept out of the list itself so
                it cannot be mistaken for an article with nothing in it. */}
            {more && (
              <div className="list-tail" ref={tail} aria-hidden>
                <span className="spinner" />
              </div>
            )}
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
          onOpenSpend={() => {
            if (selection.type !== "status" && selection.type !== "spend") beforeSettingsPage.current = selection;
            setSettingsOpen(false);
            choose({ type: "spend" });
          }}
          onOpenStatus={() => {
            if (selection.type !== "status" && selection.type !== "spend") beforeSettingsPage.current = selection;
            setSettingsOpen(false);
            choose({ type: "status" });
          }}
          offline={offline}
          storedCount={savedOffline.size}
          targetCount={offlineTargets().length}
          persisted={persisted}
          vault={vault}
          apiKeys={apiKeys}
          onKeysChange={updateKeys}
          signedIn={Boolean(auth.account)}
          onPrefsRestored={() => void syncAccountPrefs()}
          onRestoreFeeds={restoreFeeds}
          onDownload={runDownload}
          noteCount={notes.length}
          teams={teams}
          teamsBusy={teamsBusy}
          onCreateTeam={createTeam}
          onJoinTeam={joinTeam}
          onLeaveTeam={leaveTeam}
        />
      )}

      {syncOpen && syncCode && !auth.account && (
        <SyncDialog
          code={syncCode}
          onDisconnect={stopSync}
          onRestore={restoreFeeds}
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
