/**
 * Subjects: a note grown into a board.
 *
 * With Subjects switched on, every note is a subject. The note keeps doing
 * what it always did — it holds the quotes, in lib/notes.ts, and those still
 * sync and still keep their articles bookmarked — and the board holds
 * everything a subject adds on top: stories added without a quote, what you
 * wrote under each story, free text boxes, where each thing sits on the
 * whiteboard, the lines drawn between them, and what the AI made of it all.
 *
 * A board is a flat map of stamped items, and it merges item by item with the
 * most recent change winning. That is the whole sync story, and it is chosen
 * over anything cleverer because both devices edit the same board: moving a
 * card on the laptop and writing under it on the phone are two different
 * items, so neither undoes the other. A deletion is an item marked deleted
 * rather than a missing one, for the reason notes carry tombstones — the other
 * device still holds it and would otherwise put it back.
 */

import type { Transcript } from "./transcript";
import { isQuote, type Note } from "./notes";
import { canonicalUrl } from "./url";

type Base = {
  id: string;
  /** When this item last changed, on the device that changed it. */
  at: number;
  deleted?: boolean;
};

/** A story added to the subject without quoting it. */
export type StoryItem = Base & {
  kind: "story";
  link: string;
  title: string;
  source?: string;
  publishedAt?: string;
  author?: string;
  /** The block it was pasted into as a link: in the document it reads right below that block. */
  after?: string;
  /** When it first arrived, kept when a deleted story is put back (which restamps `at`), so it returns to its place. */
  since?: number;
};

/** What you wrote on a story's card, under its quotes. Sanitised HTML. */
export type CardNoteItem = Base & { kind: "cardnote"; card: string; html: string };

/** A free text box, anywhere on the board. Sanitised HTML. */
/** One pen stroke of a drawing: an SVG path in the drawing's own 600-wide space. */
export type Stroke = { d: string; color: string; w: number };

/**
 * A free box, anywhere on the board: text (sanitised HTML), or a drawing, or
 * an image. One kind for all three, so placing, tabs, the whiteboard and
 * deleting treat them alike.
 */
export type BoxItem = Base & {
  kind: "box";
  html: string;
  drawing?: Stroke[];
  /** A drawing's height in its 600-wide space. */
  height?: number;
  /** An image, as a downscaled data: URL. */
  image?: string;
  caption?: string;
  /** Set into a text box's text, so it is shown there rather than on its own. */
  embedded?: boolean;
  /** A section label: one line of big header text, which stories gather under. */
  label?: boolean;
  /** Started from the keyboard below another block in the document: it reads right after that block. */
  after?: string;
  /** A section label's colour (one of LABEL_COLORS) and whether it underlines or fills behind the text. */
  labelColor?: string;
  labelStyle?: "underline" | "fill";
  /**
   * "node": on the whiteboard, the label is a circle that lines leave from
   * on every side — a hub rather than a heading. In the document it reads as
   * an ordinary section heading.
   */
  labelShape?: "node";
  /** A little spreadsheet: what was typed in each cell, formulas included. */
  table?: string[][];
  /** "doc" for a plain table typed into like text; "sheet" (the default for older tables) for a spreadsheet. */
  tableMode?: "doc" | "sheet";
  /** Column widths and row heights in pixels, as dragged; missing ones take the mode's default. */
  tableCols?: (number | null)[];
  tableRows?: (number | null)[];
  /** Cell colours and merges, keyed "row,col" (see lib/sheet.ts). */
  tableCells?: Record<string, { bg?: string; rs?: number; cs?: number }>;
  /** An interview transcript, split into who said what. */
  transcript?: Transcript;
  /** More transcripts in the same block, shown as tabs after the first. */
  transcriptTabs?: Transcript[];
  /** The first table tab's name; the card's own table fields are that tab. */
  tableName?: string;
  /** More tables in the same card, each a tab after the first. */
  tableTabs?: TableTab[];
  /** A script table's last fact-check, and whether its colours are showing. */
  factCheck?: import("./factcheck").FactCheck;
  factView?: boolean;
  /** Set on the card that collects a transcript's comments, naming the transcript's box. */
  notesFor?: string;
};

/** One more table in a table card: everything a table is, and its tab's name. */
export type TableTab = Pick<BoxItem, "table" | "tableMode" | "tableCols" | "tableRows" | "tableCells" | "factCheck" | "factView"> & { name: string };

export const DRAWING_WIDTH = 600;
export const DEFAULT_DRAWING_HEIGHT = 300;

