/**
 * Notes: quotes pulled out of what you were reading, with your own thoughts
 * around them.
 *
 * A note is a list of entries in the order they were added — a quote lifted
 * from an article, or a line you typed. Quotes are not editable, only
 * removable: the point of a quote is that it says what the article said. Your
 * own lines are yours to rewrite.
 *
 * The article behind a quote is bookmarked automatically, because a quote
 * whose article has scrolled out of its feed and off the device is a quote
 * with nothing behind it. That automatic save is marked `viaNote`, so it can
 * be cleaned up when the last quote of it goes — but a bookmark the reader
 * made themselves is never cleaned up, whatever the notes do.
 */

import type { SavedArticle } from "./saved";

export type NoteQuote = {
  id: string;
  kind: "quote";
  /** What the article said, as it said it. */
  text: string;
  /** The article it came from, for the trip back. */
  link: string;
  articleTitle: string;
  sourceTitle?: string;
  at: number;
};

export type NoteComment = {
  id: string;
  kind: "text";
  text: string;
  at: number;
  /** When it was last rewritten, so two devices' edits resolve. */
  editedAt?: number;
};

export type NoteEntry = NoteQuote | NoteComment;

export type Note = {
  id: string;
  name: string;
  entries: NoteEntry[];
  /** When the note was made. Also its order in the sidebar, on every device. */
  at: number;
  /** When the note itself — its name — last changed. */
  updatedAt?: number;
};

/**
 * A deleted note or entry, dated. Like an un-save, a deletion needs a record
 * of its own: the other device still holds the thing, and without a tombstone
 * it simply puts it back at the next sync. Entry and note ids come from the
 * same generator and are unique, so one list covers both.
 */
export type NoteRemoval = { id: string; at: number };

export type NotesState = { notes: Note[]; removals: NoteRemoval[] };

/** Keeps one runaway selection from filling storage. */
export const MAX_QUOTE_CHARS = 4000;

/**
 * What syncing will carry. The document has a 512KB ceiling that the feed
 * list, read marks and bookmarks also draw on, and a payload over it is
 * refused outright — which would break syncing altogether rather than just
 * losing a note. Quotes cannot be trimmed the way a bookmark's summary can:
 * the words are the whole point. So the budget is spent on the newest
 * entries, and anything that does not fit stays on the device that made it.
 */
export const SYNC_BUDGET_BYTES = 140 * 1024;
export const MAX_NOTES = 60;
export const MAX_ENTRIES = 400;
/** A tombstone only has to outlive the slowest device's absence. */
export const REMOVAL_TTL_MS = 90 * 24 * 60 * 60 * 1000;
const MAX_REMOVALS = 600;

/** When this entry last changed — its edit if it has one, else its arrival. */
function stampOf(entry: NoteEntry) {
  return Math.max(
    Number(entry.at) || 0,
    entry.kind === "text" ? Number(entry.editedAt) || 0 : 0,
  );
}

/**
 * When the note itself last changed. Its creation time stands in for notes
 * written before renames were stamped — but only as a fallback: taking the
 * later of the two would let a note made long ago outrank a rename made
 * today, and the name would never travel.
 */
function noteStamp(note: Note) {
  return Number(note.updatedAt) || Number(note.at) || 0;
}

export function isQuote(entry: NoteEntry): entry is NoteQuote {
  return entry.kind === "quote";
}

/**
 * Tidy a selection into a quote.
 *
 * A selection dragged across a page arrives with the line breaks of the
 * layout in it, which are not the article's paragraphs; blank lines are, so
 * those are kept and the rest collapse.
 */
export function cleanQuoteText(input: string) {
  return input
    .replace(/\r/g, "")
    .replace(/[ \t]+/g, " ")
    .replace(/ *\n *\n *(\n *)*/g, "\n\n")
    .replace(/(?<!\n)\n(?!\n)/g, " ")
    .trim()
    .slice(0, MAX_QUOTE_CHARS);
}

/** Every article still quoted somewhere, by link. */
export function quotedLinks(notes: Note[]): Set<string> {
  const links = new Set<string>();
  for (const note of notes) {
    for (const entry of note.entries) {
      if (isQuote(entry)) links.add(entry.link);
    }
  }
  return links;
}

