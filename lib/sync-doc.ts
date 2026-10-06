/**
 * The synced document and the rules for merging two copies of it — run on the
 * server as a device writes, and the same rules on the device as it reads.
 * Pure, so it can be tested without a database and imported by the browser.
 *
 * Four parts are replaced whole, newest wins: the feed list, the read marks,
 * the team list and the key vault. Each carries its own change time. They
 * used to share one, so the phone marking an article read made its week-old
 * feed list look newer than the source just added on the laptop, and the
 * next push from the phone took the new source away.
 *
 * Everything else merges item by item and cannot be lost by a push.
 */

import { mergeSaved, slimForSync } from "./saved";
import type { SavedArticle, SavedRemoval } from "./saved";
import { mergeMarks, type WatchMarks } from "./alerts";
import { mergePositions, slimPositionsForSync, type Positions } from "./position";
import { mergeNotes, slimNotesForSync } from "./notes";
import type { Note, NoteRemoval } from "./notes";
import { mergeBoards, slimBoardsForSync, type Boards } from "./subjects";
import { mergeManual, slimManualForSync, type ManualStories } from "./manual";
import { mergeHighlights, slimHighlightsForSync, type Highlights } from "./highlights";

/** The parts replaced whole, each stamped with when it last changed. */
export const PARTS = ["feeds", "read", "teams", "vault"] as const;
export type Part = (typeof PARTS)[number];
export type PartStamps = Partial<Record<Part, number>>;

export type SharedPrefsWire = {
  subjects: boolean;
  aiProvider: string;
  openaiModel: string;
  anthropicModel?: string;
  anthropicQuickModel?: string;
  openaiQuickModel?: string;
  at: number;
};

export type SyncPayload = {
  feeds: unknown[];
  read?: string[];
  /** Bookmarks, and the dated un-saves that must outlive a device still holding the article (lib/saved.ts). */
  saved?: SavedArticle[];
  savedRemovals?: SavedRemoval[];
  /** How far each watched source has been read up to; the later of each wins. */
  watchMarks?: WatchMarks;
  /** How far through each article the reader got, per article, most recent change winning. */
  positions?: Positions;
  /** Notes and subject boards — only for a code not tied to a Google account (lib/accounts.ts). */
  notes?: Note[];
  noteRemovals?: NoteRemoval[];
  boards?: Boards;
  /** Settings that follow the person (lib/store.ts SharedPrefs); newest wins. */
  prefs?: SharedPrefsWire;
  /** Stories pasted in by hand (lib/manual.ts), merged per link. */
  manual?: ManualStories;
  /** Passages marked in articles (lib/highlights.ts), merged per highlight. */
  highlights?: Highlights;
  /** Which team feeds this person has joined: names and connect codes, not their articles. */
  teams?: unknown[];
  /** The API-key vault, encrypted in the browser; this server cannot read it. */
  vault?: unknown;
  /** When each replaced part last changed, on the device that changed it. */
  stamps?: PartStamps;
  /** When anything in this document last changed. Documents from before `stamps` use it for every part. */
  updatedAt?: number;
};

/** Keeps one device from filling the table with an oversized document. */
export const MAX_PAYLOAD_BYTES = 3 * 1024 * 1024;
/** Read marks the document carries: the most recent. */
export const MAX_READ = 3000;

/** When a part last changed: its own stamp, or, in a document from before parts had one, the document's. */
export function partStamp(doc: { stamps?: PartStamps; updatedAt?: number } | null | undefined, part: Part): number {
  const own = Number(doc?.stamps?.[part]);
  if (Number.isFinite(own) && own > 0) return own;
  return Number(doc?.updatedAt) || 0;
}

const present = (value: unknown) => value !== undefined && value !== null;

/**
 * A device's copy merged into the stored one. Replaced parts go to whichever
 * side changed them last (a tie goes to the device, so a retry is not
 * refused); everything else is the union, cut to what the document carries.
 */