/** A drawing as a self-contained SVG picture, for setting into text. */
export function drawingSvg(box: BoxItem): string {
  const height = Math.min(1200, Math.max(80, Number(box.height) || DEFAULT_DRAWING_HEIGHT));
  const paths = safeStrokes(box.drawing)
    .map((s) => `<path d="${s.d}" stroke="${s.color}" stroke-width="${s.w}" fill="none" stroke-linecap="round" stroke-linejoin="round"/>`)
    .join("");
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${DRAWING_WIDTH} ${height}" width="${DRAWING_WIDTH}" height="${height}"><rect width="100%" height="100%" fill="#fff"/>${paths}</svg>`;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

/** What an embedded box shows as a picture. */
export function embedSrc(box: BoxItem | undefined): string | undefined {
  if (!box) return undefined;
  if (box.drawing) return drawingSvg(box);
  return safeImage(box.image);
}

/** Only an image this app made: a base64 PNG, JPEG or WebP data URL. */
export function safeImage(src: string | undefined): string | undefined {
  return src && /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(src) ? src : undefined;
}

/** A stroke as synced data says it is: path commands and numbers only. */
export function safeStrokes(strokes: unknown): Stroke[] {
  if (!Array.isArray(strokes)) return [];
  return strokes
    .filter((s): s is Stroke => !!s && typeof s.d === "string" && /^[ML0-9 .-]+$/.test(s.d))
    .map((s) => ({
      d: s.d.slice(0, 20000),
      color: /^#[0-9a-f]{6}$/i.test(s.color) ? s.color : "#111111",
      w: Math.min(12, Math.max(1, Number(s.w) || 2)),
    }));
}

/** Where something sits on the whiteboard. One per card, box or insight. */
export type PosItem = Base & { kind: "pos"; target: string; x: number; y: number; w: number };

/** A line you drew between two things on the whiteboard. */
export type LinkItem = Base & { kind: "link"; from: string; to: string };

export type InsightKind = "connection" | "question" | "deeper";

/** Something the AI noticed across the stories, tied to the ones it spans. */
export type InsightItem = Base & {
  kind: "insight";
  type: InsightKind;
  text: string;
  /** Card ids — canonical links — the insight draws on. */
  refs: string[];
  /** Which run produced it, so the next run replaces rather than piles up. */
  run: string;
};

/**
 * Further reading the AI proposed. A real article found by search, never a
 * link the model made up: the model only writes the search.
 */
export type SuggestItem = Base & {
  kind: "suggest";
  link: string;
  title: string;
  source?: string;
  why: string;
  state: "pending" | "accepted" | "dismissed";
};

/** The subject's own settings, and the last AI run. */
export type MetaItem = Base & {
  kind: "meta";
  view: "doc" | "board";
  /** A fingerprint of what the last run was given, so it is not re-run on nothing. */
  sig?: string;
  ranAt?: number;
  /** Whether old notes' own writing has been brought onto the board. */
  migrated?: boolean;
  /** The tab last open, where new stories and boxes land. */
  activeTab?: string;
  /** Keep every story in this subject downloaded for reading offline. */
  offline?: boolean;
  /** AI suggestions turned off here: no insights or suggested reading shown, and none fetched. */
  aiOff?: boolean;
};

/**
 * A tab within a subject, like a Google Docs tab: its own page of stories and
 * boxes. The first tab, MAIN_TAB, exists without an item; this item only
 * records its name once it has been renamed.
 */
export type TabItem = Base & { kind: "tab"; name: string; order: number };

/** Which tab a story card or a box is on. Absent means the first tab. */
export type PlaceItem = Base & { kind: "place"; target: string; tab: string };

/**
 * Someone worth talking to for this subject: named in the stories, or
 * suggested as connected to them. Contact details are only ever copied from
 * the material or typed by the reader — never guessed.
 */
export type ContactItem = Base & {
  kind: "contact";
  name: string;
  role: string;
  why: string;
  /** Card ids the person comes from. */
  refs: string[];
  /** In the stories themselves, or suggested as connected to them. */
  origin: "story" | "suggested" | "you";
  email?: string;
  phone?: string;
  /** Their LinkedIn profile, as typed in. */
  linkedin?: string;
  /** The reader's own notes on them: when they called, what they said. */
  notes?: string;
  /** A small headshot, as a data: URL — added by the reader or the extension. */
  photo?: string;
  /** Where the email came from: the stories, or typed in. */
  emailFrom?: "story" | "you";
  state: "pending" | "kept" | "dismissed";
  /** Whether the reader means to reach them, and whether they have. */
  outreach?: "want" | "reached";
  /**
   * Blocks the reader tagged this person on: story cards (by card id) and
   * boxes, section labels included — a tagged label stands for everything
   * filed under it. Kept on the person, so the tags travel with them.
   */
  tagged?: string[];
  /** When they were last tagged on something, so the people being tagged lately are offered first. */
  taggedAt?: number;
};

/**
 * What was learned about a story after it was filed — its date, author and
 * outlet, read from the article itself — for stories saved before those were
 * kept, or from a page the feed said little about.
 */
/**
 * What was learned about a story after it was filed: its date, author and
 * outlet, read off the article — and its headline, when the full text was
 * scanned or fetched and the page's own title differs from the one it was
 * filed under (a link titled from its address, a feed's shortened headline).
 */
export type CardInfoItem = Base & { kind: "cardinfo"; card: string; title?: string; publishedAt?: string; author?: string; source?: string };

/**
 * A subject's cards for a story given the story's full text: each one whose
 * headline differs takes the article's, and picks up a date, author or
 * outlet it lacked. Returns the board unchanged (the same object) when there
 * is nothing to change, so a caller can tell.
 */
export function retitleCards(
  note: Note,
  board: Board | undefined,
  links: string[],
  found: { title: string; publishedAt?: string; author?: string; source?: string },
  now = Date.now(),
): Board | undefined {
  const title = found.title.replace(/\s+/g, " ").trim().slice(0, 300);
  if (!title) return board;
  const keys = new Set(links.filter(Boolean).map((link) => canonicalUrl(link)));
  let next = board;
  for (const card of cardsOf(note, board)) {
    if (!keys.has(card.id) || card.title === title) continue;
    const held = next?.[cardInfoId(card.id)];
    const info = held && held.kind === "cardinfo" && !held.deleted ? held : undefined;
    next = put(next, {
      id: cardInfoId(card.id),
      kind: "cardinfo",
      card: card.id,
      title,
      publishedAt: info?.publishedAt ?? found.publishedAt,
      author: info?.author ?? found.author?.slice(0, 120),
      source: info?.source ?? found.source?.slice(0, 120),
      at: now,
    }, now);
  }
  return next;
}

export function cardInfoId(cardId: string) {
  return `cardinfo:${cardId}`;
}

export type BoardItem =
  | CardInfoItem
  | ContactItem
  | StoryItem
  | CardNoteItem
  | BoxItem
  | PosItem
  | LinkItem
  | InsightItem
  | SuggestItem
  | MetaItem
  | TabItem
  | PlaceItem
  | PinItem;

/**
 * Whether a subject is pinned to the top of the Subjects list. An item of its
 * own rather than a field on the meta item: the meta item is rewritten by tab
 * switches and AI runs on every device, and a copy from a device that had not
 * yet heard of the pin would take it away.
 */
export type PinItem = Base & { kind: "pin"; pinned: boolean };
export const PIN_ID = "pin";

export const isPinned = (board: Board | undefined) => {
  const item = board?.[PIN_ID];
  return Boolean(item && item.kind === "pin" && !item.deleted && item.pinned);
};

export type Board = Record<string, BoardItem>;
/** Every subject's board, keyed by the note it belongs to. */
export type Boards = Record<string, Board>;

const KEY = "super-reader:boards:v1";
/** A deletion only has to outlive the slowest device's absence. */
const TOMBSTONE_TTL_MS = 90 * 24 * 60 * 60 * 1000;
/** The boards' share of the synced document, which has a 512KB ceiling. */
export const BOARDS_SYNC_BUDGET = 150 * 1024;
export const MAX_HTML = 20_000;

/*
 * Boards live in IndexedDB. They used to live in localStorage, which a
 * browser caps at about 5 MB per site — a few dozen pictures — and a phone
 * filled it, after which nothing new was kept on the device. IndexedDB is
 * given hundreds of megabytes. A device with boards still in localStorage
 * moves them across on first load and frees that room.
 */
const DB = "super-reader-boards";
const STORE = "kv";
let cache: Boards | null = null;

function idb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function idbGet(): Promise<Boards | null> {
  const db = await idb();
  return new Promise((resolve, reject) => {
    const q = db.transaction(STORE).objectStore(STORE).get(KEY);
    q.onsuccess = () => resolve((q.result as Boards) ?? null);
    q.onerror = () => reject(q.error);
  });
}

async function idbPut(boards: Boards): Promise<void> {
  const db = await idb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).put(boards, KEY);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

function fromLocal(): Boards {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(KEY) ?? "{}");
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

/** What is known at once: the copy already read this session, or one still in localStorage. */
export function loadBoards(): Boards {
  if (typeof window === "undefined") return {};
  return cache ?? fromLocal();
}

/** The device's boards from IndexedDB, moving any still in localStorage across first. */
export async function loadBoardsAsync(): Promise<Boards> {
  if (typeof window === "undefined") return {};
  const local = fromLocal();
  try {
    const held = (await idbGet()) ?? {};
    const merged = Object.keys(local).length ? mergeBoards(held, local) : held;
    if (Object.keys(local).length) {
      await idbPut(merged);
      window.localStorage.removeItem(KEY);
    }
    cache = merged;
    return merged;
  } catch {
    // No IndexedDB here (some private modes): localStorage, as before.
    return local;
  }
}

/** Said when this device's storage stops (true) or starts again (false) taking the writing. */
export const STORAGE_FULL_EVENT = "super-reader:storage-full";
let full = false;
/** Tell the app, once per change, whether the last write to this device's storage worked. */
export function reportStored(ok: boolean) {
  if (full === !ok || typeof window === "undefined") return;
  full = !ok;
  window.dispatchEvent(new CustomEvent(STORAGE_FULL_EVENT, { detail: full }));
}

let pending: Boards | null = null;
let writing: Promise<void> | null = null;

/** Kept on the device: written to IndexedDB, the latest copy only, one write at a time. */
export function saveBoards(boards: Boards) {
  cache = boards;
  pending = boards;
  if (writing) return;
  writing = (async () => {
    while (pending) {
      const next = pending;
      pending = null;
      try {
        await idbPut(next);
        reportStored(true);
      } catch {
        try {
          window.localStorage.setItem(KEY, JSON.stringify(next));
          reportStored(true);
        } catch {
          // Storage full: the board still holds for this session, and the reader is told.
          reportStored(false);
        }
      }
    }
  })().finally(() => {
    writing = null;
  });
}

export function newItemId(prefix = "i") {
  return `${prefix}${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * When an item was made, for reading order: a block's `at` moves every time
 * it is edited, which would send the block being written in to the bottom of
 * the document. Ids from newItemId carry their making time; older ids, which
 * do not, fall back to `at`.
 */
export function madeAt(item: { id: string; at: number }): number {
  const stamp = item.id.length > 14 ? parseInt(item.id.slice(-14, -6), 36) : NaN;
  return stamp > 1.5e12 && stamp <= item.at + 1000 ? stamp : item.at;
}

/** The live items of a board, without the tombstones. */
export function live(board: Board | undefined): BoardItem[] {
  return Object.values(board ?? {}).filter((item) => !item.deleted);
}

export function metaOf(board: Board | undefined): MetaItem {
  const found = board?.meta;
  return found && found.kind === "meta"
    ? found
    : { id: "meta", kind: "meta", at: 0, view: "doc" };
}

/** Write one item, stamped now — or later than whatever it replaces. */
export function put(board: Board | undefined, item: BoardItem, now = Date.now()): Board {
  const previous = board?.[item.id];
  const at = Math.max(now, (previous?.at ?? 0) + 1);
  return { ...(board ?? {}), [item.id]: { ...item, at } as BoardItem };
}

export function remove(board: Board | undefined, id: string, now = Date.now()): Board {
  const previous = board?.[id];
  if (!previous || previous.deleted) return board ?? {};
  return put(board, { ...previous, deleted: true }, now);
}

/**
 * Two devices' boards, merged item by item: the more recent change wins,
 * whether it was an edit, a move or a deletion.
 */
export function mergeBoards(mine: Boards, theirs: Boards, now = Date.now()): Boards {
  const merged: Boards = {};
  for (const subject of new Set([...Object.keys(mine ?? {}), ...Object.keys(theirs ?? {})])) {
    const board: Board = {};
    for (const source of [mine?.[subject] ?? {}, theirs?.[subject] ?? {}]) {
      for (const [id, item] of Object.entries(source)) {
        if (!item || typeof item !== "object" || typeof item.at !== "number") continue;
        const held = board[id];
        if (!held || item.at > held.at) board[id] = item;
      }
    }
    merged[subject] = pruneBoard(board, now);
  }
  return merged;
}

/** Tombstones that have done their job, and suggestions nobody wanted. */
export function pruneBoard(board: Board, now = Date.now()): Board {
  const kept: Board = {};
  for (const [id, item] of Object.entries(board)) {
    if (item.deleted && now - item.at > TOMBSTONE_TTL_MS) continue;
    kept[id] = item;
  }
  return kept;
}

/**
 * Boards for subjects that were deleted are let go. Only a deletion counts: a
 * board whose subject this device simply has not received yet is kept, or a
 * sync arriving in the wrong order would throw away someone's board.
 */
export function pruneBoards(boards: Boards, deletedIds: ReadonlySet<string>): Boards {
  const kept: Boards = {};
  for (const [id, board] of Object.entries(boards)) if (!deletedIds.has(id)) kept[id] = board;
  return kept;
}

/**
 * The copy that goes over the wire. The AI's work goes first when the budget
 * is short — it can be run again, and what you wrote cannot.
 */
export function slimBoardsForSync(boards: Boards, budget = BOARDS_SYNC_BUDGET): Boards {
  const size = (value: unknown) => JSON.stringify(value).length;
  if (size(boards) <= budget) return boards;
  const without = (kinds: string[]) =>
    Object.fromEntries(
      Object.entries(boards).map(([id, board]) => [
        id,
        Object.fromEntries(
          Object.entries(board).filter(([, item]) => !kinds.includes(item.kind)),
        ),
      ]),
    ) as Boards;
  const lighter = without(["insight", "suggest"]);
  if (size(lighter) <= budget) return lighter;
  const leaner = without(["insight", "suggest", "pos", "link"]);
  if (size(leaner) <= budget) return leaner;
  // Pictures last of all: they stay with the account and on the device.
  return Object.fromEntries(
    Object.entries(leaner).map(([id, board]) => [
      id,
      Object.fromEntries(
        Object.entries(board).map(([key, item]) => [key, item.kind === "box" && item.image ? { ...item, image: undefined } : item]),
      ),
    ]),
  ) as Boards;
}


export function sameBoards(a: Boards, b: Boards): boolean {
  return JSON.stringify(sortKeys(a)) === JSON.stringify(sortKeys(b));
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.keys(value as Record<string, unknown>)
      .sort()
      .map((key) => [key, sortKeys((value as Record<string, unknown>)[key])]),
  );
}

/* ------------------------------------------------------------------------ */
/* Cards                                                                     */
/* ------------------------------------------------------------------------ */

export type Card = {
  /** The article's canonical link — the same story under two tags is one card. */
  id: string;
  link: string;
  title: string;
  source?: string;
  publishedAt?: string;
  author?: string;
  quotes: { id: string; text: string }[];
  note: string;
  /** When the story first arrived in the subject; the feed view's order. */
  at: number;
  /** The block it reads right below in the document (see StoryItem.after). */
  after?: string;
};

/**
 * One card per story: every article quoted into the note, and every story
 * added to the subject directly or accepted from the suggestions.
 */
export function cardsOf(note: Note, board: Board | undefined): Card[] {
  const cards = new Map<string, Card>();
  const ensure = (
    link: string,
    title: string,
    source: string | undefined,
    at: number,
    extra: { publishedAt?: string; author?: string } = {},
  ) => {
    const id = canonicalUrl(link);
    let card = cards.get(id);
    if (!card) {
      card = { id, link, title, source, quotes: [], note: "", at };
      cards.set(id, card);
    } else {
      card.at = Math.min(card.at, at);
      if (!card.source && source) card.source = source;
    }
    if (!card.publishedAt && extra.publishedAt) card.publishedAt = extra.publishedAt;
    if (!card.author && extra.author) card.author = extra.author;
    return card;
  };

  for (const entry of note.entries) {
    if (!isQuote(entry)) continue;
    ensure(entry.link, entry.articleTitle, entry.sourceTitle, entry.at, entry).quotes.push({
      id: entry.id,
      text: entry.text,
    });
  }
  for (const item of live(board)) {
    if (item.kind === "story") {
      const card = ensure(item.link, item.title, item.source, item.since ?? item.at, item);
      if (item.after && item.after !== card.id) card.after ??= item.after;
    }
    if (item.kind === "suggest" && item.state === "accepted") {
      ensure(item.link, item.title, item.source, item.at);
    }
  }
  for (const item of live(board)) {
    if (item.kind === "cardinfo") {
      const card = cards.get(item.card);
      if (card) {
        // The article's own headline, once its text has been read, is the one to show.
        if (item.title) card.title = item.title;
        card.publishedAt ??= item.publishedAt;
        card.author ??= item.author;
        // A story added from its link is named after its address until its page is read; the outlet's own name wins over that.
        if (item.source && (!card.source || /^[a-z0-9-]+(\.[a-z0-9-]+)+$/i.test(card.source))) card.source = item.source;
      }
    }
    if (item.kind === "cardnote") {
      const card = cards.get(item.card);
      if (card) card.note = item.html;
    }
  }
  return [...cards.values()].sort((a, b) => a.at - b.at);
}

export function cardNoteId(cardId: string) {
  return `note:${cardId}`;
}

export function posId(target: string) {
  return `pos:${target}`;
}

/** Add a story to a subject without a quote. Adding it twice is a no-op. */
export function addStory(
  board: Board | undefined,
  story: { link: string; title: string; source?: string; publishedAt?: string; author?: string; after?: string },
  now = Date.now(),
): Board {
  const id = `story:${canonicalUrl(story.link)}`;
  const held = board?.[id];
  if (held && !held.deleted) return board ?? {};
  return put(
    board,
    {
      id,
      kind: "story",
      link: story.link,
      title: story.title,
      source: story.source,
      publishedAt: story.publishedAt,
      author: story.author,
      ...(story.after ? { after: story.after } : {}),
      at: now,
    },
    now,
  );
}

/**
 * Old notes' own writing, brought onto the board once as a text box, so a
 * subject opened from a note that has thoughts in it does not appear to have
 * lost them. The note's entries are left as they were, so switching Subjects
 * off again shows the note exactly as it was.
 */
export function migrateNoteWriting(note: Note, board: Board | undefined, now = Date.now()): Board {
  const meta = metaOf(board);
  if (meta.migrated) return board ?? {};
  let next = board ?? {};
  const writing = note.entries
    .filter((entry) => !isQuote(entry))
    .map((entry) => entry.text.trim())
    .filter(Boolean);
  if (writing.length > 0) {
    const html = writing.map((line) => `<p>${escapeHtml(line)}</p>`).join("");
    next = put(next, { id: newItemId("box"), kind: "box", html, at: now }, now);
  }
  return put(next, { ...meta, migrated: true }, now);
}

export function escapeHtml(text: string) {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Plain text from a board's HTML, for the AI and for fingerprints. */
export function textOf(html: string): string {
  return html
    .replace(/<\/(p|div|li|h\d)>/gi, "\n")
    .replace(/<li[^>]*>/gi, "• ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, "&")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/* ------------------------------------------------------------------------ */
/* What the AI is given, and what it gives back                              */
/* ------------------------------------------------------------------------ */

export type SynthesisInput = {
  /** Which AI to ask, and which model: the deep one for the analysis, the quick one for suggested reading. */
  provider?: "anthropic" | "openai";
  model?: string;
  quickModel?: string;
  subject: string;
  cards: { id: string; title: string; source?: string; quotes: string[]; note: string }[];
  boxes: string[];
  /** Links already on the board or already suggested, so they are not suggested again. */
  known: string[];
};

export function synthesisInput(note: Note, board: Board | undefined): SynthesisInput {
  const cards = cardsOf(note, board);
  const known = new Set(cards.map((card) => card.id));
  for (const item of live(board)) {
    if (item.kind === "suggest") known.add(canonicalUrl(item.link));
  }
  return {
    subject: note.name,
    cards: cards.map((card) => ({
      id: card.id,
      title: card.title,
      source: card.source,
      quotes: card.quotes.map((quote) => quote.text.slice(0, 1200)),
      note: textOf(withoutQuotes(card.note)).slice(0, 1500),
    })),
    boxes: live(board)
      .filter((item): item is BoxItem => item.kind === "box")
      .map((box) => textOf(box.html).slice(0, 1500))
      .filter(Boolean),
    known: [...known],
  };
}

/**
 * What a run would be given, reduced to a fingerprint. Positions, links and
 * the AI's own output are left out: moving a card is not new material.
 */
export function signatureOf(input: SynthesisInput): string {
  const text = JSON.stringify([input.subject, input.cards, input.boxes]);
  let hash = 5381;
  for (let i = 0; i < text.length; i += 1) hash = ((hash << 5) + hash + text.charCodeAt(i)) | 0;
  return `${input.cards.length}:${(hash >>> 0).toString(36)}`;
}

/** A run needs two stories at least — there is nothing to connect in one. */
export const MIN_CARDS_FOR_RUN = 2;
/** Automatic runs are lightweight and spaced out; the button is not. */
export const AUTO_RUN_GAP_MS = 15 * 60 * 1000;

export function shouldAutoRun(
  input: SynthesisInput,
  meta: MetaItem,
  now = Date.now(),
): boolean {
  if (input.cards.length < MIN_CARDS_FOR_RUN) return false;
  if (meta.sig === signatureOf(input)) return false;
  return !meta.ranAt || now - meta.ranAt >= AUTO_RUN_GAP_MS;
}

export type FoundContact = { name: string; role: string; why: string; refs: string[]; origin: "story" | "suggested"; email?: string };

export type SynthesisResult = {
  contacts?: FoundContact[];
  insights: { type: InsightKind; text: string; refs: string[] }[];
  suggestions: { link: string; title: string; source?: string; why: string }[];
  /** Tokens the provider reported, for the spending page. */
  usage?: { provider: "anthropic" | "openai"; model: string; input: number; output: number };
  /** Each call's tokens, by the activity it was for. */
  usages?: { provider: "anthropic" | "openai"; model: string; input: number; output: number; activity: "insights" | "reading" }[];
};

/**
 * Fold a run into the board: the previous run's insights are replaced, and
 * suggestions are added beside the ones already there — a suggestion you
 * accepted or dismissed stays decided.
 */
export function applySynthesis(
  board: Board | undefined,
  input: SynthesisInput,
  result: SynthesisResult,
  now = Date.now(),
): Board {
  let next = board ?? {};
  const run = newItemId("run");
  const cardIds = new Set(input.cards.map((card) => card.id));

  for (const item of live(next)) {
    if (item.kind === "insight") next = remove(next, item.id, now);
  }
  result.insights.forEach((insight, index) => {
    next = put(
      next,
      {
        id: `insight:${run}:${index}`,
        kind: "insight",
        type: insight.type,
        text: insight.text,
        refs: insight.refs.filter((ref) => cardIds.has(ref)),
        run,
        at: now,
      },
      now,
    );
  });

  const known = new Set(input.known);
  for (const suggestion of result.suggestions) {
    const key = canonicalUrl(suggestion.link);
    if (known.has(key)) continue;
    known.add(key);
    next = put(
      next,
      {
        id: `suggest:${key}`,
        kind: "suggest",
        link: suggestion.link,
        title: suggestion.title,
        source: suggestion.source,
        why: suggestion.why,
        state: "pending",
        at: now,
      },
      now,
    );
  }

  for (const found of result.contacts ?? []) next = putContact(next, found, cardIds, now);

  return put(next, { ...metaOf(next), sig: signatureOf(input), ranAt: now }, now);
}

/** One id per person, so a later run updates them rather than adding a twin. */
export function contactId(name: string) {
  const slug = name.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60);
  return `contact:${slug || "someone"}`;
}

/**
 * A person from a run. What the reader did with them stays: a dismissed
 * person is not brought back, and details typed in are never overwritten.
 */
function putContact(board: Board, found: FoundContact, cardIds: Set<string>, now: number): Board {
  const name = found.name.trim().slice(0, 120);
  if (!name) return board;
  const id = contactId(name);
  const held = board[id];
  const existing = held && held.kind === "contact" && !held.deleted ? held : undefined;
  if (existing?.state === "dismissed") return board;
  const email = existing?.email || found.email || undefined;
  return put(
    board,
    {
      id,
      kind: "contact",
      name: existing?.origin === "you" ? existing.name : name,
      role: found.role.trim().slice(0, 200) || existing?.role || "",
      why: found.why.trim().slice(0, 400) || existing?.why || "",
      refs: [...new Set([...(existing?.refs ?? []), ...found.refs.filter((ref) => cardIds.has(ref))])],
      origin: existing?.origin === "you" ? "you" : existing?.origin === "story" ? "story" : found.origin,
      email,
      phone: existing?.phone,
      linkedin: existing?.linkedin,
      notes: existing?.notes,
      photo: existing?.photo,
      outreach: existing?.outreach,
      tagged: existing?.tagged,
      taggedAt: existing?.taggedAt,
      emailFrom: existing?.email ? existing.emailFrom : found.email ? "story" : undefined,
      state: existing?.state ?? "pending",
      at: now,
    },
    now,
  );
}

export function contactsOf(board: Board | undefined): ContactItem[] {
  return live(board)
    .filter((item): item is ContactItem => item.kind === "contact" && item.state !== "dismissed")
    .sort((a, b) => (a.origin === b.origin ? a.name.localeCompare(b.name) : a.origin === "story" ? -1 : b.origin === "story" ? 1 : 0));
}

/**
 * Everyone on the contact sheet, as the Contacts panel lists them: the
 * subject's own contacts, and the stories' authors, who are contacts
 * without being asked for (one removed stays removed). An author not yet
 * stored is made up here, and stored the first time anything is done with
 * them — a tag, an edit, a note.
 */
export function contactRoster(contacts: ContactItem[], cards: { id: string; author?: string; source?: string }[], dismissedIds: Iterable<string>): ContactItem[] {
  const held = new Map(contacts.map((c) => [c.id, c]));
  const dismissed = new Set(dismissedIds);
  const authors: ContactItem[] = authorsOf(cards).flatMap(({ name, refs }) => {
    const id = contactId(name);
    if (dismissed.has(id)) return [];
    const mine = held.get(id);
    return [
      mine
        ? { ...mine, refs: [...new Set([...refs, ...mine.refs])] }
        : { id, kind: "contact" as const, name, role: "Author", why: "", refs, origin: "story" as const, state: "kept" as const, at: 0 },
    ];
  });
  const authorIds = new Set(authors.map((a) => a.id));
  return [...authors, ...contacts.filter((c) => !authorIds.has(c.id))];
}

/** "Maria Lopez" → "ML"; one name gives one letter. */
export function initialsOf(name: string): string {
  return name.trim().split(/\s+/).filter(Boolean).slice(0, 2).map((w) => [...w][0] ?? "").join("").toUpperCase() || "?";
}

/** The blocks filed under a section label: whatever a line joins to it, other labels aside. */
export function sectionMembers(board: Board | undefined, labelId: string): string[] {
  const out: string[] = [];
  for (const item of live(board)) {
    if (item.kind !== "link") continue;
    const other = item.from === labelId ? item.to : item.to === labelId ? item.from : null;
    if (!other || out.includes(other)) continue;
    const held = board?.[other];
    if (held && held.kind === "box" && held.label) continue;
    out.push(other);
  }
  return out;
}

/**
 * Everything a person is tagged on: the blocks tagged directly, and every
 * block in a section whose label is tagged.
 */
export function taggedWith(board: Board | undefined, contact: Pick<ContactItem, "tagged"> | undefined): Set<string> {
  const out = new Set<string>();
  for (const id of contact?.tagged ?? []) {
    out.add(id);
    const held = board?.[id];
    if (held && held.kind === "box" && held.label && !held.deleted) for (const member of sectionMembers(board, id)) out.add(member);
  }
  return out;
}

/** A person with blocks tagged (`on`) or untagged; tagging keeps someone only suggested. */
export function withTags(contact: ContactItem, ids: string[], on: boolean, now = Date.now()): ContactItem {
  const tagged = new Set(contact.tagged ?? []);
  for (const id of ids) {
    if (on) tagged.add(id);
    else tagged.delete(id);
  }
  return { ...contact, tagged: [...tagged], state: on ? "kept" : contact.state, ...(on ? { taggedAt: now } : {}), at: now };
}

/** The people to offer for tagging: whoever was tagged most recently first, then the sheet in its own order. */
export function tagOrder(roster: ContactItem[]): ContactItem[] {
  const recent = roster.filter((c) => c.taggedAt).sort((a, b) => (b.taggedAt ?? 0) - (a.taggedAt ?? 0));
  return [...recent, ...roster.filter((c) => !c.taggedAt)];
}

/** Emails written out in some text, lower-cased. */
export function emailsIn(text: string): Set<string> {
  return new Set((text.match(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g) ?? []).map((e) => e.toLowerCase()));
}

/* ------------------------------------------------------------------------ */
/* Rich text                                                                 */
/* ------------------------------------------------------------------------ */

const ALLOWED_TAGS = new Set([
  "img", "p", "div", "br", "b", "strong", "i", "em", "u", "s", "mark", "ul", "ol", "li", "h3", "blockquote", "span", "a",
]);

/**
 * What a text box may hold. Its HTML comes back from another device through
 * sync, so it is treated as untrusted every time it is shown: tags outside a
 * short list are unwrapped, and no attribute survives except a highlight.
 */
/** Whether a span's style paints a real background — not transparent, not white. */
function isHighlight(style: string): boolean {
  const value = style.match(/background(?:-color)?\s*:\s*([^;"']+)/i)?.[1]?.trim().toLowerCase();
  if (!value) return false;
  if (/^(transparent|none|inherit|initial|unset|white|#fff|#ffffff)\b/.test(value)) return false;
  if (/^rgba?\(\s*255\s*,\s*255\s*,\s*255\s*(,\s*[\d.]+\s*)?\)/.test(value)) return false;
  if (/^rgba\([^)]*,\s*0(\.0*)?\s*\)/.test(value)) return false;
  return true;
}

export function sanitizeRichText(html: string): string {
  const out: string[] = [];
  const stack: string[] = [];
  const spanClosers: string[] = [];
  const pattern = /<\/?([a-zA-Z0-9]+)([^>]*)>|([^<]+)/g;
  let match: RegExpExecArray | null;
  const source = String(html ?? "")
    // A drawing or picture set into the text is kept by reference to its own
    // box — never as a src, which would carry the whole picture through the
    // text and past its size limit.
    .replace(/<img\b[^>]*>/gi, (tag) => {
      const id = tag.match(/data-embed=["']?([A-Za-z0-9_:-]{1,60})/)?.[1];
      const w = Number(tag.match(/data-w=["']?(\d{2,4})/)?.[1]);
      return id ? `<img data-embed="${id}"${w >= 40 && w <= 2000 ? ` data-w="${w}"` : ""}>` : "";
    })
    .slice(0, MAX_HTML)
    // Google Docs wraps everything it copies in a <b style="font-weight:normal">: not bold.
    .replace(/^([\s\S]*?)<b\b[^>]*docs-internal-guid[^>]*>([\s\S]*)<\/b>/i, "$1$2")
    .replace(/<(script|style|iframe|object|embed|template)[\s\S]*?<\/\1>/gi, "")
    .replace(/<!--[\s\S]*?-->/g, "");
  while ((match = pattern.exec(source))) {
    if (match[3] !== undefined) {
      out.push(match[3].replace(/</g, "&lt;").replace(/>/g, "&gt;"));
      continue;
    }
    const closing = match[0].startsWith("</");
    let tag = match[1].toLowerCase();
    if (tag === "strong") tag = "b";
    if (tag === "em") tag = "i";
    if (!ALLOWED_TAGS.has(tag)) continue;
    // A highlight from execCommand arrives as a coloured span; keep it as a
    // <mark> and drop everything else a span might carry.
    // Text pasted from Google Docs is all spans: bold and italic come as
    // styles, and every span declares a transparent background — which is
    // not a highlight.
    if (tag === "span") {
      if (closing) {
        const index = stack.lastIndexOf("span");
        if (index >= 0) {
          stack.splice(index, 1);
          out.push(spanClosers.pop() ?? "");
        }
        continue;
      }
      const style = match[2].match(/style\s*=\s*("[^"]*"|'[^']*')/i)?.[1] ?? "";
      const tags: string[] = [];
      if (isHighlight(style)) tags.push("mark");
      if (/font-weight\s*:\s*(bold|[6-9]00)/i.test(style)) tags.push("b");
      if (/font-style\s*:\s*italic/i.test(style)) tags.push("i");
      if (tags.length) {
        stack.push("span");
        spanClosers.push(tags.map((t) => `</${t}>`).reverse().join(""));
        out.push(tags.map((t) => `<${t}>`).join(""));
      }
      continue;
    }
    // A quote is a link to its passage, by the quote's id — never an href, so
    // nothing synced can smuggle a destination in.
    if (tag === "a" && !closing) {
      // A link to another subject (lib/subject-links.ts): by its id alone, never an address.
      const subjectId = match[2].match(/data-subject=(?:"([A-Za-z0-9_-]{1,40})"|'([A-Za-z0-9_-]{1,40})'|([A-Za-z0-9_-]{1,40})(?=[\s/>]|$))/)?.slice(1).find(Boolean);
      if (subjectId) {
        stack.push("a");
        out.push(`<a data-subject="${subjectId}" contenteditable="false">`);
        continue;
      }
      const id = match[2].match(/data-quote=["']?([A-Za-z0-9_-]{1,40})/)?.[1];
      if (id) {
        stack.push("a");
        out.push(`<a data-quote="${id}">`);
        continue;
      }
      // A story from the subject, cited: a headline chip, or words linked to it.
      const cite = match[2].match(/data-cite=["']?(chip|text|card)/)?.[1];
      const citeHref = cite ? safeHref(match[2].match(/href\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i)?.slice(1).find(Boolean)) : null;
      if (cite && citeHref) {
        const title = (match[2].match(/title="([^"]*)"/)?.[1] ?? "").replace(/[<>"]/g, "").slice(0, 300);
        stack.push("a");
        out.push(cite === "chip" || cite === "card"
          ? `<a data-cite="${cite}" href="${citeHref}"${title ? ` title="${title}"` : ""} contenteditable="false" target="_blank" rel="noopener noreferrer">`
          : `<a data-cite="text" href="${citeHref}" target="_blank" rel="noopener noreferrer">`);
        continue;
      }
      // A link the writer made: web addresses only, opened apart from the app.
      const href = safeHref(match[2].match(/href\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i)?.slice(1).find(Boolean));
      if (!href) continue;
      stack.push("a");
      out.push(`<a href="${href}" target="_blank" rel="noopener noreferrer">`);
      continue;
    }
    if (tag === "br") {
      out.push("<br>");
      continue;
    }
    if (tag === "img") {
      const id = match[2].match(/data-embed="([A-Za-z0-9_:-]{1,60})"/)?.[1];
      // The width the writer dragged it to, if they did.
      const w = Number(match[2].match(/data-w="(\d{2,4})"/)?.[1]);
      if (id && !closing) out.push(`<img data-embed="${id}"${w >= 40 && w <= 2000 ? ` data-w="${w}"` : ""}>`);
      continue;
    }
    if (closing) {
      const index = stack.lastIndexOf(tag);
      if (index < 0) continue;
      while (stack.length > index) {
        const open = stack.pop()!;
        out.push(open === "span" ? "</mark>" : `</${open}>`);
      }
    } else {
      stack.push(tag);
      // A checklist: a list marked as one, and each item ticked or not.
      if (tag === "ul" && /\bdata-check\b/.test(match[2])) out.push(`<ul data-check="">`);
      // A lettered list: a numbered one counting a, b, c.
      else if (tag === "ol") {
        // Lettered (a, b, c or A, B, C), and where it counts from.
        const type = match[2].match(/\btype=["']?([aA])\b/)?.[1];
        const start = Number(match[2].match(/\bstart=["']?(\d{1,3})\b/)?.[1]);
        out.push(`<ol${type ? ` type="${type}"` : ""}${start > 1 ? ` start="${start}"` : ""}>`);
      }
      else if (tag === "li" && /\bdata-checked=["']?true/.test(match[2])) out.push(`<li data-checked="true">`);
      else out.push(`<${tag}>`);
    }
  }
  while (stack.length) {
    const open = stack.pop()!;
    out.push(open === "span" ? "</mark>" : `</${open}>`);
  }
  return out.join("");
}

/* ------------------------------------------------------------------------ */
/* Quotes inside a card's writing                                           */
/* ------------------------------------------------------------------------ */

/** The quotes a card's document still holds, by id. */
export function quoteIdsIn(html: string): Set<string> {
  return new Set([...html.matchAll(/data-quote="([A-Za-z0-9_-]+)"/g)].map((m) => m[1]));
}

/**
 * A card's document: what was written on it, with every quote the subject
 * holds for that story present as a bullet. A quote is only ever added here,
 * never rewritten — once it is in the document its words are the reader's to
 * edit, and what it links to stays the original passage, kept on the note.
 * A new quote joins the list the last quote is in, or starts one at the top.
 */
export function composeCardDoc(html: string, quotes: { id: string; text: string }[]): string {
  const present = quoteIdsIn(html);
  const missing = quotes.filter((quote) => !present.has(quote.id));
  const nodes = liftQuotes(parseHtml(html));
  if (missing.length > 0) {
    const items: HtmlNode[] = missing.map((quote) => ({
      tag: "li",
      open: "<li>",
      children: [{ tag: "a", open: `<a data-quote="${quote.id}">`, children: [`“${escapeHtml(quote.text.trim())}”`] }],
    }));
    // After the last top-level list holding a quote, at its own level —
    // never inside a note nested under the last quote.
    const lists = nodes.filter((n): n is HtmlNode => typeof n !== "string" && n.tag === "ul" && n.children.some(isQuoteItem));
    const target = lists[lists.length - 1];
    if (target) target.children.push(...items);
    else nodes.unshift({ tag: "ul", open: "<ul>", children: items });
  }
  return serializeHtml(nodes);
}

/* A minimal tree for the card's own (sanitised, well-formed) HTML. */
type HtmlNode = { tag: string; open: string; children: (HtmlNode | string)[] };
const VOID_TAGS = new Set(["br", "img"]);

function parseHtml(html: string): (HtmlNode | string)[] {
  const root: HtmlNode = { tag: "", open: "", children: [] };
  const stack = [root];
  const pattern = /<(\/?)([a-zA-Z0-9]+)([^>]*)>|([^<]+)/g;
  for (let m = pattern.exec(html); m; m = pattern.exec(html)) {
    const top = stack[stack.length - 1];
    if (m[4] !== undefined) {
      top.children.push(m[4]);
      continue;
    }
    const tag = m[2].toLowerCase();
    if (m[1]) {
      const at = stack.map((n) => n.tag).lastIndexOf(tag);
      if (at > 0) stack.length = at;
      continue;
    }
    const node: HtmlNode = { tag, open: m[0], children: [] };
    top.children.push(node);
    if (!VOID_TAGS.has(tag) && !m[3].trim().endsWith("/")) stack.push(node);
  }
  return root.children;
}

function serializeHtml(nodes: (HtmlNode | string)[]): string {
  return nodes
    .map((n) => (typeof n === "string" ? n : VOID_TAGS.has(n.tag) ? n.open : `${n.open}${serializeHtml(n.children)}</${n.tag}>`))
    .join("");
}

/** A bullet that is a quote: its first real content is a quote link. */
function isQuoteItem(node: HtmlNode | string): boolean {
  if (typeof node === "string" || node.tag !== "li") return false;
  const first = node.children.find((c) => typeof c !== "string" || c.trim());
  return !!first && typeof first !== "string" && first.tag === "a" && first.open.includes("data-quote=");
}

/**
 * Every quote is a top-level bullet. One that ended up inside a nested list
 * — a quote added after a note under the previous quote, before this was
 * fixed — is lifted back out to sit after the bullet it was under, keeping
 * whatever is nested under it.
 */
function liftQuotes(nodes: (HtmlNode | string)[]): (HtmlNode | string)[] {
  for (const node of nodes) {
    if (typeof node === "string" || node.tag !== "ul") continue;
    const next: (HtmlNode | string)[] = [];
    for (const item of node.children) {
      next.push(item);
      if (typeof item === "string" || item.tag !== "li") continue;
      next.push(...pullQuotes(item));
    }
    node.children = next;
  }
  return nodes;
}

/** Take the quote bullets out of the lists nested in a bullet, in order. */
function pullQuotes(item: HtmlNode): HtmlNode[] {
  const pulled: HtmlNode[] = [];
  for (const child of item.children) {
    if (typeof child === "string" || (child.tag !== "ul" && child.tag !== "ol")) continue;
    const kept: (HtmlNode | string)[] = [];
    for (const li of child.children) {
      if (isQuoteItem(li)) {
        const quote = li as HtmlNode;
        pulled.push(quote, ...pullQuotes(quote));
      } else {
        kept.push(li);
        if (typeof li !== "string" && li.tag === "li") pulled.push(...pullQuotes(li));
      }
    }
    child.children = kept;
  }
  // A nested list left with no bullets goes too.
  item.children = item.children.filter(
    (c) => typeof c === "string" || !(c.tag === "ul" || c.tag === "ol") || c.children.some((li) => typeof li !== "string"),
  );
  return pulled;
}

/** A card's writing without its quotes — the AI is given those separately. */
export function withoutQuotes(html: string): string {
  return html.replace(/<li>\s*<a data-quote="[^"]+">[\s\S]*?<\/a>\s*<\/li>/g, "").replace(/<a data-quote="[^"]+">[\s\S]*?<\/a>/g, "");
}

/* ------------------------------------------------------------------------ */
/* Tabs                                                                      */
/* ------------------------------------------------------------------------ */

export const MAIN_TAB = "main";

export type Tab = { id: string; name: string; order: number };

/** The subject's tabs in order; the first one is always there. */
export function tabsOf(board: Board | undefined): Tab[] {
  const items = live(board).filter((item): item is TabItem => item.kind === "tab");
  const main = items.find((item) => item.id === tabItemId(MAIN_TAB));
  const tabs: Tab[] = [{ id: MAIN_TAB, name: main?.name || "Main", order: 0 }];
  for (const item of items) {
    if (item.id === tabItemId(MAIN_TAB)) continue;
    tabs.push({ id: item.id.slice("tab:".length), name: item.name, order: item.order });
  }
  return tabs.sort((a, b) => a.order - b.order);
}

export function tabItemId(tab: string) {
  return `tab:${tab}`;
}

export function placeId(target: string) {
  return `place:${target}`;
}

/** The tab something is on — the first tab when unplaced or its tab is gone. */
export function tabOf(board: Board | undefined, target: string, tabs = tabsOf(board)): string {
  const place = board?.[placeId(target)];
  if (!place || place.deleted || place.kind !== "place") return MAIN_TAB;
  return tabs.some((tab) => tab.id === place.tab) ? place.tab : MAIN_TAB;
}

/** The tab new things land in. */
export function activeTabOf(board: Board | undefined): string {
  const wanted = metaOf(board).activeTab;
  return wanted && tabsOf(board).some((tab) => tab.id === wanted) ? wanted : MAIN_TAB;
}

export function placeOn(board: Board | undefined, target: string, tab: string, now = Date.now()): Board {
  if (tab === MAIN_TAB) {
    const held = board?.[placeId(target)];
    return held && !held.deleted ? remove(board, placeId(target), now) : (board ?? {});
  }
  return put(board, { id: placeId(target), kind: "place", target, tab, at: now }, now);
}

/** Something new arriving lands on the tab that is open, unless already placed. */
export function placeNew(board: Board | undefined, target: string, now = Date.now()): Board {
  const held = board?.[placeId(target)];
  if (held && !held.deleted) return board ?? {};
  return placeOn(board, target, activeTabOf(board), now);
}

export function addTab(board: Board | undefined, name: string, now = Date.now()): { board: Board; id: string } {
  const id = newItemId("t");
  const order = Math.max(0, ...tabsOf(board).map((tab) => tab.order)) + 1;
  let next = put(board, { id: tabItemId(id), kind: "tab", name: name.trim() || "Untitled tab", order, at: now }, now);
  next = put(next, { ...metaOf(next), activeTab: id }, now);
  return { board: next, id };
}

export function renameTab(board: Board | undefined, tab: string, name: string, now = Date.now()): Board {
  const existing = tabsOf(board).find((t) => t.id === tab);
  return put(board, { id: tabItemId(tab), kind: "tab", name: name.trim() || existing?.name || "Untitled tab", order: existing?.order ?? 0, at: now }, now);
}

/**
 * Close a tab. Its stories and boxes move to the first tab rather than
 * vanishing with it — a tab is a way of arranging things, not a bin.
 */
export function deleteTab(board: Board | undefined, tab: string, now = Date.now()): Board {
  if (tab === MAIN_TAB) return board ?? {};
  let next = board ?? {};
  for (const item of live(next)) {
    if (item.kind === "place" && item.tab === tab) next = remove(next, item.id, now);
  }
  next = remove(next, tabItemId(tab), now);
  if (metaOf(next).activeTab === tab) next = put(next, { ...metaOf(next), activeTab: MAIN_TAB }, now);
  return next;
}

/* ------------------------------------------------------------------------ */
/* A note jotted under a quote as it is filed                                */
/* ------------------------------------------------------------------------ */

/** The bullets of some HTML, or nothing when every bullet is empty. */
function noteBullets(html: string): string {
  const clean = sanitizeRichText(html);
  const text = clean.replace(/<[^>]+>/g, "").replace(/&nbsp;|\s/g, "");
  if (!text) return "";
  const body = clean.trim();
  // Already a list: use its items. Plain lines each become a bullet.
  const listed = body.match(/^<ul>([\s\S]*)<\/ul>$/);
  if (listed) return listed[1];
  return body
    .split(/<br\s*\/?>|<\/?p>|<\/?div>/)
    .map((line) => line.trim())
    .filter((line) => line.replace(/<[^>]+>/g, "").trim())
    .map((line) => `<li>${line}</li>`)
    .join("");
}

/**
 * Put a note under one quote on its story's card, as bullets one level below
 * the quote — the second-level bullets of the card. Further nesting the
 * writer made is kept. Returns the board unchanged when there is nothing to
 * add or the quote is not on any card.
 */
export function addQuoteNote(
  note: Note,
  board: Board | undefined,
  quoteId: string,
  html: string,
  now = Date.now(),
): Board {
  const bullets = noteBullets(html);
  if (!bullets) return board ?? {};
  const card = cardsOf(note, board).find((c) => c.quotes.some((q) => q.id === quoteId));
  if (!card) return board ?? {};
  const doc = composeCardDoc(card.note, card.quotes);
  const anchor = doc.indexOf(`data-quote="${quoteId}"`);
  const open = anchor >= 0 ? doc.lastIndexOf("<li", anchor) : -1;
  let next: string;
  if (open < 0) {
    next = `${doc}<ul>${bullets}</ul>`;
  } else {
    // The quote's own </li>, past any list already nested inside it.
    const tag = /<li\b|<\/li>/g;
    tag.lastIndex = open;
    let depth = 0;
    let close = -1;
    for (let m = tag.exec(doc); m; m = tag.exec(doc)) {
      depth += m[0] === "</li>" ? -1 : 1;
      if (depth === 0) {
        close = m.index;
        break;
      }
    }
    if (close < 0) {
      next = `${doc}<ul>${bullets}</ul>`;
    } else {
      const before = doc.slice(0, close);
      // A note already under this quote: the new bullets join that list.
      next = /<\/ul>\s*$/.test(before)
        ? before.replace(/<\/ul>\s*$/, `${bullets}</ul>`) + doc.slice(close)
        : `${before}<ul>${bullets}</ul>${doc.slice(close)}`;
    }
  }
  return put(board, { id: cardNoteId(card.id), kind: "cardnote", card: card.id, html: next, at: now }, now);
}

/** "Oct 1, 2026 · Jane Doe · The Outlet" — what is known of a story, in that order. */
export function bylineOf(card: { publishedAt?: string; author?: string; source?: string; link?: string }): string {
  const parts: string[] = [];
  const when = card.publishedAt ? new Date(card.publishedAt) : null;
  if (when && !Number.isNaN(when.getTime())) {
    parts.push(when.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }));
  }
  const author = card.author?.trim();
  // A feed's author is sometimes just the outlet again.
  if (author && author.toLowerCase() !== card.source?.trim().toLowerCase()) parts.push(author.slice(0, 80));
  if (card.source?.trim()) parts.push(card.source.trim());
  else if (card.link) {
    // No outlet name known: its address still says where it is from.
    try {
      parts.push(new URL(card.link).hostname.replace(/^www\./, ""));
    } catch {
      /* not a web address */
    }
  }
  return parts.join(" · ");
}

/**
 * What was written under one quote on its card — the bullets nested beneath
 * it — as plain lines, for showing beside the passage in the article.
 */
export function quoteNotesFor(note: Note, board: Board | undefined, quoteId: string): string[] {
  const card = cardsOf(note, board).find((c) => c.quotes.some((q) => q.id === quoteId));
  if (!card || !card.note) return [];
  const nodes = parseHtml(composeCardDoc(card.note, card.quotes));
  const text = (n: HtmlNode | string): string =>
    typeof n === "string" ? n : n.tag === "ul" || n.tag === "ol" ? "" : n.children.map(text).join("");
  const lines: string[] = [];
  const collect = (list: HtmlNode, depth: number) => {
    for (const li of list.children) {
      if (typeof li === "string" || li.tag !== "li") continue;
      const own = decodeEntities(li.children.map(text).join("")).replace(/\s+/g, " ").trim();
      if (own) lines.push(`${"  ".repeat(depth)}${own}`);
      for (const child of li.children) if (typeof child !== "string" && (child.tag === "ul" || child.tag === "ol")) collect(child, depth + 1);
    }
  };
  for (const top of nodes) {
    if (typeof top === "string" || top.tag !== "ul") continue;
    for (const li of top.children) {
      if (typeof li === "string" || !isQuoteItem(li)) continue;
      if (!li.children.some((c) => typeof c !== "string" && c.tag === "a" && c.open.includes(`data-quote="${quoteId}"`))) continue;
      for (const child of li.children) if (typeof child !== "string" && (child.tag === "ul" || child.tag === "ol")) collect(child, 0);
    }
  }
  return lines;
}

function decodeEntities(text: string) {
  return text.replace(/&nbsp;/g, " ").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, "&");
}

/**
 * The people who wrote the subject's stories, from each story's byline, with
 * the stories each wrote. "By Ann Lee and Sam Roe" is two people; an outlet
 * or a desk standing in for a byline ("Reuters", "Staff") is nobody.
 */
export function authorsOf(cards: { id: string; author?: string; source?: string }[]): { name: string; refs: string[] }[] {
  const found = new Map<string, { name: string; refs: string[] }>();
  for (const card of cards) {
    if (!card.author) continue;
    const names = card.author
      .replace(/^\s*by\s+/i, "")
      .split(/\s*(?:,|;|&|\band\b|\|)\s*/i)
      .map((n) => n.replace(/\s+/g, " ").trim())
      .filter(
        (n) =>
          n.split(" ").length >= 2 &&
          n.split(" ").length <= 5 &&
          !/[@/:]|\d/.test(n) &&
          !/\b(staff|desk|editors?|reporters?|news|team|wire|press|contributors?)\b/i.test(n) &&
          n.toLowerCase() !== card.source?.trim().toLowerCase(),
      );
    for (const name of names) {
      const id = contactId(name);
      const held = found.get(id) ?? { name, refs: [] };
      if (!held.refs.includes(card.id)) held.refs.push(card.id);
      found.set(id, held);
    }
  }
  return [...found.values()];
}

/** A LinkedIn profile address, tidied, or null if it is not one. */
export function cleanLinkedIn(value: string): string | null {
  let text = value.trim();
  if (!text) return null;
  if (!/^https?:\/\//i.test(text)) text = `https://${text}`;
  try {
    const url = new URL(text);
    if (!/(^|\.)linkedin\.com$/i.test(url.hostname) || url.pathname.length < 2) return null;
    return `https://www.linkedin.com${url.pathname.replace(/\/+$/, "")}`;
  } catch {
    return null;
  }
}

/** A link's address if it is an ordinary web address, escaped for an attribute. */
export function safeHref(raw: string | undefined): string | null {
  if (!raw) return null;
  const text = raw.replace(/&amp;/g, "&").trim();
  try {
    const url = new URL(text);
    if (url.protocol !== "https:" && url.protocol !== "http:") return null;
    return url.toString().replace(/&/g, "&amp;").replace(/"/g, "%22").replace(/</g, "%3C").replace(/>/g, "%3E");
  } catch {
    return null;
  }
}

/**
 * A YouTube video's thumbnail, from the video's id in its link — youtube.com
 * watch, shorts, live and embed links and youtu.be — or null for anything else.
 */
export function youtubeThumbnail(link: string): string | null {
  let url: URL;
  try {
    url = new URL(link);
  } catch {
    return null;
  }
  const host = url.hostname.replace(/^(www\.|m\.|music\.)/, "");
  let id: string | null = null;
  if (host === "youtu.be") id = url.pathname.slice(1).split("/")[0];
  else if (host === "youtube.com" || host === "youtube-nocookie.com") {
    id = url.searchParams.get("v") ?? url.pathname.match(/^\/(?:shorts|live|embed|v)\/([^/?#]+)/)?.[1] ?? null;
  }
  return id && /^[A-Za-z0-9_-]{6,20}$/.test(id) ? `https://i.ytimg.com/vi/${id}/hqdefault.jpg` : null;
}

/** The colours a section label can take. */
export const LABEL_COLORS = ["#2563eb", "#7c3aed", "#db2777", "#dc2626", "#ea580c", "#ca8a04", "#16a34a", "#0d9488", "#475569"];

/** A label's colour, if it is one of ours; otherwise the theme's accent. */
export function labelColorOf(box: { labelColor?: string }): string {
  return box.labelColor && LABEL_COLORS.includes(box.labelColor) ? box.labelColor : "var(--accent)";
}

/**
 * The document's reading order: each section label followed by what is
 * linked to it on the whiteboard (top to bottom, as placed there), and
 * everything else where it was added. Without this the document listed
 * blocks by when they were made, so a header's content could sit pages
 * away from it.
 */
export function documentOrder(entries: { id: string; at: number; label?: boolean; after?: string }[], board: Board | undefined): string[] {
  const byId = new Map(entries.map((e) => [e.id, e]));
  // A story pasted in as a link reads right below the block it was pasted
  // into — as long as that block is here, and the chain of such stories
  // leads back to one that is placed the ordinary way.
  const anchorOf = (id: string) => {
    const after = byId.get(id)?.after;
    return after && after !== id && byId.has(after) ? after : null;
  };
  const follows = new Map<string, string>();
  for (const entry of entries) {
    const anchor = anchorOf(entry.id);
    if (!anchor) continue;
    let at: string | null = anchor;
    const seen = new Set([entry.id]);
    while (at && !seen.has(at)) {
      seen.add(at);
      at = anchorOf(at);
    }
    if (!at) follows.set(entry.id, anchor);
  }
  const pos = new Map<string, { x: number; y: number }>();
  const links: LinkItem[] = [];
  for (const item of live(board)) {
    if (item.kind === "pos") pos.set((item as PosItem).target, item as PosItem);
    else if (item.kind === "link") links.push(item as LinkItem);
  }
  const sorted = [...entries].sort((a, b) => a.at - b.at);
  const owner = new Map<string, string>();
  for (const label of sorted) {
    if (!label.label) continue;
    for (const l of links) {
      const other = l.from === label.id ? l.to : l.to === label.id ? l.from : null;
      if (other && byId.has(other) && !byId.get(other)!.label && !owner.has(other) && !follows.has(other)) owner.set(other, label.id);
    }
  }
  const place = (id: string) => pos.get(id) ?? { x: Infinity, y: Infinity };
  const out: string[] = [];
  const emit = (id: string) => {
    out.push(id);
    // Pasted one after another below the same block, they read in the order they were pasted.
    for (const next of sorted) if (follows.get(next.id) === id) emit(next.id);
  };
  for (const entry of sorted) {
    if (owner.has(entry.id) || follows.has(entry.id)) continue;
    emit(entry.id);
    if (!entry.label) continue;
    const members = sorted.filter((e) => owner.get(e.id) === entry.id);
    members.sort((a, b) => place(a.id).y - place(b.id).y || place(a.id).x - place(b.id).x || a.at - b.at);
    for (const m of members) emit(m.id);
  }
  return out;
}

/**
 * A comment on a transcript, as a bullet on the card beside it that
 * collects them. The first comment makes that card: placed to the
 * transcript's right on the whiteboard and linked to it.
 */
export function addTranscriptNote(board: Board | undefined, transcriptId: string, itemHtml: string, newId: string, now = Date.now()): Board {
  let next: Board = board ?? {};
  const li = `<li>${itemHtml}</li>`;
  const held = live(next).find((item): item is BoxItem => item.kind === "box" && (item as BoxItem).notesFor === transcriptId);
  if (held) {
    const html = /<\/ul>\s*$/.test(held.html) ? held.html.replace(/<\/ul>\s*$/, `${li}</ul>`) : `${held.html}<ul>${li}</ul>`;
    return put(next, { ...held, html: sanitizeRichText(html), at: now });
  }
  next = put(next, { id: newId, kind: "box", html: sanitizeRichText(`<ul>${li}</ul>`), notesFor: transcriptId, at: now });
  const pos = next[posId(transcriptId)] as PosItem | undefined;
  if (pos && !pos.deleted) next = put(next, { id: posId(newId), kind: "pos", target: newId, x: pos.x + pos.w + 60, y: pos.y, w: 300, at: now });
  return put(next, { id: `link:${transcriptId}|${newId}`, kind: "link", from: transcriptId, to: newId, at: now });
}
