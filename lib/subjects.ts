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
};

/** What you wrote on a story's card, under its quotes. Sanitised HTML. */
export type CardNoteItem = Base & { kind: "cardnote"; card: string; html: string };

/** A free text box, anywhere on the board. Sanitised HTML. */
export type BoxItem = Base & { kind: "box"; html: string };

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
};

/**
 * A tab within a subject, like a Google Docs tab: its own page of stories and
 * boxes. The first tab, MAIN_TAB, exists without an item; this item only
 * records its name once it has been renamed.
 */
export type TabItem = Base & { kind: "tab"; name: string; order: number };

/** Which tab a story card or a box is on. Absent means the first tab. */
export type PlaceItem = Base & { kind: "place"; target: string; tab: string };

export type BoardItem =
  | StoryItem
  | CardNoteItem
  | BoxItem
  | PosItem
  | LinkItem
  | InsightItem
  | SuggestItem
  | MetaItem
  | TabItem
  | PlaceItem;

export type Board = Record<string, BoardItem>;
/** Every subject's board, keyed by the note it belongs to. */
export type Boards = Record<string, Board>;

const KEY = "super-reader:boards:v1";
/** A deletion only has to outlive the slowest device's absence. */
const TOMBSTONE_TTL_MS = 90 * 24 * 60 * 60 * 1000;
/** The boards' share of the synced document, which has a 512KB ceiling. */
export const BOARDS_SYNC_BUDGET = 150 * 1024;
export const MAX_HTML = 20_000;

export function loadBoards(): Boards {
  if (typeof window === "undefined") return {};
  try {
    const parsed = JSON.parse(window.localStorage.getItem(KEY) ?? "{}");
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

export function saveBoards(boards: Boards) {
  try {
    window.localStorage.setItem(KEY, JSON.stringify(boards));
  } catch {
    /* storage full; the board still holds for this session */
  }
}

export function newItemId(prefix = "i") {
  return `${prefix}${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
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

/** Boards for subjects that no longer exist are let go. */
export function pruneBoards(boards: Boards, noteIds: ReadonlySet<string>): Boards {
  const kept: Boards = {};
  for (const [id, board] of Object.entries(boards)) if (noteIds.has(id)) kept[id] = board;
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
  return without(["insight", "suggest", "pos", "link"]);
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
  quotes: { id: string; text: string }[];
  note: string;
  /** When the story first arrived in the subject; the feed view's order. */
  at: number;
};

/**
 * One card per story: every article quoted into the note, and every story
 * added to the subject directly or accepted from the suggestions.
 */
export function cardsOf(note: Note, board: Board | undefined): Card[] {
  const cards = new Map<string, Card>();
  const ensure = (link: string, title: string, source: string | undefined, at: number) => {
    const id = canonicalUrl(link);
    let card = cards.get(id);
    if (!card) {
      card = { id, link, title, source, quotes: [], note: "", at };
      cards.set(id, card);
    } else {
      card.at = Math.min(card.at, at);
      if (!card.source && source) card.source = source;
    }
    return card;
  };

  for (const entry of note.entries) {
    if (!isQuote(entry)) continue;
    ensure(entry.link, entry.articleTitle, entry.sourceTitle, entry.at).quotes.push({
      id: entry.id,
      text: entry.text,
    });
  }
  for (const item of live(board)) {
    if (item.kind === "story") ensure(item.link, item.title, item.source, item.at);
    if (item.kind === "suggest" && item.state === "accepted") {
      ensure(item.link, item.title, item.source, item.at);
    }
  }
  for (const item of live(board)) {
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
  story: { link: string; title: string; source?: string },
  now = Date.now(),
): Board {
  const id = `story:${canonicalUrl(story.link)}`;
  const held = board?.[id];
  if (held && !held.deleted) return board ?? {};
  return put(board, { id, kind: "story", link: story.link, title: story.title, source: story.source, at: now }, now);
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
  /** Which AI to ask, and (for OpenAI) which model. */
  provider?: "anthropic" | "openai";
  model?: string;
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

export type SynthesisResult = {
  insights: { type: InsightKind; text: string; refs: string[] }[];
  suggestions: { link: string; title: string; source?: string; why: string }[];
  /** Tokens the provider reported, for the spending page. */
  usage?: { provider: "anthropic" | "openai"; model: string; input: number; output: number };
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

  return put(next, { ...metaOf(next), sig: signatureOf(input), ranAt: now }, now);
}

/* ------------------------------------------------------------------------ */
/* Rich text                                                                 */
/* ------------------------------------------------------------------------ */

const ALLOWED_TAGS = new Set([
  "p", "div", "br", "b", "strong", "i", "em", "u", "s", "mark", "ul", "ol", "li", "h3", "blockquote", "span", "a",
]);

/**
 * What a text box may hold. Its HTML comes back from another device through
 * sync, so it is treated as untrusted every time it is shown: tags outside a
 * short list are unwrapped, and no attribute survives except a highlight.
 */
export function sanitizeRichText(html: string): string {
  const out: string[] = [];
  const stack: string[] = [];
  const pattern = /<\/?([a-zA-Z0-9]+)([^>]*)>|([^<]+)/g;
  let match: RegExpExecArray | null;
  const source = String(html ?? "")
    .slice(0, MAX_HTML)
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
    if (tag === "span") {
      if (closing) {
        const index = stack.lastIndexOf("span");
        if (index >= 0) {
          stack.splice(index, 1);
          out.push("</mark>");
        }
        continue;
      }
      if (/background/i.test(match[2])) {
        stack.push("span");
        out.push("<mark>");
      }
      continue;
    }
    // A quote is a link to its passage, by the quote's id — never an href, so
    // nothing synced can smuggle a destination in.
    if (tag === "a" && !closing) {
      const id = match[2].match(/data-quote=["']?([A-Za-z0-9_-]{1,40})/)?.[1];
      if (!id) continue;
      stack.push("a");
      out.push(`<a data-quote="${id}">`);
      continue;
    }
    if (tag === "br") {
      out.push("<br>");
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
      out.push(`<${tag}>`);
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
  if (missing.length === 0) return html;
  const items = missing
    .map((quote) => `<li><a data-quote="${quote.id}">“${escapeHtml(quote.text.trim())}”</a></li>`)
    .join("");
  const last = html.lastIndexOf('data-quote="');
  if (last >= 0) {
    const close = html.indexOf("</ul>", last);
    if (close >= 0) return html.slice(0, close) + items + html.slice(close);
  }
  return `<ul>${items}</ul>${html}`;
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