export function mergeSyncDocs(incoming: SyncPayload, stored: SyncPayload, now = Date.now()): SyncPayload {
  const stamps: PartStamps = {};
  const parts: Partial<SyncPayload> = {};
  for (const part of PARTS) {
    const mine = partStamp(incoming, part);
    const theirs = partStamp(stored, part);
    const has = present(incoming[part]);
    const held = present(stored[part]);
    if (has && (!held || mine >= theirs)) {
      (parts as Record<string, unknown>)[part] = incoming[part];
      stamps[part] = held ? mine : Math.max(mine, theirs);
    } else if (held) {
      (parts as Record<string, unknown>)[part] = stored[part];
      stamps[part] = theirs;
    }
  }
  const bookmarks = mergeSaved(
    { saved: incoming.saved ?? [], removals: incoming.savedRemovals ?? [] },
    { saved: stored.saved ?? [], removals: stored.savedRemovals ?? [] },
    now,
  );
  const notes = mergeNotes(
    { notes: incoming.notes ?? [], removals: incoming.noteRemovals ?? [] },
    { notes: stored.notes ?? [], removals: stored.noteRemovals ?? [] },
    now,
  );
  return {
    feeds: Array.isArray(parts.feeds) ? parts.feeds : [],
    ...(parts.read ? { read: (parts.read as string[]).slice(-MAX_READ) } : {}),
    ...(parts.teams ? { teams: parts.teams } : {}),
    ...(present(parts.vault) ? { vault: parts.vault } : {}),
    saved: slimForSync(bookmarks.saved),
    savedRemovals: bookmarks.removals,
    // A mark only moves forward, so the later one always has more information.
    watchMarks: mergeMarks(incoming.watchMarks ?? {}, stored.watchMarks ?? {}),
    positions: slimPositionsForSync(mergePositions(incoming.positions ?? {}, stored.positions ?? {}, now), now),
    notes: slimNotesForSync(notes.notes),
    noteRemovals: notes.removals,
    boards: slimBoardsForSync(mergeBoards(incoming.boards ?? {}, stored.boards ?? {}, now)),
    manual: slimManualForSync(mergeManual(incoming.manual ?? {}, stored.manual ?? {}, now)),
    highlights: slimHighlightsForSync(mergeHighlights(incoming.highlights ?? {}, stored.highlights ?? {}, now)),
    ...((stored.prefs?.at ?? 0) > (incoming.prefs?.at ?? 0)
      ? stored.prefs ? { prefs: stored.prefs } : {}
      : incoming.prefs ?? stored.prefs ? { prefs: (incoming.prefs ?? stored.prefs)! } : {}),
    stamps,
    updatedAt: Math.max(Number(incoming.updatedAt) || 0, Number(stored.updatedAt) || 0),
  };
}

/* ---------- history of the replaced parts ---------- */

/** What a version of the feed list holds, for listing without reading it. */
export function feedsSummary(feeds: unknown): { folders: number; sources: number } {
  const list = Array.isArray(feeds) ? feeds : [];
  let sources = 0;
  for (const feed of list) sources += Array.isArray((feed as { sources?: unknown[] })?.sources) ? (feed as { sources: unknown[] }).sources.length : 0;
  return { folders: list.length, sources };
}

function ids(doc: SyncPayload): { feeds: Set<string>; sources: Set<string>; teams: Set<string> } {
  const feeds = new Set<string>();
  const sources = new Set<string>();
  for (const feed of Array.isArray(doc.feeds) ? doc.feeds : []) {
    const f = feed as { id?: unknown; sources?: unknown[] };
    if (typeof f?.id === "string") feeds.add(f.id);
    for (const source of Array.isArray(f?.sources) ? f.sources : []) {
      const id = (source as { id?: unknown })?.id;
      if (typeof id === "string") sources.add(id);
    }
  }
  const teams = new Set<string>();
  for (const team of Array.isArray(doc.teams) ? doc.teams : []) {
    const code = (team as { code?: unknown })?.code;
    if (typeof code === "string") teams.add(code);
  }
  return { feeds, sources, teams };
}

/** Whether going from `before` to `after` takes away a folder, a source, a team or the vault. */
export function losesSomething(before: SyncPayload, after: SyncPayload): boolean {
  const was = ids(before);
  const now = ids(after);
  for (const kind of ["feeds", "sources", "teams"] as const) {
    for (const id of was[kind]) if (!now[kind].has(id)) return true;
  }
  return present(before.vault) && JSON.stringify(before.vault) !== JSON.stringify(after.vault ?? null);
}

/** The replaced parts, as a version keeps them. */
export function versionOf(doc: SyncPayload): { feeds: unknown[]; teams: unknown[]; vault?: unknown } {
  return {
    feeds: Array.isArray(doc.feeds) ? doc.feeds : [],
    teams: Array.isArray(doc.teams) ? doc.teams : [],
    ...(present(doc.vault) ? { vault: doc.vault } : {}),
  };
}

/**
 * A device's copy cut to what the route accepts. The budgets above keep an
 * ordinary copy far inside it; this is for the extraordinary one, which would
 * otherwise be refused and stop everything syncing. What goes first is what
 * matters least and is kept elsewhere anyway.
 */
export function fitForSync<T extends SyncPayload>(body: T, limit = Math.floor(MAX_PAYLOAD_BYTES * 0.9)): T {
  const size = (value: unknown) => JSON.stringify(value).length;
  let out = body;
  if (size(out) <= limit) return out;
  out = { ...out, read: (out.read ?? []).slice(-500), positions: {} };
  if (size(out) <= limit) return out;
  out = {
    ...out,
    highlights: slimHighlightsForSync(out.highlights ?? {}, 40 * 1024),
    manual: Object.fromEntries(Object.entries(slimManualForSync(out.manual ?? {})).slice(0, 60)),
  };
  if (size(out) <= limit) return out;
  return {
    ...out,
    saved: (out.saved ?? []).slice(0, 100),
    ...(out.notes ? { notes: slimNotesForSync(out.notes, 40 * 1024) } : {}),
    ...(out.boards ? { boards: slimBoardsForSync(out.boards, 40 * 1024) } : {}),
  };
}