/**
 * Which bookmarks the notes no longer need.
 *
 * Only ones saved *by* a quote qualify: an article the reader saved with the
 * Save button is theirs, and quoting it then deleting the quote must not take
 * it away. Nor does an article that another note still quotes.
 */
export function releasableSaves(saved: SavedArticle[], notes: Note[]): string[] {
  const stillQuoted = quotedLinks(notes);
  return saved
    .filter((article) => article.viaNote && !stillQuoted.has(article.link))
    .map((article) => article.link);
}

/**
 * Union of two devices' notes.
 *
 * The same reasoning as bookmarks (lib/saved.ts): both devices write to these
 * constantly, so replacing one copy with the other would silently delete a
 * quote taken on the phone the moment the desktop synced. Notes merge by id,
 * their entries merge by id, and each is kept in whichever copy is newer.
 * A deletion carries a tombstone, and a tombstone suppresses the thing it
 * names until something later supersedes it.
 *
 * Pure, so the interesting case — one device deleting a quote while the other
 * edits the note around it — is testable without a database.
 */
export function mergeNotes(
  mine: NotesState,
  theirs: NotesState,
  now = Date.now(),
): NotesState {
  const removals = new Map<string, number>();
  for (const removal of [...(mine.removals ?? []), ...(theirs.removals ?? [])]) {
    if (!removal?.id) continue;
    const at = Number(removal.at) || 0;
    // Long-expired tombstones are dropped: by then every device has seen the
    // deletion, and keeping them would grow the document forever.
    if (now - at > REMOVAL_TTL_MS) continue;
    removals.set(removal.id, Math.max(removals.get(removal.id) ?? 0, at));
  }

  /** Both copies of every note that either side has. */
  const sides = new Map<string, Note[]>();
  for (const note of [...(mine.notes ?? []), ...(theirs.notes ?? [])]) {
    if (!note?.id) continue;
    sides.set(note.id, [...(sides.get(note.id) ?? []), note]);
  }

  const notes: Note[] = [];
  for (const [id, copies] of sides) {
    const deletedAt = removals.get(id);
    const newest = copies.reduce((a, b) => (noteStamp(b) > noteStamp(a) ? b : a));
    // A deletion only wins while it is the most recent thing to happen to the
    // note; renaming it afterwards on another device brings it back.
    if (deletedAt !== undefined && deletedAt >= noteStamp(newest)) continue;
    if (deletedAt !== undefined) removals.delete(id);

    const best = new Map<string, NoteEntry>();
    for (const copy of copies) {
      for (const entry of copy.entries ?? []) {
        if (!entry?.id) continue;
        const current = best.get(entry.id);
        if (!current || stampOf(entry) > stampOf(current)) best.set(entry.id, entry);
      }
    }

    const entries: NoteEntry[] = [];
    for (const [entryId, entry] of best) {
      const removedAt = removals.get(entryId);
      if (removedAt !== undefined && removedAt >= stampOf(entry)) continue;
      if (removedAt !== undefined) removals.delete(entryId);
      entries.push(entry);
    }
    entries.sort((a, b) => (Number(a.at) || 0) - (Number(b.at) || 0));

    notes.push({
      ...newest,
      entries: entries.slice(-MAX_ENTRIES),
    });
  }

  // Oldest first, so both devices show the same order in the sidebar.
  notes.sort((a, b) => (Number(a.at) || 0) - (Number(b.at) || 0));

  const keptRemovals = [...removals.entries()]
    .map(([id, at]) => ({ id, at }))
    .sort((a, b) => b.at - a.at)
    .slice(0, MAX_REMOVALS);

  return { notes: notes.slice(-MAX_NOTES), removals: keptRemovals };
}

/**
 * Whether a merge produced anything the other side did not already have —
 * a note, a quote, a line, or a deletion it has not heard about. Until that
 * has been pushed, this device is not up to date however new the stamp it
 * just received was.
 */
