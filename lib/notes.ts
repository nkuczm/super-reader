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
};

export type NoteEntry = NoteQuote | NoteComment;

export type Note = {
  id: string;
  name: string;
  entries: NoteEntry[];
  at: number;
};

/** Keeps one runaway selection from filling storage. */
export const MAX_QUOTE_CHARS = 4000;

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

export function renameNote(notes: Note[], id: string, name: string): Note[] {
  const clean = name.trim().slice(0, 60);
  if (!clean) return notes;
  return notes.map((note) => (note.id === id ? { ...note, name: clean } : note));
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
              ? { ...entry, text }
              : entry,
          ),
        }
      : note,
  );
}

const KEY = "super-reader:notes:v1";

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