export function notesDifferFrom(merged: NotesState, theirs: NotesState) {
  const ids = (state: NotesState) =>
    new Set((state.notes ?? []).flatMap(idsOf));
  const ours = ids(merged);
  const other = ids(theirs);
  if (ours.size !== other.size) return true;
  for (const id of ours) if (!other.has(id)) return true;

  // A deletion this device knows about and the other does not still has to
  // travel, or what it names comes back at the next sync.
  const theirRemovals = new Set((theirs.removals ?? []).map((removal) => removal.id));
  return (merged.removals ?? []).some((removal) => !theirRemovals.has(removal.id));
}

/**
 * The copy that goes over the wire, cut to a budget.
 *
 * Whole entries are dropped rather than shortened — half a quote is worse
 * than no quote, because it would look like what the article said. The newest
 * survive, and what does not fit stays where it was written; a device that
 * never receives an entry cannot delete it either, so nothing is lost.
 */
export function slimNotesForSync(
  notes: Note[],
  budget = SYNC_BUDGET_BYTES,
): Note[] {
  const trimmed = notes.slice(-MAX_NOTES).map((note) => ({ ...note, entries: [] as NoteEntry[] }));
  let size = JSON.stringify(trimmed).length;
  if (size > budget) return trimmed;

  // Newest entries first across every note, so a budget that runs out takes
  // the oldest material rather than whichever note happens to be last.
  const queued = notes
    .flatMap((note) => (note.entries ?? []).map((entry) => ({ noteId: note.id, entry })))
    .sort((a, b) => (Number(b.entry.at) || 0) - (Number(a.entry.at) || 0));

  const byId = new Map(trimmed.map((note) => [note.id, note]));
  for (const { noteId, entry } of queued) {
    const cost = JSON.stringify(entry).length + 1;
    if (size + cost > budget) continue;
    byId.get(noteId)?.entries.push(entry);
    size += cost;
  }

  for (const note of trimmed) {
    note.entries.sort((a, b) => (Number(a.at) || 0) - (Number(b.at) || 0));
  }
  return trimmed;
}

export function renameNote(notes: Note[], id: string, name: string): Note[] {
  const clean = name.trim().slice(0, 60);
  if (!clean) return notes;
  return notes.map((note) =>
    note.id === id ? { ...note, name: clean, updatedAt: Date.now() } : note,
  );
}

export function addEntry(notes: Note[], id: string, entry: NoteEntry): Note[] {
  return notes.map((note) =>
    note.id === id ? { ...note, entries: [...note.entries, entry] } : note,
  );
}

export function removeEntry(notes: Note[], noteId: string, entryId: string): Note[] {
  return notes.map((note) =>
    note.id === noteId
      ? { ...note, entries: note.entries.filter((entry) => entry.id !== entryId) }
      : note,
  );
}

/** Rewrite one of your own lines. A quote is never rewritten, only removed. */
export function editComment(
  notes: Note[],
  noteId: string,
  entryId: string,
  text: string,
): Note[] {
  return notes.map((note) =>
    note.id === noteId
      ? {
          ...note,
          entries: note.entries.map((entry) =>
            entry.id === entryId && entry.kind === "text"
              ? { ...entry, text, editedAt: Date.now() }
              : entry,
          ),
        }
      : note,
  );
}

const KEY = "super-reader:notes:v1";
const REMOVED_KEY = "super-reader:notes-removed:v1";

export function loadNotes(): Note[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? (parsed as Note[]) : [];
  } catch {
    return [];
  }
}

export function saveNotes(notes: Note[]) {
  try {
    window.localStorage.setItem(KEY, JSON.stringify(notes));
  } catch {
    /* storage unavailable; the notes just won't persist */
  }
}

/** Deletions, dated. Without these another device puts them straight back. */
export function loadNoteRemovals(): NoteRemoval[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(REMOVED_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? (parsed as NoteRemoval[]) : [];
  } catch {
    return [];
  }
}

export function saveNoteRemovals(removals: NoteRemoval[]) {
  try {
    window.localStorage.setItem(REMOVED_KEY, JSON.stringify(removals.slice(0, 600)));
  } catch {
    /* ignore */
  }
}

/** Every id a deletion has to name: the note, and everything inside it. */
export function idsOf(note: Note): string[] {
  return [note.id, ...(note.entries ?? []).map((entry) => entry.id)];
}
