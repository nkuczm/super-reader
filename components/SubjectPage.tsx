"use client";

import { createPortal } from "react-dom";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Icon } from "./icons";
import RichText, { dropCiteAt, forceNextHtml, TOOL_LABELS, ToolsHostContext } from "./RichText";
import { CITE_OPEN_EVENT, CITE_TYPE, citeCardHtml, citeChipHtml, inlineCardLinks, setCiteSources, type Cite } from "@/lib/cite";
import FlagButton from "./FlagButton";
import type { FlagInput } from "@/lib/flags";
import SubjectHistory from "./SubjectHistory";
import { EXTRACT_VERSION } from "@/lib/offline";
import SubjectContacts from "./SubjectContacts";
import { tableWidth } from "./TableBox";
import { DrawingPad, ImageView, TableBox, TranscriptBox, shrinkImage, DRAWING_HEIGHT, type AiSearch } from "./SubjectMedia";
import { boxHtml, boxKind, cardHtml, cardNotesHtml, tableCardHtml, transcriptHtml, type Output } from "@/lib/subject-doc";
import { printedOn, printPage } from "@/lib/print";
import { safeTranscript } from "@/lib/transcript";
import PrintDialog, { type PrintJob } from "./PrintDialog";
import SubjectFind, { type FindTarget } from "./SubjectFind";
import type { Writing } from "./useAccount";
import type { Note, NoteEntry } from "@/lib/notes";
import { omissionsHtml, putFactNotes, researchOf, scriptQuotes, scriptRows, type FactCheckResult, type SourceTarget } from "@/lib/factcheck";
import { addTranscriptNote, documentOrder, LABEL_COLORS, labelColorOf, safeHref, youtubeThumbnail, type StoryItem } from "@/lib/subjects";
import { titleFromUrl } from "@/lib/manual";
import {
  addStory,
  applySynthesis,
  cardNoteId,
  cardsOf,
  composeCardDoc,
  escapeHtml,
  sanitizeRichText,
  quoteIdsIn,
  live,
  textOf,
  authorsOf,
  cardInfoId,
  madeAt,
  embedSrc,
  bylineOf,
  contactsOf,
  contactId,
  contactRoster,
  initialsOf,
  safeImage,
  tagOrder,
  taggedWith,
  withTags,
  type ContactItem,
  metaOf,
  migrateNoteWriting,
  newItemId,
  posId,
  put,
  remove,
  shouldAutoRun,
  synthesisInput,
  type Board,
  type BoxItem,
  type Card,
  type InsightItem,
  type LinkItem,
  type PosItem,
  type SuggestItem,
  type SynthesisResult,
} from "@/lib/subjects";
import { canonicalUrl } from "@/lib/url";
import { safeGrid } from "@/lib/sheet";
import { prepHtml, productionOf, putProduction, shotlistGrid, type ProductionResult } from "@/lib/production";
import {
  activeTabOf,
  addTab,
  deleteTab,
  MAIN_TAB,
  placeNew,
  placeOn,
  renameTab,
  tabOf,
  tabsOf,
  type Tab,
} from "@/lib/subjects";
import { chainedLabelLinks, edgePath, layoutBoard, settle, GAP } from "@/lib/board-layout";
import { PROVIDER_NAME, recordSpend, shareSpend, type AiProvider } from "@/lib/spend";
import { loadSyncCode } from "@/lib/store";

type Props = {
  /** Whether this device's boards have been read from storage yet: nothing is written on a guess of an empty board. */
  boardsLoaded?: boolean;
  note: Note;
  board: Board | undefined;
  onBoard: (update: (board: Board | undefined) => Board) => void;
  onOpenArticle: (link: string, title: string, quote: string) => void;
  /** The note's entries after a quote is taken out — see NotePage. */
  onCommitEntries: (entries: NoteEntry[], known: ReadonlySet<string>) => void;
  onOpenMenu?: () => void;
  /** Back to every subject. */
  onBack?: () => void;
  /** Rename the subject, from its title. */
  onRename?: (name: string) => void;
  /** Headers carrying the reader's keys, or undefined when there are none. */
  keyHeaders: () => HeadersInit | undefined;
  hasAiKey: boolean;
  /** Which AI to ask, from Settings. */
  /** The models for deep analysis (fact check, insights) and quick tools (transcript search, suggested reading). */
  ai: { provider: AiProvider; model?: string; quickModel?: string };
  /** Who is signed in and whether the work is saved (useAccount). */
  accountStrip?: React.ReactNode;
  /** History and export live with the Google account. */
  signedIn?: boolean;
  onRestored?: (doc: Writing) => void;
  /** "Saved 5:27 PM" and the like, beside the title. */
  saveLabel?: string;
  /** Date, author and outlet of a story still on the device, by link. */
  articleMeta?: (link: string) => { publishedAt?: string; author?: string; source?: string } | undefined;
  /** Borders around stories and boxes only on hover or while editing (Settings). */
  hideBoxes?: boolean;
  /** A text box's width from settings, in pixels; 0 for the default. */
  boxWidth?: number;
  onToggleHideBoxes?: () => void;
  /** Tuck the app's sidebar away for room to work (desktop). */
  sidebarHidden?: boolean;
  onToggleSidebar?: () => void;
};

const RAIL_KEY = "super-reader:tab-rail";
/** Stories whose details were already looked up this visit. */
const infoTried = new Set<string>();
const BOARD_USED_KEY = "super-reader:board-used";

type RunState = { state: "idle" | "running" | "error"; message?: string };

const INSIGHT_LABEL: Record<InsightItem["type"], string> = {
  connection: "Connection",
  question: "Question",
  deeper: "Deeper",
};

/**
 * A subject: the stories you have gathered on something, with what you
 * quoted and thought about each, and what an AI finds across them.
 *
 * Two views of the same board. The document view stacks everything like a
 * feed, oldest first, with the AI's insights after the stories and its
 * suggested reading last. The whiteboard lays the same cards out on a canvas
 * where they can be moved and joined with lines.
 */
/** A node's diameter on the whiteboard when it is made. */
const NODE_SIZE = 170;
const NEW_TABLE = () => [["", "", ""], ["", "", ""], ["", "", ""]];

/** Blocks copied on the whiteboard, as the clipboard carries them between subjects. */
/** The first picture on a clipboard, if there is one. */
function clipboardPicture(e: ClipboardEvent): File | null {
  const item = [...(e.clipboardData?.items ?? [])].find((i) => i.kind === "file" && i.type.startsWith("image/"));
  return item?.getAsFile() ?? null;
}

/** A heading in a tab's outline: a section label (n = -1) or the nth heading in a text box. */
/** One undoable change to a subject's cards. */
type BoardOp = {
  undo: (b: Board | undefined) => Board;
  redo: (b: Board | undefined) => Board;
  /** What the step changes outside the board — a story's quotes live in the note. */
  also?: { undo: () => void; redo: () => void };
  /** When it was done (or undone), against the last keystroke: which of the two ⌘Z takes back. */
  at?: number;
};

/** When anything in a subject was last typed: ⌘Z in a field undoes the typing if it is newer than the last step. */
let lastTypedAt = 0;

type OutlineEntry = { id: string; n: number; level: number; text: string };

/** A brief glow on what the reader was just taken to. */
function flashEl(el: HTMLElement) {
  el.classList.remove("outline-flash");
  void el.offsetWidth;
  el.classList.add("outline-flash");
  setTimeout(() => el.classList.remove("outline-flash"), 1400);
}

/** A card's width, within what the board allows. */
const clampW = (w: number) => Math.round(Math.min(900, Math.max(200, w)));

const BLOCKS_TYPE = "web application/x-super-reader-blocks";
/** The last blocks copied, for a browser that will not carry a custom clipboard type. */
let blockClipboard: string | null = null;

type CopiedBlock = {
  box?: Omit<BoxItem, "id" | "at" | "kind">;
  story?: { link: string; title: string; source?: string; publishedAt?: string; author?: string };
  note?: string;
  dx: number;
  dy: number;
  w: number;
};
type CopiedBlocks = { v: 1; items: CopiedBlock[]; links: [number, number][]; text: string };

function blocksFor(board: Board | undefined, cards: Card[], ids: string[], positions: Map<string, { x: number; y: number; w: number }>): CopiedBlocks | null {
  const items = live(board);
  const byId = new Map(items.map((i) => [i.id, i]));
  const kept: string[] = [];
  const blocks: CopiedBlock[] = [];
  const text: string[] = [];
  const spots = ids.map((id) => positions.get(id)).filter(Boolean) as { x: number; y: number; w: number }[];
  const ox = Math.min(...spots.map((p) => p.x));
  const oy = Math.min(...spots.map((p) => p.y));
  for (const id of ids) {
    const at = positions.get(id);
    if (!at) continue;
    const item = byId.get(id) ?? byId.get(`story:${id}`);
    const place = { dx: at.x - ox, dy: at.y - oy, w: at.w };
    if (item?.kind === "box") {
      const { id: _id, at: _at, kind: _kind, embedded: _embedded, after: _after, ...box } = item as BoxItem;
      blocks.push({ box, ...place });
      text.push(textOf(box.html || "") || box.caption || box.transcript?.title || "");
    } else if (item?.kind === "story" || cards.some((c) => c.id === id)) {
      // A story: from its own item, or from the card its quotes make.
      const card = cards.find((c) => c.id === id);
      const s = (item as StoryItem | undefined) ?? { link: card!.link, title: card!.title, source: card!.source, publishedAt: card!.publishedAt, author: card!.author };
      const note = (byId.get(cardNoteId(id)) as { html?: string } | undefined)?.html;
      blocks.push({ story: { link: s.link, title: s.title, source: s.source, publishedAt: s.publishedAt, author: s.author }, note, ...place });
      text.push(`${s.title} — ${s.link}`);
    } else continue;
    kept.push(id);
  }
  if (blocks.length === 0) return null;
  const index = new Map(kept.map((id, i) => [id, i]));
  const links: [number, number][] = [];
  for (const item of items) {
    if (item.kind !== "link") continue;
    const l = item as LinkItem;
    const a = index.get(l.from);
    const b = index.get(l.to);
    if (a !== undefined && b !== undefined) links.push([a, b]);
  }
  return { v: 1, items: blocks, links, text: text.filter(Boolean).join("\n\n") };
}

function readBlocks(json: string | null | undefined): CopiedBlocks | null {
  if (!json) return null;
  try {
    const parsed = JSON.parse(json) as CopiedBlocks;
    if (parsed?.v !== 1 || !Array.isArray(parsed.items)) return null;
    const items = parsed.items.slice(0, 200).flatMap((b): CopiedBlock[] => {
      const place = { dx: Number(b.dx) || 0, dy: Number(b.dy) || 0, w: Math.min(1200, Math.max(120, Number(b.w) || 300)) };
      if (b.story && typeof b.story.link === "string" && typeof b.story.title === "string") {
        return [{ story: b.story, note: typeof b.note === "string" ? sanitizeRichText(b.note) : undefined, ...place }];
      }
      if (b.box && typeof b.box === "object") {
        const box = b.box;
        return [{ box: { ...box, html: sanitizeRichText(String(box.html ?? "")) }, ...place }];
      }
      return [];
    });
    const links = (Array.isArray(parsed.links) ? parsed.links : []).filter(
      (l): l is [number, number] => Array.isArray(l) && Number.isInteger(l[0]) && Number.isInteger(l[1]),
    );
    return items.length ? { v: 1, items, links, text: "" } : null;
  } catch {
    return null;
  }
}

/**
 * What the wheel, over `target`, does to a box inside `stop` with its own
 * scroll: "scroll" while it has further to go, "end" once it is at its top
 * or bottom — where it stops, rather than handing the scroll on to pan the
 * board — and null over anything else.
 */
function scrollsItself(target: Element | null, stop: Element, deltaY: number): "scroll" | "end" | null {
  let found: "end" | null = null;
  for (let node = target; node && node !== stop; node = node.parentElement) {
    const { overflowY } = getComputedStyle(node);
    if ((overflowY === "auto" || overflowY === "scroll") && node.scrollHeight > node.clientHeight + 1) {
      const atTop = node.scrollTop <= 0;
      const atBottom = node.scrollTop + node.clientHeight >= node.scrollHeight - 1;
      if ((deltaY < 0 && !atTop) || (deltaY > 0 && !atBottom)) return "scroll";
      found = "end";
    }
  }
  return found;
}

/** Things in a card a click is meant for, which never move the caret. */
const NOT_TEXT = "button, a, input, textarea, select, label, [contenteditable], img, svg, canvas, .drawing, .transcript, .sheet, .wb-menu, .embed-grip, .subject-box-head, .subject-card-head, .tbl-col-handle, .tbl-row-handle, .tbl-grip, .sheet-tools";

/**
 * A click anywhere in a text box, a story's notes or a table cell — not
 * just on the line of text — starts typing there: the caret goes to the
 * nearest place in that text. A press that became a drag does nothing.
 */
function useClickToType() {
  useEffect(() => {
    let down: { x: number; y: number } | null = null;
    const press = (e: PointerEvent) => (down = { x: e.clientX, y: e.clientY });
    const click = (e: MouseEvent) => {
      const target = e.target as HTMLElement | null;
      if (!target || !down || Math.hypot(e.clientX - down.x, e.clientY - down.y) > 4) return;
      if (target.closest(NOT_TEXT)) return;
      const holder = target.closest<HTMLElement>("td[data-cell], .subject-box, .subject-card");
      if (!holder || !holder.closest(".subject-doc, .wb-canvas")) return;
      const body = holder.querySelector<HTMLElement>(".rich-body");
      if (!body) return;
      body.focus({ preventScroll: true });
      // The nearest point of the text to where the click landed.
      const r = body.getBoundingClientRect();
      const x = Math.min(r.right - 2, Math.max(r.left + 2, e.clientX));
      const y = Math.min(r.bottom - 2, Math.max(r.top + 2, e.clientY));
      const doc = document as Document & { caretPositionFromPoint?: (x: number, y: number) => { offsetNode: Node; offset: number } | null };
      let range: Range | null = null;
      const pos = doc.caretPositionFromPoint?.(x, y);
      if (pos && body.contains(pos.offsetNode)) {
        range = document.createRange();
        range.setStart(pos.offsetNode, pos.offset);
      } else {
        const hit = document.caretRangeFromPoint?.(x, y);
        if (hit && body.contains(hit.startContainer)) range = hit;
      }
      if (!range) {
        range = document.createRange();
        range.selectNodeContents(body);
        range.collapse(false);
      }
      range.collapse(true);
      const sel = window.getSelection();
      sel?.removeAllRanges();
      sel?.addRange(range);
    };
    document.addEventListener("pointerdown", press, true);
    document.addEventListener("click", click);
    return () => {
      document.removeEventListener("pointerdown", press, true);
      document.removeEventListener("click", click);
    };
  }, []);
}

/**
 * A story added to the subject from its link alone. Its address names it at
 * once; the page's own title, outlet, date and author follow if it can be
 * read. `then` adds anything else that goes with it (a place on the board).
 */
function addStoryFromLink(link: string, onBoard: Props["onBoard"], then: (board: Board) => Board = (b) => b, after?: string): { id: string; title: string } {
  const id = canonicalUrl(link);
  let host = "";
  try {
    host = new URL(link).hostname.replace(/^www\./, "");
  } catch {
    /* no host */
  }
  const title = titleFromUrl(link) ?? (host || link);
  onBoard((current) => then(placeNew(addStory(current, { link, title, source: host || undefined, after }), id)));
  void (async () => {
    try {
      const res = await fetch(`/api/article?url=${encodeURIComponent(link)}&x=${EXTRACT_VERSION}`);
      if (!res.ok) return;
      const data = (await res.json()) as { title?: string; siteName?: string; publishedAt?: string; byline?: string };
      if (!data.title) return;
      // As the card's info, not by rewriting the story: the story's time is when it arrived, which orders the document.
      onBoard((current) => {
        const held = current?.[`story:${id}`] as StoryItem | undefined;
        if (!held || held.deleted) return current ?? {};
        const info = current?.[cardInfoId(id)];
        const had = info && info.kind === "cardinfo" && !info.deleted ? info : undefined;
        return put(current, {
          id: cardInfoId(id),
          kind: "cardinfo",
          card: id,
          title: had?.title ?? data.title!.replace(/\s+/g, " ").trim().slice(0, 300),
          source: had?.source ?? (data.siteName?.slice(0, 120) || held.source),
          publishedAt: had?.publishedAt ?? (data.publishedAt || held.publishedAt),
          author: had?.author ?? (data.byline?.slice(0, 120) || held.author),
          at: Date.now(),
        });
      });
    } catch {
      /* kept under the title its address gives */
    }
  })();
  return { id, title };
}

export default function SubjectPage(props: Props) {
  const { note, board, onBoard, keyHeaders, hasAiKey, ai } = props;
  const meta = metaOf(board);
  const [historyOpen, setHistoryOpen] = useState(false);
  useClickToType();
  // The browser tab is named for the subject while it is open — and kept so:
  // opened straight after a reload, the framework writes the app's own title
  // into the page head once it has finished loading, over the subject's.
  useEffect(() => {
    if (!note.name) return;
    const wanted = `${note.name} · Super Reader`;
    const before = document.title === wanted ? "Super Reader" : document.title;
    const hold = () => {
      if (document.title !== wanted) document.title = wanted;
    };
    hold();
    const watch = new MutationObserver(hold);
    watch.observe(document.head, { childList: true, subtree: true, characterData: true });
    return () => {
      watch.disconnect();
      document.title = before;
    };
  }, [note.name]);

  // Drawings and pictures set into text: shown from their own box, which
  // leaves the page's layout once it has been dropped in.
  const boardRef = useRef(board);
  boardRef.current = board;
  const resolveEmbed = useCallback((id: string) => {
    const item = boardRef.current?.[id];
    return item && item.kind === "box" && !item.deleted ? embedSrc(item) : undefined;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [board]);
  /** A photo dropped into some text: made small, kept in a box of its own, set into the text. */
  const dropImage = async (file: File) => {
    try {
      const image = await shrinkImage(file);
      const id = newItemId("box");
      onBoard((current) => put(current, { id, kind: "box", html: "", image, caption: "", embedded: true, at: Date.now() }));
      return id;
    } catch (error) {
      setImageProblem(error instanceof Error ? error.message : "Could not add that picture.");
      return null;
    }
  };
  const embedBox = (id: string) =>
    onBoard((current) => {
      const item = current?.[id];
      return item && item.kind === "box" ? put(current, { ...item, embedded: true, at: Date.now() }) : (current ?? {});
    });
  const imageInput = useRef<HTMLInputElement | null>(null);
  const [imageProblem, setImageProblem] = useState<string | null>(null);
  /** Where a picture chosen from the whiteboard's menu should land. */
  const imageAt = useRef<{ x: number; y: number } | undefined>(undefined);
  const pickImage = (at?: { x: number; y: number }) => {
    imageAt.current = at;
    imageInput.current?.click();
  };
  const addImage = async (file: File | undefined) => {
    if (!file) return;
    try {
      const image = await shrinkImage(file);
      setImageProblem(null);
      addBox(imageAt.current, { image, caption: "" });
      imageAt.current = undefined;
    } catch (error) {
      setImageProblem(error instanceof Error ? error.message : "Could not add that picture.");
    }
  };
  /** The Contacts side tab, in place of the current tab's page. */
  const [contactsOpen, setContactsOpen] = useState(false);
  /** The tab outline over the document's left edge; remembered, shut on phones. */
  const [railOpen, setRailOpen] = useState(false);
  useEffect(() => {
    try {
      const saved = localStorage.getItem(RAIL_KEY);
      setRailOpen(saved === null ? window.innerWidth > 900 : saved === "1");
    } catch {
      setRailOpen(window.innerWidth > 900);
    }
  }, []);
  const setRail = (open: boolean) => {
    setRailOpen(open);
    try {
      localStorage.setItem(RAIL_KEY, open ? "1" : "0");
    } catch {
      /* not remembered */
    }
  };
  const contacts = useMemo(() => contactsOf(board), [board]);
  const dismissedContacts = useMemo(
    () => live(board).filter((i) => i.kind === "contact" && i.state === "dismissed").map((i) => i.id),
    [board],
  );
  const [exporting, setExporting] = useState<null | "working" | { url: string } | { error: string }>(null);
  const exportDoc = async () => {
    setExporting("working");
    try {
      const res = await fetch("/api/subjects/export", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ subjectId: note.id }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Export failed");
      setExporting({ url: data.url });
      window.open(data.url, "_blank", "noopener");
    } catch (error) {
      setExporting({ error: error instanceof Error ? error.message : "Export failed" });
    }
  };
  const { articleMeta } = props;
  // Stories filed before dates and authors were kept borrow them from the
  // copy still on the device, where there is one.
  const allCards = useMemo(
    () =>
      cardsOf(note, board).map((card) => {
        if (card.publishedAt && card.author && card.source) return card;
        const known = articleMeta?.(card.link);
        return known
          ? { ...card, publishedAt: card.publishedAt ?? known.publishedAt, author: card.author ?? known.author, source: card.source ?? known.source }
          : card;
      }),
    [note, board, articleMeta],
  );
  /** Everyone the Contacts panel lists — stored people and the stories' authors. */
  const contactCount = useMemo(() => {
    const ids = new Set(contacts.map((c) => c.id));
    const gone = new Set(dismissedContacts);
    for (const a of authorsOf(allCards)) {
      const id = contactId(a.name);
      if (!gone.has(id)) ids.add(id);
    }
    return ids.size;
  }, [contacts, dismissedContacts, allCards]);
  // Stories missing a date, author or outlet have them read off the article
  // itself, once, and kept with the subject so every device has them.
  useEffect(() => {
    const missing = allCards
      .filter((card) => (!card.publishedAt || !card.source) && !board?.[cardInfoId(card.id)] && !infoTried.has(card.id))
      .slice(0, 6);
    if (missing.length === 0) return;
    let cancelled = false;
    void (async () => {
      for (const card of missing) {
        infoTried.add(card.id);
        try {
          const res = await fetch(`/api/article?url=${encodeURIComponent(card.link)}&x=${EXTRACT_VERSION}`);
          if (!res.ok || cancelled) continue;
          const data = (await res.json()) as { publishedAt?: string; byline?: string; siteName?: string };
          if (!data.publishedAt && !data.byline && !data.siteName) continue;
          // Filling gaps only: a headline already read for the card (from a pasted link, a scan) is kept.
          onBoard((current) => {
            const info = current?.[cardInfoId(card.id)];
            const had = info && info.kind === "cardinfo" && !info.deleted ? info : undefined;
            return put(current, {
              ...had,
              id: cardInfoId(card.id),
              kind: "cardinfo",
              card: card.id,
              publishedAt: had?.publishedAt ?? data.publishedAt,
              author: had?.author ?? data.byline?.slice(0, 120),
              source: had?.source ?? data.siteName?.slice(0, 120),
              at: Date.now(),
            });
          });
        } catch {
          /* the article could not be read; the byline keeps what it has */
        }
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allCards]);
  const items = useMemo(() => live(board), [board]);
  // Tabs: each is its own page of stories and boxes. The AI still reads the
  // whole subject, so insights can connect stories across tabs.
  const tabs = useMemo(() => tabsOf(board), [board]);
  const currentTab = activeTabOf(board);
  const cards = allCards.filter((card) => tabOf(board, card.id, tabs) === currentTab);
  const tabCardIds = new Set(cards.map((card) => card.id));
  const boxes = items.filter(
    (item): item is BoxItem => item.kind === "box" && !item.embedded && tabOf(board, item.id, tabs) === currentTab,
  );
  // An insight shows on each tab whose stories it draws on; one about no
  // story in particular shows on the first tab.
  // With AI suggestions off, what earlier runs found stays saved but out of sight.
  const insights = meta.aiOff ? [] : items.filter(
    (item): item is InsightItem =>
      item.kind === "insight" &&
      (item.refs.some((ref) => tabCardIds.has(ref)) || (item.refs.length === 0 && currentTab === MAIN_TAB)),
  );
  const suggestions = meta.aiOff ? [] : items.filter(
    (item): item is SuggestItem => item.kind === "suggest" && item.state === "pending",
  );

  /**
   * Tagging people on blocks. A person's tags live on them (lib/subjects.ts,
   * ContactItem.tagged); a tagged section label stands for everything filed
   * under it. Their initials sit in the corner of each block tagged; clicking
   * them lights up everything tagged with that person, and the person's card
   * in Contacts opens all of it as one document.
   */
  const roster = useMemo(() => contactRoster(contacts, allCards, dismissedContacts), [contacts, allCards, dismissedContacts]);
  const blockIds = useMemo(
    () => new Set([...allCards.map((card) => card.id), ...items.filter((item) => item.kind === "box" && !item.deleted).map((item) => item.id)]),
    [allCards, items],
  );
  const tagsByBlock = useMemo(() => {
    const map = new Map<string, ContactItem[]>();
    for (const person of tagOrder(roster)) {
      for (const id of person.tagged ?? []) map.set(id, [...(map.get(id) ?? []), person]);
    }
    return map;
  }, [roster]);
  const taggedBlocks = useCallback((person: ContactItem | undefined) => [...taggedWith(board, person)].filter((id) => blockIds.has(id)), [board, blockIds]);
  const toggleTags = useCallback(
    (person: ContactItem, ids: string[], on: boolean) =>
      onBoard((current) => {
        const held = current?.[person.id];
        return put(current, withTags(held && held.kind === "contact" && !held.deleted ? held : person, ids, on));
      }),
    [onBoard],
  );
  /** Someone new, typed into the tag picker: added to Contacts and tagged at once. */
  const addTagged = (name: string, ids: string[]) =>
    onBoard((current) => {
      const id = contactId(name);
      const held = current?.[id];
      const person: ContactItem = held && held.kind === "contact" && !held.deleted
        ? { ...held, state: "kept" }
        : { id, kind: "contact", name, role: "", why: "", refs: [], origin: "you", state: "kept", at: Date.now() };
      return put(current, withTags(person, ids, true));
    });
  /** Whose blocks are lit up, and whose are open as a document. */
  const [tagFocus, setTagFocus] = useState<string | null>(null);
  const [tagDoc, setTagDoc] = useState<string | null>(null);

  /**
   * Find: ⌘F (Ctrl+F) on a subject searches its whiteboard or its document
   * instead of the browser's page — which on the whiteboard would find text
   * scattered off-screen and leave it there.
   */
  const [findOpen, setFindOpen] = useState(false);
  const [findKey, setFindKey] = useState(0);
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey) || e.altKey || e.key.toLowerCase() !== "f") return;
      // A dialog over the subject keeps the browser's own.
      if (document.querySelector(".print-overlay, .history-overlay, .cmp-overlay")) return;
      e.preventDefault();
      setFindOpen(true);
      setFindKey((k) => k + 1);
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, []);
  const findOnBoard = meta.view === "board" && !tagDoc;
  const contactsShown = contactsOpen && meta.view === "board";
  const goToFound = useCallback((target: FindTarget) => {
    if (findOnBoard) {
      window.dispatchEvent(new CustomEvent("super-reader:find-goto", { detail: target }));
      return;
    }
    // The document scrolls the match to a third of the way down, unless it is already comfortably in view.
    const scroller = target.el.closest<HTMLElement>(".main") ?? document.scrollingElement as HTMLElement | null;
    if (!scroller) return;
    const box = scroller.getBoundingClientRect();
    const top = target.rect.top - box.top;
    if (top < 90 || top > box.height - 80) scroller.scrollBy({ top: top - box.height / 3, behavior: "smooth" });
  }, [findOnBoard]);
  const focusPerson = tagFocus ? roster.find((c) => c.id === tagFocus) : undefined;
  const lit = useMemo(() => (focusPerson ? new Set(taggedBlocks(focusPerson)) : null), [focusPerson, taggedBlocks]);
  useEffect(() => {
    if (!tagFocus) return;
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setTagFocus(null);
    window.addEventListener("keydown", esc);
    return () => window.removeEventListener("keydown", esc);
  }, [tagFocus]);
  const [run, setRun] = useState<RunState>({ state: "idle" });
  const [focusBox, setFocusBox] = useState<string | null>(null);
  const [renaming, setRenaming] = useState<string | null>(null);

  // A note that has writing of its own brings it onto the board, once —
  // and only once the board has been read from storage: run on the empty
  // board seen before that, it wrote a fresh meta that then outdated the
  // stored one, losing the subject's settings (offline, AI off, its tab).
  useEffect(() => {
    if (props.boardsLoaded !== false && !meta.migrated) onBoard((current) => migrateNoteWriting(note, current));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [note.id, meta.migrated, props.boardsLoaded]);

  const setView = (view: "doc" | "board") => onBoard((current) => put(current, { ...metaOf(current), view }));

  const addBox = (at?: { x: number; y: number }, extra: Partial<BoxItem> = {}) => {
    const id = newItemId("box");
    onBoard((current) => {
      let next = placeNew(put(current, { id, kind: "box", html: "", ...extra, at: Date.now() }), id);
      if (at) next = put(next, { id: posId(id), kind: "pos", target: id, x: at.x, y: at.y, w: extra.labelShape === "node" ? NODE_SIZE : props.boxWidth || 280, at: Date.now() });
      return next;
    });
    setFocusBox(id);
  };

  // Removing a story, from wherever: undoable, quotes and all.
  const removeCard = (card: Card) => removeStory(card);

  /** A story taken out from the keyboard, as one block: undoable (its quotes aside, which live in the note). */
  const removeStory = (card: Card) => {
    const ids = [card.id, cardNoteId(card.id), cardInfoId(card.id)];
    for (const item of live(board)) {
      if ((item.kind === "story" || item.kind === "suggest") && canonicalUrl(item.link) === card.id) ids.push(item.id);
    }
    const stepped = removeCards(ids);
    // Its quotes go in the same step, so one ⌘Z brings the whole story back.
    const also = card.quotes.length ? quotesOut(card.quotes.map((quote) => quote.id)) : null;
    if (also && stepped) history.current.past.at(-1)!.also = also;
    else if (also) recordOp({ undo: (b) => b ?? {}, redo: (b) => b ?? {}, also });
  };

  const noteRef = useRef(note);
  noteRef.current = note;
  /** Quotes taken out of the note — undoable, alongside whatever board step goes with them. */
  const quotesOut = (quoteIds: string[]) => {
    const gone = new Set(quoteIds);
    const removed = note.entries.filter((entry) => gone.has(entry.id));
    if (!removed.length) return null;
    const take = () => {
      const entries = noteRef.current.entries;
      props.onCommitEntries(entries.filter((entry) => !gone.has(entry.id)), new Set(entries.map((entry) => entry.id)));
    };
    const give = () => {
      const entries = noteRef.current.entries.filter((entry) => !gone.has(entry.id));
      props.onCommitEntries([...entries, ...removed], new Set([...entries, ...removed].map((entry) => entry.id)));
    };
    take();
    return { undo: give, redo: take };
  };
  const removeQuotes = (quoteIds: string[]) => {
    const also = quotesOut(quoteIds);
    if (also) recordOp({ undo: (b) => b ?? {}, redo: (b) => b ?? {}, also });
  };

  const setCardNote = (card: Card, html: string) =>
    onBoard((current) => put(current, { id: cardNoteId(card.id), kind: "cardnote", card: card.id, html, at: Date.now() }));

  const decide = (suggestion: SuggestItem, state: "accepted" | "dismissed") =>
    recorded((current) => {
      const next = put(current, { ...suggestion, state, at: Date.now() });
      // An accepted story joins the tab that is open.
      return state === "accepted" ? placeNew(next, canonicalUrl(suggestion.link)) : next;
    });

  /**
   * The tab open, copied as formatted text — headlines linked to their
   * stories, quotes as bullets, your notes and boxes as written, insights
   * last — with a plain-text copy beside it for anywhere that takes no
   * formatting. Quote links are an id of this app's, so only their words go.
   */
  const [copied, setCopied] = useState(false);

  /**
   * Printing. A tab prints as the document reads — each section heading,
   * then what is linked under it — with drawings drawn and quote links
   * reduced to their words; every tab prints one after another; a single
   * story (with its notes), text box, table or transcript prints on its own.
   * Each opens the print dialog first, with a preview, where transcripts
   * can be put in whole rather than as their opening lines.
   */
  const [printJob, setPrintJob] = useState<PrintJob | null>(null);
  const tabBoxes = (tabId: string) =>
    items.filter((item): item is BoxItem => item.kind === "box" && !item.embedded && tabOf(board, item.id, tabs) === tabId);
  const tabPrintHtml = (tabId: string, out: Output) => {
    // As the document reads: a story set into the writing as a card is printed there only.
    const inlined = new Set(tabBoxes(tabId).flatMap((box) => (box.html ? inlineCardLinks(box.html) : [])));
    return blocksPrintHtml(allCards.filter((card) => tabOf(board, card.id, tabs) === tabId && !inlined.has(card.id)), tabBoxes(tabId), out);
  };
  /** Stories and boxes as printed, in document order: each section heading, then what is filed under it. */
  const blocksPrintHtml = (printCards: Card[], printBoxes: BoxItem[], out: Output) => {
    const entries = [
      ...printCards
        .map((card) => ({ id: card.id, at: card.at, after: card.after, html: `<section class="print-block print-story">${cardHtml(card, board, out)}</section>` })),
      ...printBoxes.map((box) => ({
        id: box.id,
        at: madeAt(box),
        after: box.after,
        label: box.label,
        html: box.label ? boxHtml(box, board, out) : `<section class="print-block print-${boxKind(box)}">${boxHtml(box, board, out)}</section>`,
      })),
    ];
    const byId = new Map(entries.map((entry) => [entry.id, entry]));
    return documentOrder(entries, board).map((id) => byId.get(id)!.html).join("");
  };
  const printDoc = (every: boolean) => {
    const chosen = every ? tabs : tabs.filter((tab) => tab.id === currentTab);
    const tabName = tabs.find((tab) => tab.id === currentTab)?.name;
    const shownInsights = every && !meta.aiOff ? items.filter((item): item is InsightItem => item.kind === "insight") : insights;
    const storyCount = allCards.filter((card) => chosen.some((tab) => tabOf(board, card.id, tabs) === tab.id)).length;
    setPrintJob({
      what: every ? note.name : tabs.length > 1 ? `${note.name} — ${tabName}` : note.name,
      transcripts: chosen.some((tab) => tabBoxes(tab.id).some((box) => box.transcript)),
      build: ({ fullTranscripts }) => {
        const out: Output = { print: true, fullTranscripts };
        const body = chosen
          .map((tab) => `${every && tabs.length > 1 ? `<h2 class="tab">${escapeHtml(tab.name)}</h2>` : ""}${tabPrintHtml(tab.id, out) || "<p><i>Nothing here yet.</i></p>"}`)
          .join("");
        const insightList = shownInsights.length
          ? `<section class="print-insights"><h2>Insights</h2><ul>${shownInsights.map((i) => `<li><b>${INSIGHT_LABEL[i.type]}.</b> ${escapeHtml(i.text)}</li>`).join("")}</ul></section>`
          : "";
        return printPage({
          kicker: !every && tabs.length > 1 && tabName ? `Subject · ${tabName}` : "Subject",
          title: note.name,
          meta: [storyCount ? `${storyCount} ${storyCount === 1 ? "story" : "stories"}` : "", printedOn()].filter(Boolean).join("  ·  "),
          body: body + insightList,
        });
      },
    });
  };
  const printItem = (id: string) => {
    const card = allCards.find((c) => c.id === id);
    const item = board?.[id];
    const box = item && item.kind === "box" ? item : undefined;
    if (card) {
      setPrintJob({
        what: card.title,
        transcripts: false,
        build: () => printPage({
          kicker: note.name,
          title: card.title,
          meta: [bylineOf(card), printedOn()].filter(Boolean).join("  ·  "),
          body: `<div class="print-story">${cardNotesHtml(card, board, { print: true }) || "<p><i>No notes yet.</i></p>"}</div>`,
          footer: card.link,
        }),
      });
      return;
    }
    if (!box) return;
    const kind = boxKind(box);
    const title =
      kind === "table" ? box.tableName || "Table"
      : kind === "transcript" ? safeTranscript(box.transcript).title.trim() || "Transcript"
      : kind === "image" ? box.caption?.trim() || "Picture"
      : kind === "drawing" ? "Drawing"
      : "Notes";
    setPrintJob({
      what: `${title} from ${note.name}`,
      transcripts: kind === "transcript",
      build: ({ fullTranscripts }) => printPage({
        kicker: note.name,
        title,
        meta: printedOn(),
        body: `<section class="print-block print-${kind} print-solo">${boxHtml(box, board, { print: true, fullTranscripts })}</section>`,
      }),
    });
  };

  const copyTab = async () => {
    const tabName = tabs.find((tab) => tab.id === currentTab)?.name;
    const unlinkQuotes = (html: string) => sanitizeRichText(html).replace(/<a data-quote="[^"]+">([\s\S]*?)<\/a>/g, "$1");
    const parts: string[] = [`<h2>${escapeHtml(note.name)}${tabs.length > 1 && tabName ? ` — ${escapeHtml(tabName)}` : ""}</h2>`];
    for (const card of cards) {
      parts.push(`<h3><a href="${escapeHtml(card.link)}">${escapeHtml(card.title)}</a></h3>`);
      if (bylineOf(card)) parts.push(`<p><i>${escapeHtml(bylineOf(card))}</i></p>`);
      parts.push(unlinkQuotes(composeCardDoc(card.note, card.quotes)));
    }
    for (const box of boxes) parts.push(box.transcript ? transcriptHtml(box.transcript, box.transcriptTabs) : box.table ? tableCardHtml(box) : unlinkQuotes(box.html));
    if (insights.length > 0) {
      parts.push("<h3>Insights</h3><ul>");
      for (const insight of insights) parts.push(`<li><b>${INSIGHT_LABEL[insight.type]}:</b> ${escapeHtml(insight.text)}</li>`);
      parts.push("</ul>");
    }
    const html = parts.join("");
    const holder = document.createElement("div");
    holder.innerHTML = html;
    // A nested list starts on its own line, indented under its parent.
    holder.querySelectorAll("li ul, li ol").forEach((list) => list.prepend(document.createTextNode("\n")));
    holder.querySelectorAll("li").forEach((li) => {
      const depth = Math.max(0, li.parentElement ? countAncestors(li.parentElement, "ul, ol") : 0);
      const mark = li.parentElement?.hasAttribute("data-check") ? (li.getAttribute("data-checked") === "true" ? "☑" : "☐") : "•";
      li.prepend(document.createTextNode(`${"  ".repeat(depth)}${mark} `));
    });
    holder.querySelectorAll("h2, h3, p, li, ul, ol").forEach((el) => el.append(document.createTextNode("\n")));
    const text = (holder.textContent ?? "").replace(/\n{3,}/g, "\n\n").trim();
    try {
      await navigator.clipboard.write([
        new ClipboardItem({
          "text/html": new Blob([html], { type: "text/html" }),
          "text/plain": new Blob([text], { type: "text/plain" }),
        }),
      ]);
    } catch {
      await navigator.clipboard.writeText(text).catch(() => {});
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
  };

  const switchTab = (tab: string) => onBoard((current) => put(current, { ...metaOf(current), activeTab: tab }));
  const moveCard = (target: string, tab: string) => onBoard((current) => placeOn(current, target, tab));

  /* -------------------------------------------------------------------- */
  /* The AI run                                                            */
  /* -------------------------------------------------------------------- */

  const input = useMemo(() => synthesisInput(note, board), [note, board]);
  const running = useRef(false);

  const synthesize = useCallback(async () => {
    if (running.current) return;
    running.current = true;
    setRun({ state: "running" });
    const given = input;
    try {
      const headers = new Headers(keyHeaders());
      headers.set("content-type", "application/json");
      const res = await fetch("/api/subjects/synthesize", {
        method: "POST",
        headers,
        body: JSON.stringify({ ...given, provider: ai.provider, model: ai.model, quickModel: ai.quickModel }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "The run failed.");
      // Counted here, and in the account's shared ledger so every device's
      // spending page includes it — the analysis and the reading separately.
      const result = data as SynthesisResult;
      for (const usage of result.usages ?? (result.usage ? [{ ...result.usage, activity: "insights" as const }] : [])) {
        shareSpend(loadSyncCode(), recordSpend(usage, note.name));
      }
      onBoard((current) => applySynthesis(current, given, data as SynthesisResult));
      setRun({ state: "idle" });
    } catch (error) {
      // Recorded as run, so a failing key does not retry on every keystroke.
      onBoard((current) => put(current, { ...metaOf(current), ranAt: Date.now() }));
      setRun({ state: "error", message: error instanceof Error ? error.message : "The run failed." });
    } finally {
      running.current = false;
    }
  }, [input, keyHeaders, onBoard, ai.provider, ai.model, note.name]);

  // Lightweight and automatic: a while after the material changes, and not
  // more often than every quarter of an hour.
  useEffect(() => {
    if (!hasAiKey || meta.aiOff || !shouldAutoRun(input, meta)) return;
    const timer = setTimeout(() => void synthesize(), 8000);
    return () => clearTimeout(timer);
  }, [hasAiKey, input, meta, synthesize]);

  // Why Insights cannot run yet goes on the button, not in a line of its own.
  const insightsWhyNot = !hasAiKey
    ? `Add your ${PROVIDER_NAME[ai.provider]} key in Settings → API keys for insights.`
    : allCards.length < 2
      ? "Insights start once there are two stories."
      : null;
  const aiStatus = run.state === "running" ? (
    <span className="subject-ai-hint">Thinking across {allCards.length} stories…</span>
  ) : run.state === "error" ? (
    <span className="subject-ai-hint error">{run.message}</span>
  ) : null;

  /**
   * Undo and redo for whole cards — deleting, cutting, pasting, moving —
   * kept apart from the undo inside a text box or table, which handles its
   * own. Each step knows how to take itself back and to do itself again.
   */
  const history = useRef<{ past: BoardOp[]; future: BoardOp[] }>({ past: [], future: [] });
  const recordOp = (op: BoardOp) => {
    op.at = Date.now();
    history.current.past.push(op);
    if (history.current.past.length > 100) history.current.past.shift();
    history.current.future = [];
  };
  const removeCards = (ids: string[]) => {
    const gone = new Set(ids);
    const items = live(board).filter((i) =>
      gone.has(i.id)
      || (i.kind === "pos" && gone.has((i as PosItem).target))
      || (i.kind === "link" && (gone.has((i as LinkItem).from) || gone.has((i as LinkItem).to))));
    if (!items.length) return false;
    // Put back where it was: a story keeps when it first arrived, which orders the document.
    const putBack = (b: Board | undefined) =>
      items.reduce((n, i) => put(n, i.kind === "story" ? { ...i, since: (i as StoryItem).since ?? i.at, at: Date.now() } : { ...i, at: Date.now() }), b ?? {});
    const takeAway = (b: Board | undefined) => items.reduce((n, i) => remove(n, i.id), b ?? {});
    recordOp({ undo: putBack, redo: takeAway });
    onBoard(takeAway);
    return true;
  };
  /** One step back (or forward) through the subject's changes. */
  const stepHistory = (redo: boolean) => {
    const step = (redo ? history.current.future : history.current.past).pop();
    if (!step) return false;
    step.at = Date.now();
    forceNextHtml();
    (redo ? history.current.past : history.current.future).push(step);
    onBoard(redo ? step.redo : step.undo);
    if (step.also) (redo ? step.also.redo : step.also.undo)();
    return true;
  };
  /**
   * Any change to the board, undoable: each item it touches is kept as it
   * was, and put back by ⌘Z (an item it made is taken away again).
   */
  const recorded = (update: (b: Board | undefined) => Board) => {
    let done = false;
    onBoard((current) => {
      const next = update(current);
      if (!done) {
        done = true;
        const keys = Object.keys(next).filter((k) => next[k] !== current?.[k]);
        if (keys.length) {
          const before = keys.map((k) => current?.[k]);
          const after = keys.map((k) => next[k]);
          recordOp({
            undo: (b) => keys.reduce((n, k, i) => (before[i] ? put(n, { ...before[i]!, at: Date.now() }) : remove(n, k)), b ?? {}),
            redo: (b) => keys.reduce((n, k, i) => put(n, { ...after[i], at: Date.now() }), b ?? {}),
          });
        }
      }
      return next;
    });
  };
  /**
   * A change to a card that can be undone: what its fields were is kept
   * with the step. Tables save through this, so their edits sit in the same
   * history as moving and deleting cards — ⌘Z takes back whichever came last,
   * and nothing is forgotten when a card is redrawn.
   */
  const updateBoxRecorded = (box: BoxItem, change: Partial<BoxItem>) => {
    let recorded = false;
    onBoard((current) => {
      const held = current?.[box.id];
      const base = (held && held.kind === "box" ? held : box) as BoxItem;
      if (!recorded) {
        recorded = true;
        const before = Object.fromEntries(Object.keys(change).map((k) => [k, base[k as keyof BoxItem]])) as Partial<BoxItem>;
        const write = (b: Board | undefined, values: Partial<BoxItem>) => {
          const h = b?.[box.id];
          return h && h.kind === "box" ? put(b, { ...h, ...values, at: Date.now() }) : b ?? {};
        };
        recordOp({ undo: (b) => write(b, before), redo: (b) => write(b, change) });
      }
      return put(current, { ...base, ...change, at: Date.now() });
    });
  };
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey) || (e.key.toLowerCase() !== "z" && e.key.toLowerCase() !== "y")) return;
      const redo = e.shiftKey || e.key.toLowerCase() === "y";
      // Tables (which share this history) and drawings have their own.
      if ((e.target as HTMLElement).closest?.(".drawing, .tbl, .sheet")) return;
      // In text, ⌘Z takes back the typing — unless a step (a block removed,
      // a story taken out) came after the last keystroke: that is what was
      // just done, and the caret has usually landed in another block since.
      if ((e.target as HTMLElement).closest?.("input, textarea, [contenteditable]")) {
        const next = (redo ? history.current.future : history.current.past).at(-1);
        if (!next || (next.at ?? 0) <= lastTypedAt) return;
      }
      if (stepHistory(redo)) {
        e.preventDefault();
        e.stopPropagation();
      }
    };
    const typed = (e: Event) => {
      if ((e.target as HTMLElement).closest?.("input, textarea, [contenteditable]")) lastTypedAt = Date.now();
    };
    // Capture: ahead of a field's own handling of ⌘Z.
    window.addEventListener("keydown", key, true);
    document.addEventListener("input", typed, true);
    return () => {
      window.removeEventListener("keydown", key, true);
      document.removeEventListener("input", typed, true);
    };
  }, [onBoard]);

  const pasteBlocks = (copied: CopiedBlocks, after: string | null) => {
    recorded((current) => {
      let next = current ?? {};
      const now = Date.now();
      const have = new Set(cardsOf(note, next).map((c) => c.id));
      const ids: string[] = [];
      let prev = after;
      for (const block of copied.items) {
        let id: string;
        if (block.story && have.has(canonicalUrl(block.story.link))) {
          // A subject holds one card per story: on another tab it goes in as a card set into writing.
          id = newItemId("box");
          next = put(next, { id, kind: "box", html: `<p>${citeCardHtml({ link: block.story.link, title: block.story.title })}</p>`, ...(prev ? { after: prev } : {}), at: now }, now);
        } else if (block.story) {
          id = canonicalUrl(block.story.link);
          next = addStory(next, { ...block.story, ...(prev ? { after: prev } : {}) }, now);
          if (block.note) next = put(next, { id: cardNoteId(id), kind: "cardnote", card: id, html: block.note, at: now }, now);
        } else {
          id = newItemId("box");
          next = put(next, { ...block.box!, id, kind: "box", ...(prev ? { after: prev } : {}), at: now }, now);
        }
        next = placeNew(next, id, now);
        ids.push(id);
        prev = id;
      }
      for (const [a, b] of copied.links) {
        const [from, to] = [ids[a], ids[b]].sort();
        if (from && to && from !== to) next = put(next, { id: `link:${from}|${to}`, kind: "link", from, to, at: now }, now);
      }
      return next;
    });
  };
  const joinBlocks = (into: string, from: string, html: string) =>
    recorded((current) => {
      const held = current?.[into];
      if (!held || held.kind !== "box") return current ?? {};
      let next = put(current, { ...held, html: sanitizeRichText(html), at: Date.now() });
      for (const item of live(next)) {
        if (item.id === from || (item.kind === "pos" && (item as PosItem).target === from)
          || (item.kind === "link" && ((item as LinkItem).from === from || (item as LinkItem).to === from))) next = remove(next, item.id);
      }
      return next;
    });

  const shared = {
    resolveEmbed,
    embedBox,
    dropImage,
    tabs,
    currentTab,
    moveCard,
    cards,
    boxes,
    insights,
    suggestions,
    focusBox,
    onOpenArticle: props.onOpenArticle,
    storyFromLink: (url: string, after: string) => {
      const link = safeHref(url);
      if (!link) return null;
      return { link, title: addStoryFromLink(link, onBoard, undefined, after).title };
    },
    removeCard,
    removeQuotes,
    setCardNote,
    decide,
    dismissInsight: (insight: InsightItem) => recorded((current) => remove(current, insight.id)),
    // A box deleted meanwhile stays deleted: its editor saving on the way out must not bring it back.
    setBox: (box: BoxItem, html: string) =>
      onBoard((current) => (current?.[box.id]?.deleted ? current : put(current, { ...box, html, at: Date.now() }))),
    removeStory,
    pasteBlocks,
    joinBlocks,
    // Undoable, as every change to a block is: a transcript's tab closed, a picture replaced, a caption cleared.
    updateBox: (box: BoxItem, change: Partial<BoxItem>) =>
      recorded((current) => {
        const held = current?.[box.id];
        const base = held && held.kind === "box" ? held : box;
        return put(current, { ...base, ...change, at: Date.now() });
      }),
    removeBox: (box: BoxItem) => removeCards([box.id]),
    printItem,
    tags: {
      roster,
      on: (id: string) => tagsByBlock.get(id) ?? [],
      toggle: toggleTags,
      add: addTagged,
      focus: tagFocus,
      setFocus: setTagFocus,
      lit,
    },
    removeCards,
    recordOp,
    stepHistory,
    updateBoxRecorded,
    replaceEmbed: (id: string, image: string) =>
      onBoard((current) => {
        const held = current?.[id];
        return held && held.kind === "box" ? put(current, { ...held, image, at: Date.now() }) : current ?? {};
      }),
    // `sheet` is the tab being checked (the card's own table unless another tab is open); `write` saves onto it.
    factCheck: async (box: BoxItem, sheet: BoxItem = box, write?: (change: Partial<BoxItem>) => void) => {
      if (!hasAiKey) throw new Error(`Add your ${PROVIDER_NAME[ai.provider]} key in Settings → API keys to fact-check.`);
      const rows = scriptRows(sheet.table);
      if (!rows.length) throw new Error("Write some words in the script first.");
      const allBoxes = live(board).filter((item): item is BoxItem => item.kind === "box");
      const { sources, targets } = researchOf(allCards, allBoxes, box.id);
      const headers = new Headers(keyHeaders());
      headers.set("content-type", "application/json");
      const res = await fetch("/api/subjects/fact-check", {
        method: "POST",
        headers,
        body: JSON.stringify({ rows, sources, quotes: scriptQuotes(rows, sources), provider: ai.provider, model: ai.model }),
      });
      const data = (await res.json().catch(() => ({}))) as Partial<FactCheckResult> & { error?: string };
      if (!res.ok) throw new Error(data.error ?? "The fact-check failed.");
      for (const usage of data.usages ?? []) shareSpend(loadSyncCode(), recordSpend({ ...usage, activity: "fact-check" }, note.name));
      const result = { claims: data.claims ?? [], omissions: data.omissions ?? [], web: data.web ?? [] };
      const factCheck = { at: Date.now(), claims: result.claims, targets, model: ai.model, subject: note.name };
      if (write) {
        write({ factCheck, factView: true });
        onBoard((current) => putFactNotes(current, box.id, omissionsHtml(result, targets), newItemId("box")));
        return;
      }
      onBoard((current) => {
        const held = current?.[box.id];
        const base = held && held.kind === "box" ? held : box;
        const next = put(current, { ...base, factCheck, factView: true, at: Date.now() });
        return putFactNotes(next, box.id, omissionsHtml(result, targets), newItemId("box"));
      });
    },
    // A script broken down into a shot list and a production prep list, beside it on the board.
    produce: async (box: BoxItem, sheet: BoxItem = box) => {
      if (!hasAiKey) throw new Error(`Add your ${PROVIDER_NAME[ai.provider]} key in Settings → API keys to plan production.`);
      const rows = scriptRows(sheet.table);
      if (!rows.length) throw new Error("Write some words in the script first.");
      const allBoxes = live(board).filter((item): item is BoxItem => item.kind === "box");
      const { sources } = researchOf(allCards, allBoxes, box.id);
      const quotes = scriptQuotes(rows, sources).map(({ row, speaker, text }) => ({ row, speaker, text }));
      const headers = new Headers(keyHeaders());
      headers.set("content-type", "application/json");
      const res = await fetch("/api/subjects/production", {
        method: "POST",
        headers,
        body: JSON.stringify({ rows, quotes, provider: ai.provider, model: ai.model }),
      });
      const data = (await res.json().catch(() => ({}))) as Partial<ProductionResult> & { error?: string };
      if (!res.ok) throw new Error(data.error ?? "Couldn't break down the script.");
      for (const usage of data.usages ?? []) shareSpend(loadSyncCode(), recordSpend({ ...usage, activity: "production" }, note.name));
      const shots = shotlistGrid(data.shots ?? [], rows);
      const prep = prepHtml(data.needs ?? [], note.name);
      onBoard((current) => putProduction(current, box.id, shots, prep, () => newItemId("box")));
    },
    openSource: (target: SourceTarget, quote: string) => {
      if (target.kind === "card") return props.onOpenArticle(target.link, target.title, quote);
      goTo({ id: target.id, n: -1, level: 1, text: "" });
    },
    subjectName: note.name,
    allCards,
    aiModel: ai.model ?? (ai.provider === "anthropic" ? "claude-opus-5-5" : "gpt-5-mini"),
    aiQuickModel: ai.quickModel ?? ai.model ?? "",
    aiSearch: (async (turns, query) => {
      if (!hasAiKey) throw new Error(`Add your ${PROVIDER_NAME[ai.provider]} key in Settings → API keys to search by meaning.`);
      const headers = new Headers(keyHeaders());
      headers.set("content-type", "application/json");
      const res = await fetch("/api/subjects/transcript-search", {
        method: "POST",
        headers,
        body: JSON.stringify({ turns, query, provider: ai.provider, model: ai.quickModel ?? ai.model }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? "The search failed.");
      if (data.usage) shareSpend(loadSyncCode(), recordSpend({ ...data.usage, activity: "transcript-search" }, note.name));
      return data.matches ?? [];
    }) as AiSearch,
    noteTranscript: (box: BoxItem, itemHtml: string) =>
      onBoard((current) => addTranscriptNote(current, box.id, itemHtml, newItemId("box"))),
  };

  /**
   * The open tab's outline: its section labels and the headings written in
   * its text boxes, in the order the document shows them.
   */
  const outline = [...boxes]
    .sort((a, b) => a.at - b.at)
    .flatMap((box): OutlineEntry[] => {
      if (box.label) return textOf(box.html).trim() ? [{ id: box.id, n: -1, level: 1, text: textOf(box.html).trim() }] : [];
      return [...(box.html || "").matchAll(/<h([1-6])[^>]*>([\s\S]*?)<\/h\1>/gi)]
        .map((m, n) => ({ id: box.id, n, level: Math.min(3, Number(m[1])), text: textOf(m[2]).trim() }))
        .filter((h) => h.text);
    });
  // A citation clicked anywhere in the subject's writing opens its story in the reader.
  setCiteSources(allCards);
  useEffect(() => {
    const open = (event: Event) => {
      const href = (event as CustomEvent<string>).detail;
      const card = allCards.find((c) => c.id === canonicalUrl(href));
      props.onOpenArticle(card?.link ?? href, card?.title ?? "", "");
    };
    window.addEventListener(CITE_OPEN_EVENT, open);
    return () => window.removeEventListener(CITE_OPEN_EVENT, open);
  });
  /** Take the reader to an outline entry: scrolled to in the document, panned to on the whiteboard. */
  const goTo = (entry: OutlineEntry) => {
    if (window.innerWidth <= 900) setRailOpen(false);
    if (meta.view === "board") {
      window.dispatchEvent(new CustomEvent("super-reader:goto", { detail: entry }));
      return;
    }
    const host = document.querySelector<HTMLElement>(`.subject-doc [data-item="${CSS.escape(entry.id)}"]`);
    if (!host) return;
    const target = entry.n >= 0 ? host.querySelectorAll<HTMLElement>("h1, h2, h3, h4, h5, h6")[entry.n] ?? host : host;
    target.scrollIntoView({ behavior: "smooth", block: "start" });
    flashEl(host);
  };

  // A refresh comes back to the same place: how far down the document was
  // read (the whiteboard keeps its own pan and zoom the same way).
  const pageRef = useRef<HTMLDivElement | null>(null);
  const placeKey = `super-reader:subject-place:${props.note.id}`;
  useEffect(() => {
    const scroller = pageRef.current?.closest<HTMLElement>(".main");
    if (!scroller) return;
    let saved = 0;
    try {
      saved = Number(JSON.parse(sessionStorage.getItem(placeKey) ?? "{}").scroll) || 0;
    } catch {
      /* nowhere to return to */
    }
    // The page grows as boxes measure themselves; keep trying briefly.
    let tries = 0;
    let frame = 0;
    let restoring = saved > 0;
    const restore = () => {
      if (!saved) return;
      scroller.scrollTop = saved;
      if (Math.abs(scroller.scrollTop - saved) > 2 && tries++ < 90) frame = requestAnimationFrame(restore);
      else restoring = false;
    };
    restore();
    let timer: ReturnType<typeof setTimeout> | null = null;
    const onScroll = () => {
      if (restoring || timer) return;
      timer = setTimeout(() => {
        timer = null;
        try {
          const held = JSON.parse(sessionStorage.getItem(placeKey) ?? "{}");
          sessionStorage.setItem(placeKey, JSON.stringify({ ...held, scroll: Math.round(scroller.scrollTop) }));
        } catch {
          /* not remembered */
        }
      }, 200);
    };
    scroller.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      cancelAnimationFrame(frame);
      scroller.removeEventListener("scroll", onScroll);
      if (timer) clearTimeout(timer);
    };
  }, [placeKey, meta.view]);

  return (
    <div className="subject-page" ref={pageRef}>
      <div className="main-head subject-head">
        {props.onOpenMenu && (
          <button className="menu-btn" onClick={props.onOpenMenu} aria-label="Open feeds">
            {Icon.menu}
          </button>
        )}
        {props.onToggleSidebar && (
          <button className="btn ghost small sidebar-toggle" onClick={props.onToggleSidebar}
            aria-label={props.sidebarHidden ? "Show sidebar" : "Hide sidebar"} title={props.sidebarHidden ? "Show sidebar" : "Hide sidebar"}>
            <svg viewBox="0 0 20 20" width="16" height="16" aria-hidden="true">
              <rect x="2.5" y="3.5" width="15" height="13" rx="2" fill="none" stroke="currentColor" strokeWidth="1.5" />
              <path d="M7.5 3.5v13" stroke="currentColor" strokeWidth="1.5" />
              {props.sidebarHidden ? <path d="M10.5 8l2 2-2 2" fill="none" stroke="currentColor" strokeWidth="1.5" /> : <path d="M12.5 8l-2 2 2 2" fill="none" stroke="currentColor" strokeWidth="1.5" />}
            </svg>
          </button>
        )}
        {props.onBack && (
          <button className="btn ghost small" onClick={props.onBack} aria-label="All subjects">
            {Icon.back}
          </button>
        )}
        <div className="subject-title-wrap">
          {renaming !== null ? (
            <form
              className="subject-rename"
              onSubmit={(event) => {
                event.preventDefault();
                if (renaming.trim()) props.onRename?.(renaming.trim());
                setRenaming(null);
              }}
            >
              <input
                className="input subject-rename-input"
                autoFocus
                aria-label="Subject name"
                value={renaming}
                onFocus={(event) => event.currentTarget.select()}
                onChange={(event) => setRenaming(event.target.value)}
                onKeyDown={(event) => event.key === "Escape" && setRenaming(null)}
                onBlur={(event) => event.currentTarget.form?.requestSubmit()}
              />
            </form>
          ) : (
            <h1
              className={props.onRename ? "subject-title-editable" : undefined}
              title={props.onRename ? "Click to rename" : undefined}
              onClick={() => props.onRename && setRenaming(note.name)}
            >
              {note.name}
            </h1>
          )}
          {(copied || props.saveLabel) && (
            <span className="subject-save" role="status">{copied ? "Copied" : props.saveLabel}</span>
          )}
        </div>
        <div className="subject-actions">
          <button
            className={`tab-rail-show${railOpen ? " on" : ""}`}
            aria-label={railOpen ? "Hide tabs" : "Show tabs"}
            aria-pressed={railOpen}
            title={railOpen ? "Hide tabs" : "Show tabs"}
            onClick={() => setRail(!railOpen)}
          >
            ☰ <span>{tabs.find((tab) => tab.id === currentTab)?.name ?? "Tabs"}</span>
          </button>
          <div className="seg" role="tablist" aria-label="View">
            <button role="tab" aria-selected={meta.view !== "board"} className={meta.view !== "board" ? "on" : ""}
              onClick={() => { setTagDoc(null); setView("doc"); }}>Document</button>
            <button role="tab" aria-selected={meta.view === "board"} className={meta.view === "board" ? "on" : ""}
              onClick={() => { setTagDoc(null); setView("board"); }}>Whiteboard</button>
          </div>
          <button className={`btn ghost small subject-find-btn${findOpen ? " on" : ""}`} aria-label="Find (⌘F)" title="Find on this page (⌘F / Ctrl+F)"
            onClick={() => { setFindOpen(true); setFindKey((k) => k + 1); }}>
            <svg viewBox="0 0 24 24" width="15" height="15" aria-hidden="true">
              <circle cx="10.5" cy="10.5" r="6" fill="none" stroke="currentColor" strokeWidth="2" />
              <path d="M15 15l5 5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            </svg>
          </button>
          {!meta.aiOff && (
            <button className="btn ghost small" disabled={!hasAiKey || allCards.length < 2 || run.state === "running"}
              onClick={() => void synthesize()} title={insightsWhyNot ?? "Find connections and suggest reading now"} aria-label="Insights">
              ✦ <span className="insights-label">Insights</span>
            </button>
          )}
          {/* Contacts are a whiteboard thing: the document is for writing. */}
          {meta.view === "board" && (
            <button
              className={`btn ghost small subject-contacts-btn${contactsOpen ? " on" : ""}`}
              aria-pressed={contactsOpen}
              aria-label="Contacts"
              onClick={() => setContactsOpen((o) => !o)}
              title="People to interview for this subject"
            >
              <span className="contacts-icon" aria-hidden="true">👥</span>
              <span className="contacts-label">Contacts</span>
              {contactCount > 0 && <span className="count">{contactCount}</span>}
            </button>
          )}
          <MoreMenu>
            {(close) => (
              <>
                <div className="more-add" role="group" aria-label="Add">
                  <span>Add</span>
                  {(
                    [
                      ["¶", "Text box", () => addBox()],
                      ["✎", "Drawing", () => addBox(undefined, { drawing: [], height: DRAWING_HEIGHT })],
                      ["▣", "Image", () => imageInput.current?.click()],
                      ["▦", "Table", () => addBox(undefined, { table: NEW_TABLE(), tableMode: "doc" })],
                      ["❝", "Transcript", () => addBox(undefined, { transcript: { title: "", turns: [] } })],
                    ] as const
                  ).map(([icon, label, run]) => (
                    <button key={label} role="menuitem" title={`Add ${label.toLowerCase()}`} aria-label={`Add ${label.toLowerCase()}`}
                      onClick={() => { close(); run(); }}>
                      {icon}
                    </button>
                  ))}
                </div>
                <button role="menuitem" title="Copy this tab as formatted text, for Google Docs and the like"
                  onClick={() => { close(); void copyTab(); }}>Copy this tab</button>
                <button role="menuitem" title={tabs.length > 1 ? "Print the whole document, each tab starting a new page — or save it as a PDF" : "Print the document, or save it as a PDF"}
                  onClick={() => { close(); printDoc(true); }}>Print</button>
                {props.onToggleHideBoxes && (
                  <button role="menuitemcheckbox" aria-checked={Boolean(props.hideBoxes)} onClick={props.onToggleHideBoxes}>
                    Hide boxes{props.hideBoxes && <span className="more-check">✓</span>}
                  </button>
                )}
                <button role="menuitemcheckbox" aria-checked={Boolean(meta.offline)}
                  onClick={() => onBoard((current) => put(current, { ...metaOf(current), offline: !metaOf(current).offline }))}>
                  Available offline{meta.offline && <span className="more-check">✓</span>}
                </button>
                <button role="menuitemcheckbox" aria-checked={!meta.aiOff} title="Insights and suggested reading in this subject"
                  onClick={() => onBoard((current) => put(current, { ...metaOf(current), aiOff: !metaOf(current).aiOff }))}>
                  AI suggestions{!meta.aiOff && <span className="more-check">✓</span>}
                </button>
                {props.signedIn && (
                  <>
                    <button role="menuitem" onClick={() => { close(); setHistoryOpen(true); }}>Version history</button>
                    <button role="menuitem" disabled={exporting === "working"} onClick={() => { close(); void exportDoc(); }}>
                      {exporting === "working" ? "Exporting…" : "Export to Google Doc"}
                    </button>
                  </>
                )}
                {props.accountStrip && <div className="more-account">{props.accountStrip}</div>}
              </>
            )}
          </MoreMenu>
        </div>
      </div>
      {typeof exporting === "object" && exporting && (
        <div className="subject-ai-bar">
          {"url" in exporting ? (
            <>
              Exported.{" "}
              <a href={exporting.url} target="_blank" rel="noopener noreferrer">
                Open the Google Doc
              </a>
            </>
          ) : (
            exporting.error
          )}
        </div>
      )}
      <input ref={imageInput} type="file" accept="image/*" hidden
        onChange={(event) => {
          void addImage(event.target.files?.[0]);
          event.target.value = "";
        }} />
      {imageProblem && <div className="subject-ai-bar">{imageProblem}</div>}
      {printJob && <PrintDialog job={printJob} onClose={() => setPrintJob(null)} />}
      {historyOpen && (
        <SubjectHistory
          subjectId={note.id}
          onClose={() => setHistoryOpen(false)}
          onRestored={(doc) => props.onRestored?.(doc)}
        />
      )}
      {aiStatus && <div className="subject-ai-bar">{aiStatus}</div>}
      <div className={`subject-body${contactsShown ? " with-contacts" : ""}`}>
      <div className={`subject-main${railOpen ? " rail-open" : " rail-closed"}${props.hideBoxes ? " quiet-boxes" : ""}`}
        style={props.boxWidth ? ({ "--box-w": `${props.boxWidth}px` } as React.CSSProperties) : undefined}>
      {railOpen && (
      // A zero-height sticky anchor: the outline stays in view down a long document.
      <div className={meta.view === "board" ? undefined : "tab-rail-anchor"}>
      <div className={`tab-rail open${meta.view === "board" ? " on-board" : ""}`}>
          <>
            <div className="tab-rail-head">
              <span>Tabs</span>
              <button className="icon-btn subtle" aria-label="Hide tabs" title="Hide tabs" onClick={() => setRail(false)}>
                ‹
              </button>
            </div>
            <TabBar
              tabs={tabs}
              current={currentTab}
              onSwitch={(tab) => switchTab(tab)}
              onAdd={(name) => onBoard((current) => addTab(current, name).board)}
              onRename={(tab, name) => onBoard((current) => renameTab(current, tab, name))}
              onDelete={(tab) => recorded((current) => deleteTab(current, tab))}
              outline={outline}
              onGo={goTo}
            />
          </>
      </div>
      </div>
      )}
      {findOpen && <SubjectFind key={findKey} board={findOnBoard} onGo={goToFound} onClose={() => setFindOpen(false)} />}
      {focusPerson && !tagDoc && (() => {
        const ids = taggedBlocks(focusPerson);
        const here = new Set([...cards.map((c) => c.id), ...boxes.map((b) => b.id)]);
        const away = ids.filter((id) => !here.has(id)).length;
        return (
          <div className="tag-focus-bar" role="status">
            <Avatar person={focusPerson} size="small" />
            <span><b>{focusPerson.name}</b> · {ids.length} tagged block{ids.length === 1 ? "" : "s"}{away ? ` (${away} on other tabs)` : ""}</span>
            <button className="btn ghost small" onClick={() => { setTagDoc(focusPerson.id); setTagFocus(null); }}>Open as document</button>
            <button className="link-btn" onClick={() => setTagFocus(null)}>Done</button>
          </div>
        );
      })()}
      {tagDoc ? (() => {
        const person = roster.find((c) => c.id === tagDoc);
        const ids = new Set(taggedBlocks(person));
        const docCards = allCards.filter((card) => ids.has(card.id));
        const docBoxes = items.filter((item): item is BoxItem => item.kind === "box" && !item.embedded && ids.has(item.id));
        const close = () => setTagDoc(null);
        return (
          <div className="contact-doc">
            <div className="contact-doc-head">
              {person && <Avatar person={person} />}
              <div className="contact-doc-title">
                <h2>{person?.name ?? "Contact"}</h2>
                <p>{[person?.role, `${ids.size} tagged block${ids.size === 1 ? "" : "s"}${tabs.length > 1 ? ", from every tab" : ""}`].filter(Boolean).join(" · ")}</p>
              </div>
              <button className="btn ghost small" disabled={ids.size === 0} title="Print everything tagged with them"
                onClick={() => setPrintJob({
                  what: `Tagged with ${person?.name ?? "contact"}`,
                  transcripts: docBoxes.some((b) => b.transcript),
                  build: ({ fullTranscripts }) => printPage({
                    kicker: `${note.name} · Tagged`,
                    title: person?.name ?? "Contact",
                    meta: [person?.role, printedOn()].filter(Boolean).join("  ·  "),
                    body: blocksPrintHtml(docCards, docBoxes, { print: true, fullTranscripts }) || "<p><i>Nothing tagged.</i></p>",
                  }),
                })}>
                {Icon.print}<span>Print</span>
              </button>
              <button className="btn ghost small" onClick={close}>
                Back to {meta.view === "board" ? "whiteboard" : "document"}
              </button>
            </div>
            {ids.size === 0 ? (
              <p className="hint contact-doc-empty">
                Nothing is tagged with {person?.name ?? "them"} yet. Use the person button at the top of any block — or
                right-click blocks on the whiteboard — to tag them.
              </p>
            ) : (
              <DocumentView {...shared} cards={docCards} boxes={docBoxes} insights={[]} suggestions={[]} board={board} addBox={addBox} pickImage={pickImage} />
            )}
          </div>
        );
      })() : meta.view === "board" ? (
        <Whiteboard {...shared} placeKey={placeKey} board={board} onBoard={onBoard} addBox={addBox} pickImage={pickImage} boxWidth={props.boxWidth ?? 0} />
      ) : (
        <DocumentView {...shared} board={board} addBox={addBox} pickImage={pickImage} />
      )}
      </div>
      {contactsShown && (
        <aside className="contacts-panel" aria-label="Contacts">
        <div className="contacts-panel-head">
          <h2>Contacts</h2>
          <button className="link-btn" aria-label="Close contacts" onClick={() => setContactsOpen(false)}>✕</button>
        </div>
        <SubjectContacts
          contacts={contacts}
          cards={allCards}
          running={run.state === "running"}
          canRun={hasAiKey && allCards.length >= 1}
          onRun={() => void synthesize()}
          onSave={(contact) => onBoard((current) => put(current, { ...contact, at: Date.now() }))}
          onRemove={(contact) =>
            onBoard((current) =>
              // Removed from the stories' people stays removed, so a later run
              // does not bring them back; your own are simply deleted.
              contact.origin === "you"
                ? remove(current, contact.id)
                : put(current, { ...contact, state: "dismissed", at: Date.now() }),
            )
          }
          onAdd={(name, role) =>
            onBoard((current) =>
              put(current, {
                id: contactId(name),
                kind: "contact",
                name,
                role,
                why: "",
                refs: [],
                origin: "you",
                state: "kept",
                at: Date.now(),
              }),
            )
          }
          onOpenCard={(card) => props.onOpenArticle(card.link, card.title, "")}
          dismissedIds={dismissedContacts}
          taggedCount={(person) => taggedBlocks(person).length}
          onOpenTagged={(person) => { setTagFocus(null); setTagDoc(person.id); }}
        />
        </aside>
      )}
      </div>
    </div>
  );
}

type Shared = {
  /** Print one story (with its notes), text box or table on its own. */
  printItem: (id: string) => void;
  tags: Tags;
  tabs: Tab[];
  currentTab: string;
  moveCard: (target: string, tab: string) => void;
  cards: Card[];
  boxes: BoxItem[];
  insights: InsightItem[];
  suggestions: SuggestItem[];
  focusBox: string | null;
  onOpenArticle: (link: string, title: string, quote: string) => void;
  /** A link pasted into a block's writing: the story joins the subject (reading right below that block), and its citation chip goes in. */
  storyFromLink: (url: string, after: string) => Cite | null;
  removeCard: (card: Card) => void;
  /** The same from the keyboard in the document, and undoable. */
  removeStory: (card: Card) => void;
  /** Blocks from the clipboard, on this tab, reading in order after a block (or at the end). */
  pasteBlocks: (blocks: CopiedBlocks, after: string | null) => void;
  /** One text block joined onto the end of another: one step, undone as one. */
  joinBlocks: (into: string, from: string, html: string) => void;
  removeQuotes: (ids: string[]) => void;
  setCardNote: (card: Card, html: string) => void;
  decide: (suggestion: SuggestItem, state: "accepted" | "dismissed") => void;
  dismissInsight: (insight: InsightItem) => void;
  setBox: (box: BoxItem, html: string) => void;
  resolveEmbed: (id: string) => string | undefined;
  embedBox: (id: string) => void;
  dropImage: (file: File) => Promise<string | null>;
  updateBox: (box: BoxItem, change: Partial<BoxItem>) => void;
  removeBox: (box: BoxItem) => void;
  /** A comment on a transcript, added as a bullet to the notes card beside it. */
  noteTranscript: (box: BoxItem, itemHtml: string) => void;
  /** A picture set into text, cropped: its box keeps the new picture. */
  replaceEmbed: (id: string, image: string) => void;
  /** Fact-check a script table against the subject's research; its colours and the omissions card follow. */
  factCheck: (box: BoxItem, sheet?: BoxItem, write?: (change: Partial<BoxItem>) => void) => Promise<void>;
  produce: (box: BoxItem, sheet?: BoxItem) => Promise<void>;
  /** Open what a fact-check cited: the story at its passage, or the note or transcript on the page. */
  openSource: (target: SourceTarget, quote: string) => void;
  /** Whole-card changes, undoable: delete cards (with their places and links), and record any other change as a step. */
  removeCards: (ids: string[]) => void;
  recordOp: (op: BoardOp) => void;
  stepHistory: (redo: boolean) => boolean;
  updateBoxRecorded: (box: BoxItem, change: Partial<BoxItem>) => void;
  /** For flagging AI results: which subject, and which model produced them. */
  subjectName: string;
  aiModel: string;
  aiQuickModel: string;
  allCards: Card[];
  /** Search a transcript by meaning, with the same AI key and model as insights. */
  aiSearch: AiSearch;
};

/* ---------------------------------------------------------------------- */
/* Pieces shared by both views                                             */
/* ---------------------------------------------------------------------- */

type Tags = {
  /** Everyone on the contact sheet. */
  roster: ContactItem[];
  /** Who is tagged on a block, most recently tagged first. */
  on: (id: string) => ContactItem[];
  toggle: (person: ContactItem, ids: string[], on: boolean) => void;
  /** Add someone new to Contacts, tagged on these blocks. */
  add: (name: string, ids: string[]) => void;
  /** The person whose blocks are lit up, and those blocks. */
  focus: string | null;
  setFocus: (id: string | null) => void;
  lit: Set<string> | null;
};

function Avatar({ person, size }: { person: ContactItem; size?: "small" }) {
  const photo = safeImage(person.photo);
  return (
    <span className={`tag-avatar${size === "small" ? " small" : ""}`} aria-hidden="true">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      {photo ? <img src={photo} alt="" /> : initialsOf(person.name)}
    </span>
  );
}

/**
 * Choose who is tagged on some blocks: everyone on the contact sheet, the
 * people tagged most recently first, with a search — and a name that is not
 * there yet can be added and tagged in one go.
 */
function TagPicker({ ids, tags, at, onClose }: { ids: string[]; tags: Tags; at: { left: number; top: number }; onClose: () => void }) {
  const [query, setQuery] = useState("");
  const box = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const away = (e: PointerEvent) => !box.current?.contains(e.target as globalThis.Node) && onClose();
    const esc = (e: KeyboardEvent) => e.key === "Escape" && (e.stopPropagation(), onClose());
    window.addEventListener("pointerdown", away, true);
    window.addEventListener("keydown", esc, true);
    return () => {
      window.removeEventListener("pointerdown", away, true);
      window.removeEventListener("keydown", esc, true);
    };
  }, [onClose]);
  const q = query.trim().toLowerCase();
  const people = tagOrder(tags.roster).filter((c) => !q || c.name.toLowerCase().includes(q) || c.role?.toLowerCase().includes(q));
  const exact = tags.roster.some((c) => c.name.trim().toLowerCase() === q);
  const stateOf = (person: ContactItem) => {
    const n = ids.filter((id) => person.tagged?.includes(id)).length;
    return n === 0 ? "none" : n === ids.length ? "all" : "some";
  };
  // Kept on screen: the picker opens beside its button, and flips up near the bottom.
  const left = Math.max(8, Math.min(at.left, window.innerWidth - 268));
  const top = at.top + 320 > window.innerHeight ? Math.max(8, at.top - 330) : at.top;
  return createPortal(
    <div ref={box} className="tag-picker" role="dialog" aria-label="Tag contacts" style={{ left, top }}
      onPointerDown={(e) => e.stopPropagation()}>
      <div className="tag-picker-head">{ids.length > 1 ? `Tag ${ids.length} blocks` : "Tag a contact"}</div>
      <input className="input tag-picker-search" autoFocus placeholder="Search or add a name…" value={query}
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={(e) => {
          if (e.key !== "Enter") return;
          e.preventDefault();
          if (people[0]) tags.toggle(people[0], ids, stateOf(people[0]) !== "all");
          else if (query.trim()) { tags.add(query.trim().slice(0, 120), ids); setQuery(""); }
        }} />
      <ul className="tag-picker-list">
        {people.map((person) => {
          const state = stateOf(person);
          return (
            <li key={person.id}>
              <button role="menuitemcheckbox" aria-checked={state === "all" ? true : state === "some" ? "mixed" : false}
                className={`tag-picker-row${state !== "none" ? " on" : ""}`}
                onClick={() => tags.toggle(person, ids, state !== "all")}>
                <Avatar person={person} size="small" />
                <span className="tag-picker-name">{person.name}{person.role && <small>{person.role}</small>}</span>
                <span className="tag-picker-check" aria-hidden="true">{state === "all" ? "✓" : state === "some" ? "–" : ""}</span>
              </button>
            </li>
          );
        })}
        {people.length === 0 && !query.trim() && <li className="tag-picker-empty">No contacts yet. Type a name to add one.</li>}
      </ul>
      {query.trim() && !exact && (
        <button className="tag-picker-add" onClick={() => { tags.add(query.trim().slice(0, 120), ids); setQuery(""); }}>
          + Add “{query.trim()}” and tag
        </button>
      )}
    </div>,
    document.body,
  );
}

/** The person button in a block's header: who is tagged on it. */
function TagButton({ id, tags, label }: { id: string; tags: Tags; label: string }) {
  const [at, setAt] = useState<{ left: number; top: number } | null>(null);
  const count = tags.on(id).length;
  return (
    <>
      <button className={`icon-btn subtle tag-btn${count ? " on" : ""}`} aria-label={`Tag a contact on this ${label}`} title="Tag a contact"
        aria-expanded={Boolean(at)}
        onPointerDown={(e) => e.stopPropagation()}
        onClick={(e) => {
          const r = e.currentTarget.getBoundingClientRect();
          setAt((open) => (open ? null : { left: r.right - 260, top: r.bottom + 6 }));
        }}>
        <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
          <circle cx="10" cy="8" r="3.6" /><path d="M3.5 20c.8-3.6 3.4-5.6 6.5-5.6 1.4 0 2.7.4 3.8 1.2M18 13v7M14.5 16.5h7" />
        </svg>
      </button>
      {at && <TagPicker ids={[id]} tags={tags} at={at} onClose={() => setAt(null)} />}
    </>
  );
}

/** Initials in the block's corner, one per person tagged; a click lights up everything tagged with them. */
function TagBadges({ id, tags }: { id: string; tags: Tags }) {
  const people = tags.on(id);
  if (people.length === 0) return null;
  const shown = people.slice(0, 4);
  return (
    <div className="tag-badges" onPointerDown={(e) => e.stopPropagation()}>
      {shown.map((person) => (
        <button key={person.id} className={`tag-badge${tags.focus === person.id ? " on" : ""}`}
          title={tags.focus === person.id ? `Stop highlighting ${person.name}` : `${person.name} — highlight everything tagged with them`}
          aria-label={`${person.name}: highlight everything tagged with them`}
          aria-pressed={tags.focus === person.id}
          onClick={() => tags.setFocus(tags.focus === person.id ? null : person.id)}>
          <Avatar person={person} size="small" />
        </button>
      ))}
      {people.length > shown.length && <span className="tag-badge more">+{people.length - shown.length}</span>}
    </div>
  );
}

function StoryCard({
  card,
  own,
  shared,
  dragHandle,
}: {
  card: Card;
  /** Insights about this story alone, shown inside it. */
  own: InsightItem[];
  shared: Shared;
  dragHandle?: (event: React.PointerEvent) => void;
}) {
  const [citeMenu, setCiteMenu] = useState<{ x: number; y: number; copied?: boolean } | null>(null);
  useEffect(() => {
    if (!citeMenu) return;
    const away = (e: PointerEvent) => (e.target as Element | null)?.closest?.(".cite-menu") || setCiteMenu(null);
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setCiteMenu(null);
    window.addEventListener("pointerdown", away, true);
    window.addEventListener("keydown", esc);
    return () => {
      window.removeEventListener("pointerdown", away, true);
      window.removeEventListener("keydown", esc);
    };
  }, [citeMenu]);
  const cite = { link: card.link, title: card.title };
  /** The citation on the clipboard: a chip where it is pasted in the subject, the story's address anywhere else. */
  const copyCite = async () => {
    const html = citeChipHtml(cite);
    try {
      await navigator.clipboard.write([new ClipboardItem({
        "text/html": new Blob([html], { type: "text/html" }),
        "text/plain": new Blob([card.link], { type: "text/plain" }),
      })]);
    } catch {
      try { await navigator.clipboard.writeText(card.link); } catch { return; }
    }
    setCiteMenu((m) => (m ? { ...m, copied: true } : m));
    setTimeout(() => setCiteMenu(null), 900);
  };
  return (
    <div className="subject-card">
      <div className="subject-card-head" onPointerDown={dragHandle}>
        <button className="subject-card-title"
          // In the document, the title drags out as a citation; on the whiteboard the card itself does.
          draggable={!dragHandle}
          onDragStart={(e) => {
            e.dataTransfer.setData(CITE_TYPE, JSON.stringify(cite));
            e.dataTransfer.setData("text/html", citeChipHtml(cite));
            e.dataTransfer.setData("text/plain", card.link);
            e.dataTransfer.effectAllowed = "copy";
          }}
          onContextMenu={(e) => {
            e.preventDefault();
            e.stopPropagation();
            setCiteMenu({ x: Math.min(e.clientX, window.innerWidth - 180), y: e.clientY });
          }}
          onClick={() => shared.onOpenArticle(card.link, card.title, "")}>
          {card.title}
        </button>
        {citeMenu && createPortal(
          <div className="cite-menu" role="menu" style={{ left: citeMenu.x, top: citeMenu.y }}>
            {citeMenu.copied ? <span className="cite-menu-done">Copied — paste it into any text</span> : (
              <>
                <button role="menuitem" onClick={() => void copyCite()}>Cite source</button>
                <button role="menuitem" onClick={() => { setCiteMenu(null); shared.onOpenArticle(card.link, card.title, ""); }}>Open story</button>
              </>
            )}
          </div>,
          document.body,
        )}
        {/* The card's controls, as one group: in a seamless document they sit in the margin, not on the card. */}
        <span className="subject-card-tools">
        {shared.tabs.length > 1 && (
          <select
            className="subject-card-tab"
            aria-label="Move to tab"
            title="Move to another tab"
            value={shared.currentTab}
            onPointerDown={(e) => e.stopPropagation()}
            onChange={(event) => shared.moveCard(card.id, event.target.value)}
          >
            {shared.tabs.map((tab) => (
              <option key={tab.id} value={tab.id}>{tab.name}</option>
            ))}
          </select>
        )}
        {/* In the document a story is removed from the keyboard, and contacts are tagged on the whiteboard. */}
        {dragHandle && (
          <>
            <TagButton id={card.id} tags={shared.tags} label="story" />
            <button className="icon-btn subtle print-btn" aria-label="Print this story and its notes" title="Print this story and its notes"
              onPointerDown={(e) => e.stopPropagation()} onClick={() => shared.printItem(card.id)}>
              {Icon.print}
            </button>
            <button className="icon-btn subtle" aria-label="Remove story from subject" title="Remove from subject"
              onPointerDown={(e) => e.stopPropagation()} onClick={() => shared.removeCard(card)}>
              {Icon.close}
            </button>
          </>
        )}
        </span>
      </div>
      {bylineOf(card) && <div className="subject-card-source">{bylineOf(card)}</div>}
      {youtubeThumbnail(card.link) && (
        <button className="subject-card-thumb" aria-label={`Open ${card.title}`}
          onClick={() => shared.onOpenArticle(card.link, card.title, "")}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={youtubeThumbnail(card.link)!} alt="" loading="lazy" draggable={false}
            onError={(e) => ((e.currentTarget.parentElement as HTMLElement).style.display = "none")} />
          <span className="subject-card-play" aria-hidden="true">▶</span>
        </button>
      )}
      <div className="subject-card-body">
        {/* One document per story: the quotes are bullets in it, as links to
            their passages, and everything around them is yours to write. */}
        <RichText
          className="subject-card-note"
          html={composeCardDoc(card.note, card.quotes)}
          onPasteLink={(url) => shared.storyFromLink(url, card.id)}
          resolveEmbed={shared.resolveEmbed}
          onEmbed={shared.embedBox}
          onDropImage={shared.dropImage}
          quoteSource={cite}
          placeholder="Add notes…"
          onOpenQuote={(id) => {
            const quote = card.quotes.find((q) => q.id === id);
            shared.onOpenArticle(card.link, card.title, quote?.text ?? "");
          }}
          onChange={(html) => {
            // A quote's bullet deleted from the text is the quote deleted.
            const kept = quoteIdsIn(html);
            const gone = card.quotes.filter((quote) => !kept.has(quote.id)).map((quote) => quote.id);
            if (gone.length > 0) shared.removeQuotes(gone);
            shared.setCardNote(card, html);
          }}
        />
        {own.map((insight) => (
          <div key={insight.id} className="subject-inline-insight">
            <span className="ai-tag">✦ {INSIGHT_LABEL[insight.type]}</span> {insight.text}
            <FlagButton make={() => insightFlag(insight, shared)} />
            <button className="insight-dismiss" aria-label="Dismiss" title="Dismiss"
              onPointerDown={(e) => e.stopPropagation()} onClick={() => shared.dismissInsight(insight)}>×</button>
          </div>
        ))}
      </div>
      {dragHandle && <TagBadges id={card.id} tags={shared.tags} />}
    </div>
  );
}

function TextBox({ box, shared, dragHandle }: { box: BoxItem; shared: Shared; dragHandle?: (e: React.PointerEvent) => void }) {
  const [styling, setStyling] = useState(false);
  // In the document a block is edited from the keyboard — Backspace takes it
  // away — and contacts are tagged on the whiteboard: none of its side buttons.
  const inDoc = !dragHandle;
  return (
    <div className={`subject-box${box.table ? " table-box" : ""}${box.label ? " label-box" : ""}${box.label && box.labelShape === "node" && dragHandle ? " node-box" : ""}${!box.label && !box.drawing && !box.table && !box.transcript && box.image === undefined && box.caption === undefined ? " text-box" : ""}`}>
      <div className="subject-box-head" onPointerDown={dragHandle}>
        <span className="subject-box-grip" aria-hidden="true">⋮⋮</span>
        {productionOf(box) && (
          <FlagButton className="box-flag" make={() => {
            const script = shared.boxes.find((b) => box.notesFor === `${b.id}#${productionOf(box)}`);
            const rows = script ? scriptRows(script.table) : [];
            return {
              kind: "production",
              subject: shared.subjectName,
              model: shared.aiModel,
              output: box.table
                ? safeGrid(box.table).map((r) => r.map((c) => textOf(c).replace(/\s+/g, " ").trim()).join(" | ")).join("\n")
                : textOf(box.html),
              context: [{ label: "Script", text: rows.map((r) => `[${r.row}] ${r.text}${r.visual ? ` (visuals: ${r.visual})` : ""}`).join("\n").slice(0, 6000) }],
            };
          }} />
        )}
        {box.notesFor?.endsWith("#facts") && (
          <FlagButton className="box-flag" make={() => {
            const script = shared.boxes.find((b) => `${b.id}#facts` === box.notesFor);
            const rows = script ? scriptRows(script.table) : [];
            return {
              kind: "omissions",
              subject: shared.subjectName,
              model: shared.aiModel,
              output: textOf(box.html),
              context: [{ label: "Script", text: rows.map((r) => r.text).join("\n").slice(0, 6000) }],
              links: [...box.html.matchAll(/<a href="([^"]+)">([^<]*)<\/a>/g)].map((m) => ({ title: m[2] || m[1], url: m[1] })),
            };
          }} />
        )}
        {box.label && (
          <span className="label-style-wrap" onPointerDown={(e) => e.stopPropagation()}>
            <button className="label-color-btn" style={{ background: labelColorOf(box) }} aria-label="Section colour"
              title="Colour and style" onClick={() => setStyling((v) => !v)} />
            {styling && (
              <span className="label-style-pop" role="dialog" aria-label="Section style">
                <span className="label-swatches">
                  {LABEL_COLORS.map((c) => (
                    <button key={c} className={`label-swatch${box.labelColor === c ? " on" : ""}`} style={{ background: c }}
                      aria-label={`Colour ${c}`} onClick={() => shared.updateBox(box, { labelColor: c })} />
                  ))}
                </span>
                {/* A node is a whiteboard shape: offered there, and read as a heading in the document. */}
                {dragHandle && (
                  <span className="seg label-style-seg">
                    {(["heading", "node"] as const).map((shape) => (
                      <button key={shape} className={(box.labelShape === "node" ? "node" : "heading") === shape ? "on" : ""}
                        onClick={() => shared.updateBox(box, { labelShape: shape === "node" ? "node" : undefined })}>
                        {shape === "node" ? "◯ Node" : "Heading"}
                      </button>
                    ))}
                  </span>
                )}
                {/* A node is always filled with its colour; underline or background is a heading's choice. */}
                {!(box.labelShape === "node" && dragHandle) && (
                <span className="seg label-style-seg">
                  {(["underline", "fill"] as const).map((st) => (
                    <button key={st} className={(box.labelStyle ?? "underline") === st ? "on" : ""}
                      onClick={() => shared.updateBox(box, { labelStyle: st })}>
                      {st === "underline" ? "Underline" : "Background"}
                    </button>
                  ))}
                </span>
                )}
              </span>
            )}
          </span>
        )}
        {!inDoc && (
          <>
            <TagButton id={box.id} tags={shared.tags} label={box.label ? "section" : boxKind(box) === "image" ? "picture" : boxKind(box)} />
            {!box.label && (
              <button className="icon-btn subtle print-btn" aria-label={`Print this ${boxKind(box) === "image" ? "picture" : boxKind(box)}`}
                title="Print this on its own" onPointerDown={(e) => e.stopPropagation()} onClick={() => shared.printItem(box.id)}>
                {Icon.print}
              </button>
            )}
            <button className="icon-btn subtle" aria-label="Delete text box" onPointerDown={(e) => e.stopPropagation()}
              onClick={() => shared.removeBox(box)}>
              {Icon.close}
            </button>
          </>
        )}
      </div>
      {box.label && box.labelShape === "node" && dragHandle ? (
        // A node: the label in a circle, which also drags it; lines leave from all round it.
        <div className="node-circle" style={{ "--label-color": labelColorOf(box) } as React.CSSProperties}
          onPointerDown={dragHandle}>
          <input
            className="section-label node-label"
            defaultValue={textOf(box.html)}
            placeholder="Node"
            autoFocus={shared.focusBox === box.id}
            aria-label="Node label"
            onPointerDown={(e) => e.stopPropagation()}
            onBlur={(e) => {
              const text = e.currentTarget.value.trim().slice(0, 120);
              if (text !== textOf(box.html)) shared.setBox(box, escapeHtml(text));
            }}
            onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
          />
        </div>
      ) : box.label ? (
        <input
          className={`section-label${box.labelStyle === "fill" ? " fill" : ""}`}
          style={{ "--label-color": labelColorOf(box) } as React.CSSProperties}
          defaultValue={textOf(box.html)}
          placeholder="Section"
          autoFocus={shared.focusBox === box.id}
          aria-label="Section label"
          onPointerDown={(e) => e.stopPropagation()}
          onBlur={(e) => {
            const text = e.currentTarget.value.trim().slice(0, 120);
            if (text !== textOf(box.html)) shared.setBox(box, escapeHtml(text));
          }}
          onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
        />
      ) : box.transcript ? (
        <TranscriptBox box={box} onChange={(change) => shared.updateBox(box, change)} onComment={(html) => shared.noteTranscript(box, html)} aiSearch={shared.aiSearch}
          flagWith={{ subject: shared.subjectName, model: shared.aiQuickModel }} />
      ) : box.table ? (
        <TableBox box={box} onChange={(change) => shared.updateBoxRecorded(box, change)} history={shared.stepHistory} media={{ dropImage: shared.dropImage, resolveEmbed: shared.resolveEmbed, replaceEmbed: shared.replaceEmbed }}
          facts={productionOf(box) ? undefined : { run: (sheet, write) => shared.factCheck(box, sheet, write), produce: (sheet) => shared.produce(box, sheet), open: shared.openSource }} />
      ) : box.drawing ? (
        <DrawingPad box={box} onChange={(change) => shared.updateBox(box, change)} />
      ) : box.image !== undefined || box.caption !== undefined ? (
        <ImageView box={box} onChange={(change) => shared.updateBox(box, change)} onRemove={() => shared.removeBox(box)} />
      ) : (
        <RichText html={box.html} placeholder="Write anything…" autoFocus={shared.focusBox === box.id}
          resolveEmbed={shared.resolveEmbed} onEmbed={shared.embedBox} onDropImage={shared.dropImage} onReplaceEmbed={shared.replaceEmbed}
          onPasteLink={(url) => shared.storyFromLink(url, box.id)} onChange={(html) => shared.setBox(box, html)} />
      )}
      {!inDoc && <TagBadges id={box.id} tags={shared.tags} />}
    </div>
  );
}

/** An insight as a flag: what it said, and the stories it drew on. */
function insightFlag(insight: InsightItem, shared: Shared): FlagInput {
  const drawn = insight.refs.map((ref) => shared.allCards.find((card) => card.id === ref)).filter((c): c is Card => !!c);
  return {
    kind: "insight",
    subject: shared.subjectName,
    model: shared.aiModel,
    output: insight.text,
    context: [{ label: "Type", text: INSIGHT_LABEL[insight.type] }],
    links: drawn.map((c) => ({ title: c.source ? `${c.source}: ${c.title}` : c.title, url: c.link })),
  };
}

function InsightCard({ insight, cards, dragHandle, shared }: { insight: InsightItem; cards: Card[]; dragHandle?: (e: React.PointerEvent) => void; shared: Shared }) {
  const titles = insight.refs
    .map((ref) => cards.find((card) => card.id === ref)?.title)
    .filter(Boolean);
  return (
    <div className="subject-insight" onPointerDown={dragHandle}>
      <span className="ai-tag">✦ {INSIGHT_LABEL[insight.type]}</span>
      <FlagButton make={() => insightFlag(insight, shared)} />
      <button className="insight-dismiss" aria-label="Dismiss" title="Dismiss"
              onPointerDown={(e) => e.stopPropagation()} onClick={() => shared.dismissInsight(insight)}>×</button>
      <p>{insight.text}</p>
      {titles.length > 0 && <div className="subject-insight-refs">Draws on: {titles.join(" · ")}</div>}
    </div>
  );
}

/**
 * A story the AI suggests: warm-coloured until decided. The tick makes it an
 * ordinary story card; the cross dismisses it for good. The headline opens it
 * to read first.
 */
function SuggestionCard({ suggestion, shared, dragHandle }: { suggestion: SuggestItem; shared: Shared; dragHandle?: (e: React.PointerEvent) => void }) {
  return (
    <div className="subject-suggest" onPointerDown={dragHandle}>
      <div className="subject-suggest-head">
        <span className="ai-tag">✦ Suggested reading</span>
        <div className="subject-suggest-decide" onPointerDown={(e) => e.stopPropagation()}>
          <FlagButton make={() => ({
            kind: "reading", subject: shared.subjectName, model: shared.aiQuickModel,
            output: suggestion.why,
            context: [{ label: "Suggested story", text: suggestion.title }],
            links: [{ title: suggestion.source ? `${suggestion.source}: ${suggestion.title}` : suggestion.title, url: suggestion.link }],
          })} />
          <button className="decide accept" aria-label="Add to subject" title="Add to subject"
            onClick={() => shared.decide(suggestion, "accepted")}>
            {Icon.check}
          </button>
          <button className="decide dismiss" aria-label="Not relevant" title="Not relevant"
            onClick={() => shared.decide(suggestion, "dismissed")}>
            {Icon.close}
          </button>
        </div>
      </div>
      <button className="subject-card-title" title="Read it"
        onClick={() => shared.onOpenArticle(suggestion.link, suggestion.title, "")}>
        {suggestion.title}
      </button>
      {suggestion.source && <div className="subject-card-source">{suggestion.source}</div>}
      <p className="subject-suggest-why">{suggestion.why}</p>
    </div>
  );
}

/** An insight about one story sits inside that story; the rest stand apart. */
function splitInsights(insights: InsightItem[]) {
  const inside = new Map<string, InsightItem[]>();
  const apart: InsightItem[] = [];
  for (const insight of insights) {
    if (insight.refs.length === 1 && insight.type !== "connection") {
      inside.set(insight.refs[0], [...(inside.get(insight.refs[0]) ?? []), insight]);
    } else {
      apart.push(insight);
    }
  }
  return { inside, apart };
}

/* ---------------------------------------------------------------------- */
/* Writing the document from the keyboard                                  */
/* ---------------------------------------------------------------------- */

/** What can take the caret in a block of the document. */
function editorOf(block: Element): HTMLElement | null {
  return block.querySelector<HTMLElement>(".subject-box.text-box .rich-body, .subject-card-note .rich-body, input.section-label");
}
const isText = (block: Element) => Boolean(block.querySelector(".subject-box.text-box"));
const isLabelBlock = (block: Element) => Boolean(block.querySelector("input.section-label"));

/** Text from the start (or to the end) of an editor, to the caret: nothing but the caret's own empty line means it is at that edge. */
function atEdge(body: HTMLElement, end: boolean): boolean {
  const sel = window.getSelection();
  if (!sel?.isCollapsed || !sel.rangeCount || !sel.anchorNode || !body.contains(sel.anchorNode)) return false;
  const range = document.createRange();
  range.selectNodeContents(body);
  if (end) range.setStart(sel.anchorNode, sel.anchorOffset);
  else range.setEnd(sel.anchorNode, sel.anchorOffset);
  const part = range.cloneContents();
  if ((part.textContent ?? "").replace(/[​ ]/g, "").length) return false;
  if (part.querySelector("img, a[data-cite], a[data-subject]")) return false;
  return part.querySelectorAll("p, div, h3, blockquote, li").length <= 1;
}

/** The caret on the first (or last) line of an editor, for the arrows. */
function onEdgeLine(body: HTMLElement, last: boolean): boolean {
  const sel = window.getSelection();
  if (!sel?.isCollapsed || !sel.rangeCount) return false;
  if (atEdge(body, last)) return true;
  const rects = sel.getRangeAt(0).getClientRects();
  const caret = rects[0] ?? (sel.anchorNode instanceof Element ? sel.anchorNode : sel.anchorNode?.parentElement)?.getBoundingClientRect();
  if (!caret) return false;
  const box = body.getBoundingClientRect();
  const line = parseFloat(getComputedStyle(body).lineHeight) || 22;
  return last ? box.bottom - caret.bottom < line * 0.8 : caret.top - box.top < line * 0.8;
}

const isEmptyText = (body: HTMLElement) =>
  !(body.textContent ?? "").replace(/[​ \s]/g, "") && !body.querySelector("img, a[data-cite], a[data-subject]");

function caretTo(target: HTMLElement, end: boolean) {
  target.focus({ preventScroll: true });
  if (target instanceof HTMLInputElement) {
    const at = end ? target.value.length : 0;
    target.setSelectionRange(at, at);
  } else {
    const range = document.createRange();
    range.selectNodeContents(target);
    range.collapse(!end);
    const sel = window.getSelection();
    sel?.removeAllRanges();
    sel?.addRange(range);
  }
  target.scrollIntoView({ block: "nearest" });
}

/**
 * The document written as one document. Blocks are still the whiteboard's
 * blocks underneath — text boxes, stories, tables — but the keyboard crosses
 * between them as though they were paragraphs:
 *
 * - Backspace at the start of a text block joins it to the text block above,
 *   and an emptied block goes altogether.
 * - A story, table, picture or transcript is one piece: Backspace into it
 *   (or at the start of a story's notes) selects it, and Backspace again
 *   takes it away — undoable, as any deletion here is. Enter on a selected
 *   block starts a new text block right below it.
 * - The arrows run on from the top or bottom line of one block into the next.
 */
function useDocKeys(
  root: HTMLElement | null,
  shared: Shared & { addBox: (at?: { x: number; y: number }, extra?: Partial<BoxItem>) => void; board: Board | undefined },
  picked: string[],
  setPicked: (ids: string[]) => void,
) {
  const latest = useRef({ shared, picked });
  latest.current = { shared, picked };
  useEffect(() => {
    if (!root) return;
    const blocks = () => [...root.querySelectorAll<HTMLElement>(":scope > [data-item]")];
    const neighbour = (block: HTMLElement, by: number) => {
      const all = blocks();
      return all[all.indexOf(block) + by] ?? null;
    };
    const blockOf = (id: string) => blocks().find((b) => b.dataset.item === id) ?? null;
    /** Where a run of selected blocks started, for Shift to extend from. */
    let anchor: string | null = null;
    /** Select a block — or, extending, every block from the first one selected to it. */
    const pick = (block: HTMLElement, extend = false) => {
      (document.activeElement as HTMLElement | null)?.blur?.();
      const all = blocks();
      const id = block.dataset.item!;
      if (extend && anchor && latest.current.picked.length) {
        const [a, b] = [all.findIndex((x) => x.dataset.item === anchor), all.indexOf(block)].sort((x, y) => x - y);
        setPicked(all.slice(Math.max(0, a), b + 1).map((x) => x.dataset.item!));
      } else {
        anchor = id;
        setPicked([id]);
      }
      block.focus({ preventScroll: true });
      block.scrollIntoView({ block: "nearest" });
    };
    const clear = () => {
      anchor = null;
      setPicked([]);
    };
    /** Into a block from above (start) or below (end): its text, or the whole of it when it has none. */
    const enter = (block: HTMLElement | null, end: boolean) => {
      if (!block) return false;
      const editor = editorOf(block);
      // A story is entered at its notes; a table or picture is selected whole.
      if (editor) caretTo(editor, end);
      else pick(block);
      return true;
    };
    const removeBlock = (block: HTMLElement) => {
      const { shared: s } = latest.current;
      const id = block.dataset.item!;
      const card = s.cards.find((c) => c.id === id);
      if (card) s.removeStory(card);
      else s.removeCards([id]);
    };
    /** Write on right after a block: a new text box that reads below it. */
    const writeAfter = (block: HTMLElement) => {
      clear();
      latest.current.shared.addBox(undefined, { after: block.dataset.item });
    };
    /** Join one text block onto the end of another: the writing moves up, the emptied block goes. */
    const join = (into: HTMLElement, from: HTMLElement) => {
      const a = editorOf(into);
      const b = editorOf(from);
      if (!a || !b || a instanceof HTMLInputElement || b instanceof HTMLInputElement) return;
      const mark = document.createRange();
      mark.selectNodeContents(a);
      mark.collapse(false);
      // Copied, not moved: the block left behind saves what it holds as it loses focus, and must not save itself empty.
      const moved = [...b.childNodes].map((n) => n.cloneNode(true));
      a.append(...moved);
      a.focus({ preventScroll: true });
      const sel = window.getSelection();
      sel?.removeAllRanges();
      // The caret where the two met.
      const first = moved[0];
      if (first) {
        const at = document.createRange();
        at.setStart(first, 0);
        at.collapse(true);
        sel?.addRange(at);
      } else sel?.addRange(mark);
      // One step: undone, the block comes back and the writing leaves the one above.
      latest.current.shared.joinBlocks(into.dataset.item!, from.dataset.item!, a.innerHTML);
    };

    const key = (event: KeyboardEvent) => {
      if (event.altKey || event.isComposing) return;
      const target = event.target as HTMLElement;
      const chosen = latest.current.picked;
      const done = () => {
        event.preventDefault();
        event.stopPropagation();
      };
      // ⌘A on selected blocks: every block of the tab.
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "a" && chosen.length && target.matches?.("[data-item]")) {
        const all = blocks();
        anchor = all[0]?.dataset.item ?? null;
        setPicked(all.map((b) => b.dataset.item!));
        return done();
      }
      if (event.metaKey || event.ctrlKey) return;

      // Blocks selected whole.
      if (chosen.length && target.matches?.("[data-item]")) {
        const block = target;
        const run = chosen.map(blockOf).filter((b): b is HTMLElement => !!b);
        const first = run[0] ?? block;
        const last = run[run.length - 1] ?? block;
        if (event.key === "Backspace" || event.key === "Delete") {
          const before = neighbour(first, -1);
          const after = neighbour(last, 1);
          clear();
          for (const b of run) removeBlock(b);
          // The caret goes where the blocks were: the end of the one above, or the start of the one below.
          requestAnimationFrame(() => (event.key === "Backspace" ? enter(before, true) || enter(after, false) : enter(after, false) || enter(before, true)));
          return done();
        }
        if (event.key === "Enter") {
          writeAfter(last);
          return done();
        }
        if (event.key === "Escape") {
          clear();
          return done();
        }
        // Shift and an arrow: the selection grows (or shrinks) a block at a time.
        if (event.shiftKey && (event.key === "ArrowUp" || event.key === "ArrowDown")) {
          // The end that moves is the one away from where the selection began.
          const edge = first.dataset.item === anchor ? last : first;
          const to = neighbour(edge, event.key === "ArrowUp" ? -1 : 1);
          if (to) pick(to, true);
          return done();
        }
        if (event.key === "ArrowUp" || event.key === "ArrowLeft") {
          clear();
          enter(neighbour(first, -1), true);
          return done();
        }
        if (event.key === "ArrowDown" || event.key === "ArrowRight") {
          clear();
          const next = neighbour(last, 1);
          if (next) enter(next, false);
          else writeAfter(last);
          return done();
        }
        return;
      }

      const block = target.closest<HTMLElement>("[data-item]");
      if (!block || block.parentElement !== root) return;
      // Inside a table, a transcript or a drawing the keys are theirs.
      if (target.closest(".tbl, .transcript, .sheet, .drawing")) return;
      const editor = editorOf(block);
      if (!editor || !editor.contains(target) && editor !== target) return;
      const label = editor instanceof HTMLInputElement ? editor : null;
      const body = label ? null : editor;
      // A list's own Backspace (out of the list) and the subject picker come first.
      const inList = !!window.getSelection()?.anchorNode?.parentElement?.closest("li");
      const start = label ? label.selectionStart === 0 && label.selectionEnd === 0 : !inList && atEdge(body!, false);
      const end = label ? label.selectionStart === label.value.length : !inList && atEdge(body!, true);
      const before = neighbour(block, -1);
      const after = neighbour(block, 1);
      const isStory = !!block.querySelector(".subject-card");

      // Esc while writing selects the block, to copy, move or remove it whole.
      if (event.key === "Escape") {
        pick(block);
        return done();
      }

      if (event.key === "Backspace" && start) {
        // An emptied block goes; the caret carries on at the end of the one above.
        const empty = label ? !label.value.trim() : isText(block) && isEmptyText(body!);
        if (empty && (before || after)) {
          removeBlock(block);
          if (before) enter(before, true);
          else enter(after, false);
          return done();
        }
        if (isStory) {
          pick(block);
          return done();
        }
        if (!before) return;
        if (isText(block) && isText(before)) {
          join(before, block);
          return done();
        }
        if (editorOf(before) && !before.querySelector(".subject-card")) enter(before, true);
        else pick(before);
        return done();
      }
      if (event.key === "Delete" && end) {
        const empty = label ? !label.value.trim() : isText(block) && isEmptyText(body!);
        if (empty && (before || after)) {
          removeBlock(block);
          if (after) enter(after, false);
          else enter(before, true);
          return done();
        }
        if (!after) return;
        if (isText(block) && isText(after)) {
          join(block, after);
          return done();
        }
        pick(after);
        return done();
      }
      const upward = event.key === "ArrowUp" || (event.key === "ArrowLeft" && start);
      const downward = event.key === "ArrowDown" || (event.key === "ArrowRight" && end);
      if (upward && (label || event.key === "ArrowLeft" || onEdgeLine(body!, false)) && before) {
        enter(before, true);
        return done();
      }
      if (downward && (label || event.key === "ArrowRight" || onEdgeLine(body!, true))) {
        if (after) enter(after, false);
        // Below the last block: somewhere to keep writing.
        else if (!isText(block)) writeAfter(block);
        else return;
        return done();
      }
      if (event.key === "Enter" && label) {
        // A section header, then its first line of writing.
        if (after && isText(after)) enter(after, false);
        else writeAfter(block);
        return done();
      }
    };
    // Capture: a field's own handlers stop the event going further.
    root.addEventListener("keydown", key, true);
    const away = (event: PointerEvent) => {
      if (!latest.current.picked.length) return;
      const hit = (event.target as Element | null)?.closest?.("[data-item]") as HTMLElement | null;
      // Shift-click another block: the selection runs to it.
      if (hit && hit.parentElement === root && event.shiftKey) {
        event.preventDefault();
        event.stopPropagation();
        pick(hit, true);
        return;
      }
      if (!hit || !latest.current.picked.includes(hit.dataset.item!)) clear();
    };
    document.addEventListener("pointerdown", away, true);

    /*
     * Blocks to the clipboard and back, in the whiteboard's own format, so
     * they travel between tabs, subjects and the whiteboard alike. Copied:
     * the selected blocks, in the order the document reads them. Pasted:
     * right after the block selected or being written in, on this tab.
     */
    const selectedNow = (event: Event) => {
      const ids = latest.current.picked;
      if (!ids.length) return [];
      // Only while the selection is what has focus — not text being written in a block.
      const t = event.target as HTMLElement | null;
      return t && (t === document.body || t.matches?.("[data-item]")) ? ids : [];
    };
    const positions = () => {
      const spots = new Map<string, { x: number; y: number; w: number }>();
      const all = blocks();
      for (const item of live(latest.current.shared.board)) {
        if (item.kind === "pos") spots.set((item as PosItem).target, { x: (item as PosItem).x, y: (item as PosItem).y, w: (item as PosItem).w || CARD_W });
      }
      // A block never placed on the whiteboard: stacked, in reading order.
      all.forEach((b, i) => {
        const id = b.dataset.item!;
        if (!spots.has(id)) spots.set(id, { x: 0, y: i * 220, w: CARD_W });
      });
      return spots;
    };
    const copy = (event: ClipboardEvent, cut: boolean) => {
      const ids = selectedNow(event);
      if (!ids.length) return;
      const { shared: s } = latest.current;
      const copied = blocksFor(s.board, s.cards, ids, positions());
      if (!copied) return;
      event.preventDefault();
      const json = JSON.stringify(copied);
      blockClipboard = json;
      event.clipboardData?.setData(BLOCKS_TYPE, json);
      event.clipboardData?.setData("text/plain", copied.text);
      if (cut) {
        const run = ids.map(blockOf).filter((b): b is HTMLElement => !!b);
        clear();
        for (const b of run) removeBlock(b);
      }
    };
    const paste = (event: ClipboardEvent) => {
      const t = event.target as HTMLElement | null;
      const inDoc = t && root.contains(t);
      // In the document, on nothing in particular (an empty tab, say), or on selected blocks.
      const nowhere = !t || t === document.body || t === document.documentElement;
      if (!inDoc && !nowhere && !latest.current.picked.length) return;
      // Writing in a table or transcript keeps its own paste.
      if (t?.closest?.(".tbl, .transcript, .sheet, input, textarea")) return;
      const custom = event.clipboardData?.getData(BLOCKS_TYPE);
      const plain = event.clipboardData?.getData("text/plain") ?? "";
      // Without the custom type (some browsers drop it), the blocks last copied here — if the text is theirs.
      const fallback = !custom && blockClipboard && readBlocks(blockClipboard) && plain.trim() === (JSON.parse(blockClipboard) as CopiedBlocks).text.trim() ? blockClipboard : null;
      const copied = readBlocks(custom || fallback);
      if (!copied) return;
      event.preventDefault();
      event.stopPropagation();
      const picked = latest.current.picked;
      const host = picked.length ? blockOf(picked[picked.length - 1]) : t?.closest<HTMLElement>("[data-item]") ?? null;
      clear();
      latest.current.shared.pasteBlocks(copied, host?.parentElement === root ? host.dataset.item! : null);
    };
    const onCopy = (e: ClipboardEvent) => copy(e, false);
    const onCut = (e: ClipboardEvent) => copy(e, true);
    document.addEventListener("copy", onCopy, true);
    document.addEventListener("cut", onCut, true);
    document.addEventListener("paste", paste, true);
    return () => {
      root.removeEventListener("keydown", key, true);
      document.removeEventListener("pointerdown", away, true);
      document.removeEventListener("copy", onCopy, true);
      document.removeEventListener("cut", onCut, true);
      document.removeEventListener("paste", paste, true);
    };
  }, [root, setPicked]);
}

/* ---------------------------------------------------------------------- */
/* Document view                                                           */
/* ---------------------------------------------------------------------- */

function DocumentView(
  shared: Shared & {
    addBox: (at?: { x: number; y: number }, extra?: Partial<BoxItem>) => void;
    pickImage: (at?: { x: number; y: number }) => void;
    board: Board | undefined;
  },
) {
  const { inside, apart } = splitInsights(shared.insights);
  // Right-click (or double-click) the page's empty space for something new.
  const [menu, setMenu] = useState<{ left: number; top: number } | null>(null);
  useEffect(() => {
    if (!menu) return;
    const close = () => setMenu(null);
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setMenu(null);
    window.addEventListener("pointerdown", close);
    window.addEventListener("keydown", esc);
    window.addEventListener("scroll", close, true);
    return () => {
      window.removeEventListener("pointerdown", close);
      window.removeEventListener("keydown", esc);
      window.removeEventListener("scroll", close, true);
    };
  }, [menu]);
  const open = (event: React.MouseEvent) => {
    if (event.target !== event.currentTarget) return;
    event.preventDefault();
    setMenu({ left: Math.min(event.clientX, window.innerWidth - 200), top: Math.min(event.clientY, window.innerHeight - 200) });
  };
  // A picture pasted while nothing is being typed in joins the page as its own box.
  useEffect(() => {
    const paste = (e: ClipboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t?.closest?.("input, textarea, [contenteditable]")) return;
      const picture = clipboardPicture(e);
      if (!picture) return;
      e.preventDefault();
      void shrinkImage(picture).then((image) => shared.addBox(undefined, { image, caption: "" })).catch(() => {});
    };
    document.addEventListener("paste", paste);
    return () => document.removeEventListener("paste", paste);
  });
  const holdRef = useRef<{ x: number; y: number; timer: ReturnType<typeof setTimeout> } | null>(null);
  const pick = (run: () => void) => () => {
    run();
    setMenu(null);
  };
  // One fixed bar of text tools at the top of the document, for whichever block is being written in.
  const [toolsHost, setToolsHost] = useState<HTMLDivElement | null>(null);
  // The document written from the keyboard; a story, table or picture selected whole.
  const [docEl, setDocEl] = useState<HTMLDivElement | null>(null);
  const [picked, setPicked] = useState<string[]>([]);
  useDocKeys(docEl, shared, picked, setPicked);
  // A story set into the writing as a card reads there, not again as a block of its own.
  const inlined = new Set(shared.boxes.flatMap((box) => (box.html ? inlineCardLinks(box.html) : [])));
  const entries = [
    ...shared.cards.filter((card) => !inlined.has(card.id)).map((card) => ({ id: card.id, at: card.at, after: card.after, key: card.id, node: <StoryCard card={card} own={inside.get(card.id) ?? []} shared={shared} /> })),
    ...shared.boxes.map((box) => ({ id: box.id, at: madeAt(box), label: box.label, after: box.after, key: box.id, node: <TextBox box={box} shared={shared} /> })),
  ];
  // Sections read as they do on the whiteboard: each header, then what is linked to it.
  const byId = new Map(entries.map((e) => [e.id, e]));
  const stack = documentOrder(entries, shared.board).map((id) => byId.get(id)!);

  return (
    <ToolsHostContext.Provider value={toolsHost}>
    <div className="subject-doc" ref={setDocEl} onContextMenu={open} onDoubleClick={open}
      // Press and hold on empty space: the same menu, for a touch screen.
      onTouchStart={(e) => {
        if (e.target !== e.currentTarget || e.touches.length !== 1) return;
        const t = e.touches[0];
        const x = t.clientX;
        const y = t.clientY;
        holdRef.current = { x, y, timer: setTimeout(() => {
          holdRef.current = null;
          setMenu({ left: Math.min(x, window.innerWidth - 200), top: Math.min(y, window.innerHeight - 200) });
          navigator.vibrate?.(10);
        }, 550) };
      }}
      onTouchMove={(e) => {
        const h = holdRef.current;
        const t = e.touches[0];
        if (h && t && Math.hypot(t.clientX - h.x, t.clientY - h.y) > 8) { clearTimeout(h.timer); holdRef.current = null; }
      }}
      onTouchEnd={() => { if (holdRef.current) clearTimeout(holdRef.current.timer); holdRef.current = null; }}>
      <div className="doc-toolbar" ref={setToolsHost} role="toolbar" aria-label="Text tools" onMouseDown={(e) => e.preventDefault()}>
        <div className="doc-toolbar-idle" aria-hidden="true">
          {TOOL_LABELS.map((label) => <span key={label}>{label}</span>)}
        </div>
      </div>
      {menu && (
        <div className="wb-menu doc-menu" role="menu" style={{ left: menu.left, top: menu.top }} onPointerDown={(e) => e.stopPropagation()}>
          <button role="menuitem" onClick={pick(() => shared.addBox())}><span className="wb-menu-icon">¶</span> Text box</button>
          <button role="menuitem" onClick={pick(() => shared.addBox(undefined, { drawing: [], height: DRAWING_HEIGHT }))}>
            <span className="wb-menu-icon">✎</span> Drawing
          </button>
          <button role="menuitem" onClick={pick(() => shared.pickImage())}><span className="wb-menu-icon">▣</span> Image…</button>
          <button role="menuitem" onClick={pick(() => shared.addBox(undefined, { table: NEW_TABLE(), tableMode: "doc" }))}>
            <span className="wb-menu-icon">▦</span> Table
          </button>
          <button role="menuitem" onClick={pick(() => shared.addBox(undefined, { transcript: { title: "", turns: [] } }))}>
            <span className="wb-menu-icon">❝</span> Transcript
          </button>
        </div>
      )}
      {stack.length === 0 && (
        <p className="hint">
          Nothing here yet. Highlight a passage in an article and add it to this subject, use <strong>Subject</strong> in
          an article&apos;s toolbar to add the whole story, or start with a text box.
        </p>
      )}
      {stack.map((entry) => (
        <div key={entry.key} data-item={entry.key} tabIndex={-1}
          className={[shared.tags.lit ? (shared.tags.lit.has(entry.id) ? "tag-lit" : "tag-dim") : "", picked.includes(entry.key) ? "doc-picked" : ""].filter(Boolean).join(" ") || undefined}>
          {entry.node}
          {picked[picked.length - 1] === entry.key && (
            <div className="doc-picked-hint" aria-live="polite">
              {picked.length > 1 ? `${picked.length} blocks · ` : ""}⌘C copies · ⌘X cuts · Backspace removes · Enter writes below · Esc
            </div>
          )}
        </div>
      ))}
      {apart.length > 0 && (
        <div className="subject-insights-card">
          <div className="subject-insights-head">✦ Across your stories</div>
          {apart.map((insight) => (
            <div key={insight.id} className="subject-insight-row">
              <span className="ai-tag">{INSIGHT_LABEL[insight.type]}</span>
              <p>{insight.text}</p>
              <FlagButton make={() => insightFlag(insight, shared)} />
              <button className="insight-dismiss" aria-label="Dismiss" title="Dismiss"
              onPointerDown={(e) => e.stopPropagation()} onClick={() => shared.dismissInsight(insight)}>×</button>
            </div>
          ))}
        </div>
      )}
      {shared.suggestions.map((suggestion) => (
        <SuggestionCard key={suggestion.id} suggestion={suggestion} shared={shared} />
      ))}
    </div>
    </ToolsHostContext.Provider>
  );
}

/* ---------------------------------------------------------------------- */
/* Whiteboard                                                              */
/* ---------------------------------------------------------------------- */

type Node = { id: string; kind: "card" | "box" | "insight" | "suggest"; render: (drag: (e: React.PointerEvent) => void) => React.ReactNode };

const CARD_W = 300;

function Whiteboard(
  shared: Shared & {
    placeKey: string;
    boxWidth: number;
    board: Board | undefined;
    onBoard: Props["onBoard"];
    addBox: (at?: { x: number; y: number }, extra?: Partial<BoxItem>) => void;
    pickImage: (at?: { x: number; y: number }) => void;
  },
) {
  /** The right-click menu on empty board: where it opened, on screen and on the board. */
  const [menu, setMenu] = useState<{ left: number; top: number; at: { x: number; y: number } } | null>(null);
  useEffect(() => {
    if (!menu) return;
    const close = () => setMenu(null);
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setMenu(null);
    window.addEventListener("pointerdown", close);
    window.addEventListener("keydown", esc);
    return () => {
      window.removeEventListener("pointerdown", close);
      window.removeEventListener("keydown", esc);
    };
  }, [menu]);
  // The how-to line under the tools goes once the board has been used.
  const [boardUsed, setBoardUsed] = useState(true);
  useEffect(() => {
    try {
      setBoardUsed(localStorage.getItem(BOARD_USED_KEY) === "1");
    } catch {
      /* show it */
    }
  }, []);
  const markBoardUsed = () => {
    if (boardUsed) return;
    setBoardUsed(true);
    try {
      localStorage.setItem(BOARD_USED_KEY, "1");
    } catch {
      /* not remembered */
    }
  };
  const { board, onBoard } = shared;
  // A phone starts zoomed out, so more than one card fits across.
  const startView = () =>
    typeof window !== "undefined" && window.innerWidth < 760 ? { x: 12, y: 12, zoom: 0.55 } : { x: 40, y: 40, zoom: 1 };
  const [view, setView] = useState(() => {
    try {
      const held = JSON.parse(sessionStorage.getItem(shared.placeKey) ?? "{}").board;
      if (held && [held.x, held.y, held.zoom].every((n) => typeof n === "number" && Number.isFinite(n))) return held as { x: number; y: number; zoom: number };
    } catch {
      /* start fresh */
    }
    return startView();
  });
  useEffect(() => {
    // Only zooming out brings the map up; zooming back in puts it away.
    const delta = lastZoom.current === null ? 0 : view.zoom - lastZoom.current;
    lastZoom.current = view.zoom;
    if (delta > 0.0005) {
      if (mapTimer.current) clearTimeout(mapTimer.current);
      mapShownRef.current = false;
      setMapShown(false);
      return;
    }
    const zoomedOut = delta < -0.0005;
    if (!zoomedOut && !mapShownRef.current) return;
    mapShownRef.current = true;
    setMapShown(true);
    if (mapTimer.current) clearTimeout(mapTimer.current);
    mapTimer.current = setTimeout(() => {
      mapShownRef.current = false;
      setMapShown(false);
    }, 1400);
  }, [view]);

  // Where the board was panned and zoomed to, kept for a refresh.
  useEffect(() => {
    const t = setTimeout(() => {
      try {
        const held = JSON.parse(sessionStorage.getItem(shared.placeKey) ?? "{}");
        sessionStorage.setItem(shared.placeKey, JSON.stringify({ ...held, board: view }));
      } catch {
        /* not remembered */
      }
    }, 300);
    return () => clearTimeout(t);
  }, [view, shared.placeKey]);
  /**
   * What is being dragged: the node under the pointer at (x, y), and any
   * others moving with it — a selection, or a section label's own items —
   * from where each started, by the same distance.
   */
  const [drag, setDrag] = useState<{ id: string; x: number; y: number; dx: number; dy: number; group: Map<string, { x: number; y: number; w: number }>; join?: string | null } | null>(null);
  /** Nodes picked by dragging a box over them, to move together. */
  const [selected, setSelected] = useState<Set<string>>(new Set());
  /** The right-click menu on a block: where it opened, and for which. */
  const [nodeMenu, setNodeMenu] = useState<{ id: string; left: number; top: number } | null>(null);
  /** Blocks being tagged from the right-click menu — the whole selection, if it was part of one. */
  const [tagging, setTagging] = useState<{ ids: string[]; at: { left: number; top: number } } | null>(null);
  useEffect(() => {
    if (!nodeMenu) return;
    const close = () => setNodeMenu(null);
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setNodeMenu(null);
    window.addEventListener("pointerdown", close);
    window.addEventListener("keydown", esc);
    return () => {
      window.removeEventListener("pointerdown", close);
      window.removeEventListener("keydown", esc);
    };
  }, [nodeMenu]);
  /** The block box being dragged out over empty board, in board coordinates. */
  const [marquee, setMarquee] = useState<{ x0: number; y0: number; x1: number; y1: number } | null>(null);
  /** A card being widened or narrowed, by its right-hand edge. */
  /** A card being resized, and any others selected with it — each by the same amount. */
  const [resize, setResize] = useState<{ id: string; w: number; dw: number; others: Map<string, { x: number; y: number; w: number }> } | null>(null);
  const [connecting, setConnecting] = useState<string | null | false>(false);
  // Connecting turns every card into a plain block: whatever was being typed in lets go.
  useEffect(() => {
    if (connecting === false) return;
    const active = document.activeElement as HTMLElement | null;
    if (active?.closest(".wb-canvas")) active.blur();
    window.getSelection()?.removeAllRanges();
  }, [connecting]);
  const [focus, setFocus] = useState<string | null>(null);
  const [showAiLinks, setShowAiLinks] = useState(false);
  const [sizes, setSizes] = useState<Record<string, { w: number; h: number }>>({});
  /**
   * The minimap: shown when the board is zoomed, kept up while the same
   * gesture goes on panning, and gone a moment after it all stops.
   */
  const [mapShown, setMapShown] = useState(false);
  /** A touch device: no blur filters, which are what crashed Safari when zoomed out. */
  const [lowPower] = useState(
    () => typeof window !== "undefined" && (window.matchMedia?.("(pointer: coarse)").matches || window.innerWidth < 900),
  );
  const lastZoom = useRef<number | null>(null);
  const mapTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mapShownRef = useRef(false);
  const nodeEls = useRef(new Map<string, HTMLDivElement>());
  const canvas = useRef<HTMLDivElement | null>(null);

  const nodes: Node[] = [
    ...shared.cards.map((card) => ({
      id: card.id, kind: "card" as const,
      render: (d: (e: React.PointerEvent) => void) => <StoryCard card={card} own={[]} shared={shared} dragHandle={d} />,
    })),
    ...shared.boxes.map((box) => ({
      id: box.id, kind: "box" as const,
      render: (d: (e: React.PointerEvent) => void) => <TextBox box={box} shared={shared} dragHandle={d} />,
    })),
    ...shared.insights.map((insight) => ({
      id: insight.id, kind: "insight" as const,
      render: (d: (e: React.PointerEvent) => void) => <InsightCard insight={insight} cards={shared.cards} dragHandle={d} shared={shared} />,
    })),
    ...shared.suggestions.map((suggestion) => ({
      id: suggestion.id, kind: "suggest" as const,
      render: (d: (e: React.PointerEvent) => void) => <SuggestionCard suggestion={suggestion} shared={shared} dragHandle={d} />,
    })),
  ];

  /**
   * Where each node sits. A place someone chose is kept; a node nobody placed
   * starts in its column (stories in two, your boxes and the AI's insights in
   * a third, suggestions under the stories). Then every overlap is settled by
   * measured height — lib/board-layout.ts — so cards never cover each other,
   * however much they have grown since they were put down.
   */
  const positions = useMemo(() => {
    const placed = new Map<string, { x: number; y: number; w: number }>();
    for (const item of live(board)) {
      if (item.kind === "pos") placed.set((item as PosItem).target, { x: item.x, y: item.y, w: item.w });
    }
    const counters = { card: 0, box: 0, insight: 0, suggest: 0 };
    const cardsBottom = Math.ceil(shared.cards.length / 2) * 200;
    const laid = layoutBoard(
      nodes
        .filter((node) => node.id !== drag?.id && !drag?.group.has(node.id))
        .map((node) => {
          const h = sizes[node.id]?.h ?? 160;
          const saved = placed.get(node.id);
          // A table's card is as wide as the table it holds.
          const table = node.kind === "box" ? shared.boxes.find((b) => b.id === node.id && b.table) : undefined;
          if (table) {
            const w = tableWidth(table) + 26;
            if (saved) return { id: node.id, placed: true, x: saved.x, y: saved.y, w, h };
          }
          const width = table ? tableWidth(table) + 26 : resize?.id === node.id ? resize.w : resize?.others.has(node.id) ? clampW(resize.others.get(node.id)!.w + resize.dw) : (saved?.w ?? (node.kind === "box" && shared.boxWidth ? shared.boxWidth : CARD_W));
          if (saved) return { id: node.id, placed: true, x: saved.x, y: saved.y, w: width, h };
          const n = counters[node.kind]++;
          const x =
            node.kind === "card" || node.kind === "suggest" ? (n % 2) * (CARD_W + GAP) : 2 * (CARD_W + GAP) + 40;
          const y = node.kind === "suggest" ? cardsBottom : 0;
          return { id: node.id, placed: false, x, y, w: width, h };
        }),
    );
    if (drag) {
      laid.set(drag.id, { x: drag.x, y: drag.y, w: placed.get(drag.id)?.w ?? CARD_W, h: sizes[drag.id]?.h ?? 160 });
      for (const [other, from] of drag.group) {
        laid.set(other, { x: from.x + drag.dx, y: from.y + drag.dy, w: from.w, h: sizes[other]?.h ?? 160 });
      }
    }
    return laid;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [board, shared.cards, shared.boxes, shared.insights, shared.suggestions, drag, sizes, resize]);

  /**
   * Widen or narrow a card by dragging its right edge. Saved as the card's
   * width with its place; anything it now overlaps moves down out of the way.
   */
  const startResize = (id: string) => (event: React.PointerEvent) => {
    if (event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    const start = positions.get(id);
    if (!start) return;
    const origin = { px: event.clientX, w: start.w };
    let w = start.w;
    // Resizing one of a selection resizes them all, by as much.
    const others = new Map<string, { x: number; y: number; w: number }>();
    if (selected.has(id)) {
      for (const other of selected) {
        const rect = positions.get(other);
        if (other !== id && rect) others.set(other, { x: rect.x, y: rect.y, w: rect.w });
      }
    }
    const move = (e: PointerEvent) => {
      w = clampW(origin.w + (e.clientX - origin.px) / view.zoom);
      setResize({ id, w, dw: w - origin.w, others });
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      setResize(null);
      if (w !== start.w) {
        const dw = w - origin.w;
        place([
          { id, x: start.x, y: start.y, w },
          ...[...others].map(([other, r]) => ({ id: other, x: r.x, y: r.y, w: clampW(r.w + dw) })),
        ]);
      }
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  // Heights are whatever the content makes them; the layout and the lines
  // both need to know them.
  useLayoutEffect(() => {
    const observer = new ResizeObserver(() => {
      const next: Record<string, { w: number; h: number }> = {};
      nodeEls.current.forEach((el, id) => (next[id] = { w: el.offsetWidth, h: el.offsetHeight }));
      setSizes((current) => (JSON.stringify(current) === JSON.stringify(next) ? current : next));
    });
    nodeEls.current.forEach((el) => observer.observe(el));
    return () => observer.disconnect();
  });

  const allUserLinks = live(board).filter((item): item is LinkItem => item.kind === "link");
  const isLabelItem = (id: string) => {
    const item = board?.[id];
    return Boolean(item && item.kind === "box" && item.label && !item.deleted);
  };
  const isNode = (id: string) => {
    const item = board?.[id];
    return Boolean(item && item.kind === "box" && item.label && item.labelShape === "node" && !item.deleted);
  };
  // Cards chained to one another under the same label are drawn as a chain, not a fan from the label.
  const repeated = chainedLabelLinks(allUserLinks, isLabelItem, (id) => positions.get(id));
  const userLinks = allUserLinks.filter((link) => !repeated.has(link.id));
  // The AI's links are shown for what the pointer is on, or all of them when
  // asked: drawn together they cross every card on the board.
  const aiLinks = shared.insights
    .flatMap((insight) => insight.refs.map((ref) => ({ id: `${insight.id}->${ref}`, from: insight.id, to: ref })))
    .filter((link) => showAiLinks || (focus !== null && (link.from === focus || link.to === focus)));

  const labelIds = new Set(shared.boxes.filter((b) => b.label).map((b) => b.id));
  /** The section label at a point on the board, if any. */
  /**
   * Moves and resizes, undoable with ⌘Z and ⌘⇧Z: each records where its
   * nodes were (or that they had never been placed) and where they went.
   */
  type Spot = { id: string; x: number; y: number; w: number };
  const writeSpots = (current: Board | undefined, spots: Spot[]) =>
    spots.reduce(
      (next, p) => put(next, { id: posId(p.id), kind: "pos", target: p.id, x: Math.round(p.x), y: Math.round(p.y), w: Math.round(p.w), at: Date.now() }),
      current ?? {},
    );
  const restore = (current: Board | undefined, before: (PosItem | string)[]) =>
    before.reduce(
      (next, b) => (typeof b === "string" ? remove(next, posId(b)) : put(next, { ...b, at: Date.now() })),
      current ?? {},
    );
  const beforeOf = (ids: string[]) =>
    ids.map((nid) => (live(board).find((i) => i.kind === "pos" && (i as PosItem).target === nid) as PosItem | undefined) ?? nid);
  const place = (spots: Spot[]) => {
    const before = beforeOf(spots.map((p) => p.id));
    shared.recordOp({ undo: (b) => restore(b, before), redo: (b) => writeSpots(b, spots) });
    onBoard((current) => writeSpots(current, spots));
  };

  const labelUnder = (x: number, y: number, except: string) => {
    for (const id of labelIds) {
      if (id === except) continue;
      const rect = positions.get(id);
      if (!rect) continue;
      const h = sizes[id]?.h ?? 56;
      if (x >= rect.x && x <= rect.x + rect.w && y >= rect.y - 20 && y <= rect.y + h + 20) return id;
    }
    // Dropped on a card already in a section — of any kind — joins that section.
    for (const item of live(board)) {
      if (item.kind !== "link") continue;
      const l = item as LinkItem;
      const [label, member] = labelIds.has(l.from) ? [l.from, l.to] : labelIds.has(l.to) ? [l.to, l.from] : [null, null];
      if (!label || !member || member === except || label === except) continue;
      const rect = positions.get(member);
      if (!rect) continue;
      const h = sizes[member]?.h ?? 160;
      if (x >= rect.x && x <= rect.x + rect.w && y >= rect.y && y <= rect.y + h) return label;
    }
    return null;
  };

  /**
   * The section label a dragged block would join: the one under the pointer
   * first — a wide block (a transcript, a table) held by its corner has its
   * middle far off to the side of the label it is being dropped on — then
   * the one under the block's own top edge.
   */
  const joinTarget = (id: string, at: { x: number; y: number; w: number }, pointer: { x: number; y: number }) => {
    if (labelIds.has(id)) return null;
    for (const label of labelIds) {
      if (label === id) continue;
      const r = nodeEls.current.get(label)?.getBoundingClientRect();
      if (r && pointer.x >= r.left && pointer.x <= r.right && pointer.y >= r.top - 16 && pointer.y <= r.bottom + 16) return label;
    }
    return labelUnder(at.x + at.w / 2, at.y + 20, id);
  };

  const startDrag = (id: string) => (event: React.PointerEvent) => {
    if (event.button !== 0) return;
    if (connecting !== false) {
      event.stopPropagation();
      // A block to join, nothing more: no caret, no selection, no link followed.
      event.preventDefault();
      if (connecting === null) setConnecting(id);
      else {
        if (connecting !== id) {
          const [from, to] = [connecting, id].sort();
          const linkId = `link:${from}|${to}`;
          // Connecting two already-connected cards disconnects them.
          onBoard((current) =>
            current?.[linkId] && !current[linkId].deleted
              ? remove(current, linkId)
              : put(current, { id: linkId, kind: "link", from, to, at: Date.now() }),
          );
        }
        setConnecting(false);
      }
      return;
    }
    event.stopPropagation();
    // Text fields are for typing, not for dragging.
    if ((event.target as HTMLElement).closest(".rich-body, input, textarea")) return;
    // A drag moves the card, never selects or drags the text on the page.
    event.preventDefault();
    window.getSelection()?.removeAllRanges();
    const start = positions.get(id);
    if (!start) return;
    const origin = { px: event.clientX, py: event.clientY, x: start.x, y: start.y, w: start.w };
    let last = { x: start.x, y: start.y };
    // What moves with it: the rest of a selection it is part of, and
    // everything connected to any section label that moves.
    const movers = new Set<string>(selected.has(id) ? selected : [id]);
    if (!selected.has(id) && selected.size) setSelected(new Set());
    const links = live(board).filter((i): i is LinkItem => i.kind === "link");
    for (const mover of [...movers]) {
      if (!labelIds.has(mover)) continue;
      for (const l of links) {
        if (l.from === mover) movers.add(l.to);
        if (l.to === mover) movers.add(l.from);
      }
    }
    movers.delete(id);
    const group = new Map<string, { x: number; y: number; w: number }>();
    for (const other of movers) {
      const rect = positions.get(other);
      if (rect) group.set(other, { x: rect.x, y: rect.y, w: rect.w });
    }
    // A press on a title is a click until it moves: only then is it a drag.
    let moved = false;
    const move = (e: PointerEvent) => {
      if (!moved && Math.hypot(e.clientX - origin.px, e.clientY - origin.py) < 5) return;
      moved = true;
      last = { x: origin.x + (e.clientX - origin.px) / view.zoom, y: origin.y + (e.clientY - origin.py) / view.zoom };
      // The label it would join lights up, so a drop onto a section is never a guess.
      const join = group.size === 0 ? joinTarget(id, { ...last, w: origin.w }, { x: e.clientX, y: e.clientY }) : null;
      setDrag({ id, ...last, dx: last.x - origin.x, dy: last.y - origin.y, group, join });
    };
    const up = (e?: PointerEvent) => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", up);
      setDrag(null);
      if (moved) {
        // The click that ends a drag must not open the story it dragged.
        const swallow = (e: MouseEvent) => {
          e.stopPropagation();
          e.preventDefault();
        };
        window.addEventListener("click", swallow, { capture: true, once: true });
        setTimeout(() => window.removeEventListener("click", swallow, { capture: true }), 0);
      }
      // A story let go over some writing is cited there, and stays where it was.
      const story = moved && e && group.size === 0 ? shared.cards.find((c) => c.id === id) : undefined;
      if (story && dropCiteAt(e!.clientX, e!.clientY, { link: story.link, title: story.title }, nodeEls.current.get(id))) return;
      // Anything dropped onto a section label joins that section: it lines up
      // under the label, below the stories already there, and is connected
      // to it.
      if (moved && group.size > 0) {
        // A group keeps its shape: each lands where it was, moved by as much.
        const dx = last.x - origin.x;
        const dy = last.y - origin.y;
        place([
          { id, x: last.x, y: last.y, w: origin.w },
          ...[...group].map(([other, from]) => ({ id: other, x: from.x + dx, y: from.y + dy, w: from.w })),
        ]);
        return;
      }
      const target = moved && e ? joinTarget(id, { ...last, w: origin.w }, { x: e.clientX, y: e.clientY }) : null;
      if (target) {
        const label = positions.get(target)!;
        const linked = new Set(
          live(board)
            .filter((i): i is LinkItem => i.kind === "link")
            .flatMap((l) => (l.from === target ? [l.to] : l.to === target ? [l.from] : [])),
        );
        let y = label.y + (sizes[target]?.h ?? 56) + 14;
        for (const [other, rect] of [...positions.entries()].sort((a, b) => a[1].y - b[1].y)) {
          if (other === id || !linked.has(other) || labelIds.has(other)) continue;
          if (Math.abs(rect.x - label.x) < 40) y = Math.max(y, rect.y + (sizes[other]?.h ?? 160) + 14);
        }
        const [from, to] = [target, id].sort();
        place([{ id, x: label.x, y, w: origin.w }]);
        onBoard((current) => put(current, { id: `link:${from}|${to}`, kind: "link", from, to, at: Date.now() }));
        return;
      }
      if (moved && (last.x !== start.x || last.y !== start.y)) {
        // Dropped on top of something: it lands just below instead.
        const others = [...positions.entries()].filter(([other]) => other !== id).map(([, rect]) => rect);
        const landed = settle({ x: last.x, y: last.y, w: origin.w, h: sizes[id]?.h ?? 160 }, others);
        place([{ id, x: landed.x, y: landed.y, w: origin.w }]);
      }
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", up);
  };

  const startPan = (event: React.PointerEvent) => {
    if (event.pointerType === "touch") return; // touch pans in the gesture handler
    if (event.target !== event.currentTarget) return;
    // A plain drag over empty board draws a box that selects what it touches;
    // Shift-drag or the middle button pans (as do the wheel and the trackpad).
    if (event.button === 0 && !event.shiftKey && !spaceHeld.current) {
      // Selecting cards, not the text across the page.
      event.preventDefault();
      window.getSelection()?.removeAllRanges();
      (document.activeElement as HTMLElement | null)?.blur?.();
      const a = toBoard(event.clientX, event.clientY);
      let box = { x0: a.x, y0: a.y, x1: a.x, y1: a.y };
      setSelected(new Set());
      const move = (e: PointerEvent) => {
        const b = toBoard(e.clientX, e.clientY);
        box = { ...box, x1: b.x, y1: b.y };
        setMarquee(box);
      };
      const up = () => {
        window.removeEventListener("pointermove", move);
        window.removeEventListener("pointerup", up);
        setMarquee(null);
        const [l, r] = [Math.min(box.x0, box.x1), Math.max(box.x0, box.x1)];
        const [t, btm] = [Math.min(box.y0, box.y1), Math.max(box.y0, box.y1)];
        if (r - l < 4 && btm - t < 4) return;
        const hit = new Set<string>();
        for (const [nid, rect] of positions) {
          const h = sizes[nid]?.h ?? 160;
          if (rect.x < r && rect.x + rect.w > l && rect.y < btm && rect.y + h > t) hit.add(nid);
        }
        setSelected(hit);
      };
      window.addEventListener("pointermove", move);
      window.addEventListener("pointerup", up);
      return;
    }
    if (event.button !== 0 && event.button !== 1) return;
    event.preventDefault();
    const origin = { px: event.clientX, py: event.clientY, x: view.x, y: view.y };
    const move = (e: PointerEvent) => setView((v) => ({ ...v, x: origin.x + e.clientX - origin.px, y: origin.y + e.clientY - origin.py }));
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  /**
   * ⌘C / ⌘X / ⌘V for blocks: the selection (or the block under the
   * pointer) with the links between them, pasted into this subject or any
   * other — where the pointer is, keeping their layout.
   */
  const pointer = useRef<{ x: number; y: number } | null>(null);
  useEffect(() => {
    const host = canvas.current;
    if (!host) return;
    const track = (e: PointerEvent) => (pointer.current = toBoard(e.clientX, e.clientY));
    host.addEventListener("pointermove", track);
    return () => host.removeEventListener("pointermove", track);
  });
  useEffect(() => {
    const typing = (e: Event) => {
      const t = e.target as HTMLElement | null;
      // Inside a card's own content — text, a table, a transcript, a picture — the clipboard is that content's.
      if (t?.closest?.("input, textarea, [contenteditable], .tbl, .sheet, .transcript, .subject-image, .drawing")) return true;
      const sel = window.getSelection();
      return Boolean(sel && !sel.isCollapsed && String(sel).trim());
    };
    const picked = () => {
      if (selected.size) return [...selected];
      return focus && positions.has(focus) ? [focus] : [];
    };
    const copy = (e: ClipboardEvent, cut: boolean) => {
      if (typing(e)) return;
      // Cutting takes cards away, so only cards deliberately selected — never the one the pointer happens to be over.
      const ids = cut ? [...selected] : picked();
      const blocks = blocksFor(board, shared.cards, ids, positions);
      if (!blocks) return;
      e.preventDefault();
      const json = JSON.stringify(blocks);
      blockClipboard = json;
      e.clipboardData?.setData(BLOCKS_TYPE, json);
      e.clipboardData?.setData("text/plain", blocks.text);
      if (cut) {
        shared.removeCards(ids);
        setSelected(new Set());
      }
    };
    const paste = (e: ClipboardEvent) => {
      if (typing(e)) return;
      // A picture on the clipboard lands where the pointer is, as its own box.
      const picture = clipboardPicture(e);
      if (picture) {
        e.preventDefault();
        const rect = canvas.current?.getBoundingClientRect();
        const at = pointer.current ?? toBoard((rect?.left ?? 0) + 80, (rect?.top ?? 0) + 80);
        void shrinkImage(picture).then((image) => shared.addBox(at, { image, caption: "" })).catch(() => {});
        return;
      }
      const json = e.clipboardData?.getData(BLOCKS_TYPE) || (e.clipboardData?.getData("text/plain") ? null : blockClipboard);
      const blocks = readBlocks(json ?? blockClipboard);
      if (!blocks) return;
      e.preventDefault();
      const rect = canvas.current?.getBoundingClientRect();
      const at = pointer.current ?? toBoard((rect?.left ?? 0) + 80, (rect?.top ?? 0) + 80);
      const fresh = new Set<string>();
      let recorded = false;
      onBoard((current) => {
        let next = current ?? {};
        const ids: string[] = [];
        const now = Date.now();
        for (const block of blocks.items) {
          let id: string;
          if (block.story) {
            id = canonicalUrl(block.story.link);
            next = addStory(next, block.story, now);
            if (block.note) next = put(next, { id: cardNoteId(id), kind: "cardnote", card: id, html: block.note, at: now });
          } else {
            id = newItemId("box");
            next = put(next, { ...block.box!, id, kind: "box", at: now });
          }
          ids.push(id);
          fresh.add(id);
          next = put(next, { id: posId(id), kind: "pos", target: id, x: Math.round(at.x + block.dx), y: Math.round(at.y + block.dy), w: block.w, at: now });
        }
        for (const [a, b] of blocks.links) {
          const [from, to] = [ids[a], ids[b]].sort();
          if (from && to && from !== to) next = put(next, { id: `link:${from}|${to}`, kind: "link", from, to, at: now });
        }
        // Undoable: what the paste added is taken away again.
        if (!recorded) {
          recorded = true;
          const added = live(next).filter((i) => fresh.has(i.id) || (i.kind === "pos" && fresh.has((i as PosItem).target))
            || (i.kind === "link" && (fresh.has((i as LinkItem).from) || fresh.has((i as LinkItem).to))));
          shared.recordOp({
            undo: (bd) => added.reduce((n, i) => remove(n, i.id), bd ?? {}),
            redo: (bd) => added.reduce((n, i) => put(n, { ...i, at: Date.now() }), bd ?? {}),
          });
        }
        return next;
      });
      setSelected(fresh);
    };
    const onCopy = (e: ClipboardEvent) => copy(e, false);
    const onCut = (e: ClipboardEvent) => copy(e, true);
    document.addEventListener("copy", onCopy);
    document.addEventListener("cut", onCut);
    document.addEventListener("paste", paste);
    return () => {
      document.removeEventListener("copy", onCopy);
      document.removeEventListener("cut", onCut);
      document.removeEventListener("paste", paste);
    };
  });

  /**
   * A story added from its link, where the board was right-clicked: the
   * link on the clipboard if there is one, otherwise a field to paste it in.
   * Its address names it at once; the page's own title follows if it can be read.
   */
  const [linkAsk, setLinkAsk] = useState<{ left: number; top: number; at: { x: number; y: number }; value: string; problem?: string } | null>(null);
  const addStoryAt = (link: string, at: { x: number; y: number }) => {
    const { id } = addStoryFromLink(link, onBoard, (next) => put(next, { id: posId(id), kind: "pos", target: id, x: at.x, y: at.y, w: CARD_W, at: Date.now() }));
  };
  const storyFromClipboard = async (spot: { left: number; top: number; at: { x: number; y: number } }) => {
    let text = "";
    try {
      text = (await navigator.clipboard.readText()).trim();
    } catch {
      /* the browser would not share the clipboard: ask instead */
    }
    const link = /^\S+$/.test(text) ? safeHref(text) : null;
    if (link) addStoryAt(link, spot.at);
    else setLinkAsk({ ...spot, value: "" });
  };

  // An outline entry picked from the tab list: bring it to the top middle of the board.
  useEffect(() => {
    const go = (event: Event) => {
      const entry = (event as CustomEvent<OutlineEntry>).detail;
      const rect = positions.get(entry.id);
      const box = canvas.current?.getBoundingClientRect();
      if (!rect || !box) return;
      const node = nodeEls.current.get(entry.id);
      let dy = 0;
      if (node && entry.n >= 0) {
        const h = node.querySelectorAll<HTMLElement>("h1, h2, h3, h4, h5, h6")[entry.n];
        if (h) dy = (h.getBoundingClientRect().top - node.getBoundingClientRect().top) / view.zoom;
      }
      setView((v) => ({ ...v, x: box.width / 2 - (rect.x + rect.w / 2) * v.zoom, y: 60 - (rect.y + dy) * v.zoom }));
      if (node) flashEl(node);
    };
    window.addEventListener("super-reader:goto", go);
    return () => window.removeEventListener("super-reader:goto", go);
  });

  // A match from Find: centre it, zoomed in far enough to read.
  useEffect(() => {
    const go = (event: Event) => {
      const { rect, node } = (event as CustomEvent<FindTarget>).detail;
      const box = canvas.current?.getBoundingClientRect();
      if (!box) return;
      setView((v) => {
        // The match's place on the board, from where it is on screen now.
        const bx = (rect.left + rect.width / 2 - box.left - v.x) / v.zoom;
        const by = (rect.top + rect.height / 2 - box.top - v.y) / v.zoom;
        const zoom = v.zoom < 0.8 ? 1 : v.zoom;
        return { zoom, x: box.width / 2 - bx * zoom, y: box.height * 0.42 - by * zoom };
      });
      if (node) flashEl(node);
    };
    window.addEventListener("super-reader:find-goto", go);
    return () => window.removeEventListener("super-reader:find-goto", go);
  });

  // Space held down turns a drag over empty board back into panning.
  const spaceHeld = useRef(false);
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.code === "Space" && !(e.target as HTMLElement).closest?.("input, textarea, [contenteditable]")) spaceHeld.current = true;
      if (e.key === "Escape") setSelected(new Set());
    };
    const up = (e: KeyboardEvent) => {
      if (e.code === "Space") spaceHeld.current = false;
    };
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
    };
  }, []);

  // Phones keep the old floor: drawing the whole board at a tenth is heavy for them.
  const MIN_ZOOM = lowPower ? 0.15 : 0.1;
  const MAX_ZOOM = 2;
  /** Zoom by a factor, keeping the board point under (x, y) where it is. */
  const zoomAround = (factor: number, x?: number, y?: number) =>
    setView((v) => {
      const zoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, v.zoom * factor));
      if (x === undefined || y === undefined) return { ...v, zoom };
      const k = zoom / v.zoom;
      return { zoom, x: x - (x - v.x) * k, y: y - (y - v.y) * k };
    });
  const zoomBy = (factor: number) => {
    const rect = canvas.current?.getBoundingClientRect();
    zoomAround(factor, rect ? rect.width / 2 : undefined, rect ? rect.height / 2 : undefined);
  };

  /*
   * Wheel and pinch. Zoom follows how far the wheel actually moved rather
   * than stepping per event: a trackpad pinch sends dozens of small events a
   * second, and a fixed step per event raced to the limit. Registered by hand
   * because React's wheel listener is passive, and ⌘/Ctrl-scroll or a pinch
   * would otherwise zoom the whole page as well as the board.
   */
  const viewRef = useRef(view);
  viewRef.current = view;
  useEffect(() => {
    const el = canvas.current;
    if (!el) return;
    const onWheel = (event: WheelEvent) => {
      // Something with its own scroll — a transcript — scrolls itself.
      const own = !event.ctrlKey && !event.metaKey && Math.abs(event.deltaY) >= Math.abs(event.deltaX)
        ? scrollsItself(event.target as Element | null, el, event.deltaY) : null;
      if (own === "scroll") return;
      // At its end, the box just stops: the board stays where it is.
      if (own === "end") { event.preventDefault(); return; }
      event.preventDefault();
      const delta = event.deltaMode === 1 ? event.deltaY * 16 : event.deltaY;
      if (event.ctrlKey || event.metaKey) {
        const rect = el.getBoundingClientRect();
        // About a third of a percent per pixel scrolled — a full trackpad
        // pinch is a gentle change — and one mouse-wheel notch at most ~15%.
        const step = Math.max(-0.15, Math.min(0.15, -delta * 0.0035));
        zoomAround(Math.exp(step), event.clientX - rect.left, event.clientY - rect.top);
      } else {
        const dx = event.deltaMode === 1 ? event.deltaX * 16 : event.deltaX;
        setView((v) => ({ ...v, x: v.x - dx, y: v.y - delta }));
      }
    };
    el.addEventListener("wheel", onWheel, { passive: false });

    /*
     * Touch, handled in one place. One finger on the board pans it; two
     * fingers zoom and pan together, keeping the point of the board that was
     * between them pinned under them — measured from where the gesture
     * started, never accumulated step by step, so it cannot drift or jump.
     * (The mouse's pan is in startPan; it stands aside for touch.)
     */
    type Gesture =
      | { kind: "pan"; startX: number; startY: number; view: typeof viewRef.current }
      | { kind: "pinch"; distance: number; midX: number; midY: number; view: typeof viewRef.current };
    const touches = new Map<number, { x: number; y: number }>();
    let gesture: Gesture | null = null;
    const isBoard = (target: EventTarget | null) =>
      target === el || (target instanceof Element && (target.classList.contains("wb-layer") || !!target.closest(".wb-lines")));
    const startPinch = () => {
      const [p, q] = [...touches.values()];
      gesture = {
        kind: "pinch",
        distance: Math.hypot(p.x - q.x, p.y - q.y) || 1,
        midX: (p.x + q.x) / 2,
        midY: (p.y + q.y) / 2,
        view: viewRef.current,
      };
    };
    /**
     * Press and hold — the touch screen's right-click. Held still on empty
     * board it opens the add menu there; on a card, that card's menu. Any
     * movement, a second finger, or lifting first is an ordinary gesture.
     */
    let hold: { timer: ReturnType<typeof setTimeout>; x: number; y: number } | null = null;
    const cancelHold = () => {
      if (hold) clearTimeout(hold.timer);
      hold = null;
    };
    const startHold = (event: PointerEvent) => {
      cancelHold();
      const target = event.target as Element | null;
      if (target?.closest?.(".rich-body, input, textarea, button, select, .drawing-canvas")) return;
      const x = event.clientX;
      const y = event.clientY;
      hold = {
        x, y,
        timer: setTimeout(() => {
          hold = null;
          gesture = null;
          const rect = el.getBoundingClientRect();
          const v = viewRef.current;
          const at = { x: Math.round((x - rect.left - v.x) / v.zoom), y: Math.round((y - rect.top - v.y) / v.zoom) };
          const node = [...nodeEls.current.entries()].find(([, n]) => n.contains(target));
          if (node) setNodeMenu({ id: node[0], left: x - rect.left, top: y - rect.top });
          else if (isBoard(target)) setMenu({ left: x - rect.left, top: y - rect.top, at });
          navigator.vibrate?.(10);
          // The lift that follows must not count as a tap on what is under it.
          const swallow = (e: Event) => { e.stopPropagation(); e.preventDefault(); };
          window.addEventListener("click", swallow, { capture: true, once: true });
          setTimeout(() => window.removeEventListener("click", swallow, { capture: true }), 600);
        }, 550),
      };
    };
    const onDown = (event: PointerEvent) => {
      if (event.pointerType !== "touch") return;
      touches.set(event.pointerId, { x: event.clientX, y: event.clientY });
      if (touches.size === 1) startHold(event);
      else cancelHold();
      if (touches.size === 2) startPinch();
      else if (touches.size === 1 && isBoard(event.target)) {
        gesture = { kind: "pan", startX: event.clientX, startY: event.clientY, view: viewRef.current };
      }
    };
    const onMove = (event: PointerEvent) => {
      if (!touches.has(event.pointerId)) return;
      if (hold && Math.hypot(event.clientX - hold.x, event.clientY - hold.y) > 8) cancelHold();
      touches.set(event.pointerId, { x: event.clientX, y: event.clientY });
      if (!gesture) return;
      if (gesture.kind === "pan") {
        const g = gesture;
        setView({ ...g.view, x: g.view.x + event.clientX - g.startX, y: g.view.y + event.clientY - g.startY });
        return;
      }
      if (touches.size !== 2) return;
      const [p, q] = [...touches.values()];
      const rect = el.getBoundingClientRect();
      const g = gesture;
      const zoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, g.view.zoom * (Math.hypot(p.x - q.x, p.y - q.y) / g.distance)));
      // The board point that was under the fingers' midpoint at the start…
      const boardX = (g.midX - rect.left - g.view.x) / g.view.zoom;
      const boardY = (g.midY - rect.top - g.view.y) / g.view.zoom;
      // …stays under wherever their midpoint is now.
      const midX = (p.x + q.x) / 2 - rect.left;
      const midY = (p.y + q.y) / 2 - rect.top;
      setView({ zoom, x: midX - boardX * zoom, y: midY - boardY * zoom });
    };
    const onUp = (event: PointerEvent) => {
      cancelHold();
      if (!touches.delete(event.pointerId)) return;
      if (touches.size === 1 && gesture?.kind === "pinch") {
        // Lifting one finger of a pinch carries on as a pan from here, with
        // no jump to where that finger first went down.
        const [p] = [...touches.values()];
        gesture = { kind: "pan", startX: p.x, startY: p.y, view: viewRef.current };
      } else if (touches.size === 0) {
        gesture = null;
      }
    };
    // Safari's own page zoom must not join in.
    const stopGesture = (event: Event) => event.preventDefault();
    el.addEventListener("pointerdown", onDown, true);
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
    el.addEventListener("gesturestart", stopGesture);
    el.addEventListener("gesturechange", stopGesture);
    return () => {
      el.removeEventListener("wheel", onWheel);
      el.removeEventListener("pointerdown", onDown, true);
      el.removeEventListener("gesturestart", stopGesture);
      el.removeEventListener("gesturechange", stopGesture);
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const toBoard = (clientX: number, clientY: number) => {
    const rect = canvas.current?.getBoundingClientRect();
    return {
      x: Math.round((clientX - (rect?.left ?? 0) - view.x) / view.zoom),
      y: Math.round((clientY - (rect?.top ?? 0) - view.y) / view.zoom),
    };
  };

  /**
   * Zoomed out past reading: each section label and everything connected to
   * it becomes a soft patch of the label's colour in the shape of its blocks,
   * with only the header written over it.
   */
  // A gradual change, not a switch: from FAR_START down to FAR_END the
  // colour comes in first, then a light blur settles it. Above FAR_START
  // everything stays sharp, however small, while it can still be read.
  const FAR_START = 0.28;
  const FAR_END = 0.14;
  // Not on a phone or tablet at all: even without blur, the zoomed-out view
  // still closed the subject on an iPhone (3 Oct 2026). There the board
  // stays plain at every zoom.
  const farT = lowPower ? 0 : Math.min(1, Math.max(0, (FAR_START - view.zoom) / (FAR_START - FAR_END)));
  const tint = Math.min(1, farT / 0.5);
  const haze = Math.min(1, Math.max(0, (farT - 0.45) / 0.55));
  /**
   * Blur in screen pixels at full haze: enough to settle the colour, not to
   * erase the shapes. None on a phone or tablet: blur filters over many large
   * cards ran Safari out of memory and the page was killed (3 Oct 2026), so
   * there the cards fade instead.
   */
  const blurPx = lowPower ? 0 : 2.5 * haze;
  const far = farT > 0;
  const sections = far
    ? shared.boxes
        .filter((b) => b.label && positions.has(b.id))
        .map((label) => {
          const members = [label.id];
          for (const item of live(board)) {
            if (item.kind !== "link") continue;
            const l = item as LinkItem;
            if (l.from === label.id && positions.has(l.to)) members.push(l.to);
            if (l.to === label.id && positions.has(l.from)) members.push(l.from);
          }
          const rects = members.map((id) => ({ id, ...positions.get(id)!, h: sizes[id]?.h ?? 160 }));
          // A node is its own coloured circle: no square of tint behind it, only behind what it holds.
          const tinted = label.labelShape === "node" ? rects.filter((r) => r.id !== label.id) : rects;
          const x0 = Math.min(...rects.map((r) => r.x));
          const y0 = Math.min(...rects.map((r) => r.y));
          const x1 = Math.max(...rects.map((r) => r.x + r.w));
          const y1 = Math.max(...rects.map((r) => r.y + r.h));
          const node = label.labelShape === "node" ? rects.find((r) => r.id === label.id) : undefined;
          return { id: label.id, text: textOf(label.html).trim() || (node ? "Node" : "Section"), color: labelColorOf(label), rects, tinted, node, box: { x0, y0, x1, y1 } };
        })
    : [];
  const grouped = new Set(sections.flatMap((sec) => sec.rects.map((r) => r.id)));
  // Headers that would collide are nudged apart, top to bottom, after measuring.
  const titleEls = useRef(new Map<string, HTMLDivElement>());
  useLayoutEffect(() => {
    const els = [...titleEls.current.values()];
    for (const el of els) el.style.marginTop = "0px";
    if (els.length < 2) return;
    const placed: DOMRect[] = [];
    for (const el of els.sort((a, b) => a.getBoundingClientRect().top - b.getBoundingClientRect().top)) {
      let r = el.getBoundingClientRect();
      for (let guard = 0; guard < 20; guard++) {
        const hit = placed.find((p) => r.left < p.right + 6 && r.right > p.left - 6 && r.top < p.bottom + 4 && r.bottom > p.top - 4);
        if (!hit) break;
        const shift = hit.bottom + 6 - r.top;
        el.style.marginTop = `${parseFloat(el.style.marginTop || "0") + shift / view.zoom}px`;
        r = el.getBoundingClientRect();
      }
      placed.push(r);
    }
  });

  const line = (key: string, from: string, to: string, className: string, onRemove?: () => void) => {
    const a = positions.get(from);
    const b = positions.get(to);
    if (!a || !b) return null;
    const { d, mid } = edgePath(a, b, { a: isNode(from), b: isNode(to) });
    return (
      <g key={key} className={className}>
        {/* A wide invisible stroke to point at: hovering the line shows its ×. */}
        {onRemove && <path d={d} className="wb-line-hit" />}
        <path d={d} />
        {onRemove && (
          <g className="wb-unlink" transform={`translate(${mid.x} ${mid.y})`} onClick={onRemove}>
            <circle r={9} />
            <text textAnchor="middle" dy="4">×</text>
            <title>Remove this connection</title>
          </g>
        )}
      </g>
    );
  };

  return (
    <div className="wb">
      <div className="wb-tools">
        <button className={`btn ghost small${connecting !== false ? " on" : ""}`}
          onClick={() => setConnecting((c) => (c === false ? null : false))}>
          {connecting === false ? "Connect" : connecting === null ? "Pick the first…" : "Now the second… (or a connected one to disconnect)"}
        </button>
        <button className="btn ghost small" onClick={() => zoomBy(1 / 1.1)} aria-label="Zoom out">−</button>
        <button className="btn ghost small" onClick={() => zoomBy(1.1)} aria-label="Zoom in">+</button>
        <MoreMenu>
          {(close) => (
            <>
              <button role="menuitem" onClick={() => { close(); setView(startView()); }}>Reset view</button>
              <button role="menuitemcheckbox" aria-checked={showAiLinks} title="Show every line from the AI's insights to the stories they draw on"
                onClick={() => setShowAiLinks((v) => !v)}>
                AI links{showAiLinks && <span className="more-check">✓</span>}
              </button>
              <button role="menuitem" title="Put everything back in tidy columns"
                onClick={() => {
                  close();
                  onBoard((current) => {
                    let next = current ?? {};
                    for (const item of live(next)) if (item.kind === "pos") next = remove(next, item.id);
                    return next;
                  });
                }}>
                Tidy up
              </button>
            </>
          )}
        </MoreMenu>
        {!boardUsed && (
          <span className="wb-hint">Drag by the title · drag empty space to select several · Shift-drag to pan · double-click for a text box</span>
        )}
      </div>
      {tagging && tagging.ids.length > 0 && <TagPicker ids={tagging.ids} tags={shared.tags} at={tagging.at} onClose={() => setTagging(null)} />}
      {nodeMenu && (() => {
        // The block right-clicked, or the whole selection if it is part of one.
        const ids = selected.has(nodeMenu.id) ? [...selected] : [nodeMenu.id];
        const linked = live(board).filter(
          (i): i is LinkItem => i.kind === "link" && (ids.includes((i as LinkItem).from) || ids.includes((i as LinkItem).to)),
        );
        return (
          <div className="wb-menu" role="menu" style={{ left: nodeMenu.left, top: nodeMenu.top }} onPointerDown={(e) => e.stopPropagation()}>
            <button role="menuitem"
              onClick={(e) => {
                const r = e.currentTarget.getBoundingClientRect();
                setTagging({ ids: ids.filter((id) => positions.has(id) && nodes.some((n) => n.id === id && (n.kind === "card" || n.kind === "box"))), at: { left: r.left, top: r.top } });
                setNodeMenu(null);
              }}>
              <span className="wb-menu-icon">👤</span>
              {ids.length > 1 ? `Tag a contact on ${ids.length} blocks…` : "Tag a contact…"}
            </button>
            <button role="menuitem" disabled={linked.length === 0}
              onClick={() => {
                onBoard((current) => linked.reduce((next, l) => remove(next, l.id), current ?? {}));
                setNodeMenu(null);
              }}>
              <span className="wb-menu-icon">⤫</span>
              {linked.length === 0 ? "No connections" : `Unlink (${linked.length} connection${linked.length === 1 ? "" : "s"})`}
            </button>
          </div>
        );
      })()}
      {menu && (
        <div className="wb-menu" role="menu" style={{ left: menu.left, top: menu.top }} onPointerDown={(e) => e.stopPropagation()}>
          <button role="menuitem" onClick={() => { void storyFromClipboard(menu); setMenu(null); }}>
            <span className="wb-menu-icon">🔗</span> Story from link
          </button>
          <button role="menuitem" onClick={() => { shared.addBox(menu.at, { label: true, html: "" }); setMenu(null); }}>
            <span className="wb-menu-icon">H</span> Section label
          </button>
          <button role="menuitem" title="A section as a circle: connect things to it from every side"
            onClick={() => { shared.addBox({ x: menu.at.x - NODE_SIZE / 2, y: menu.at.y - NODE_SIZE / 2 }, { label: true, labelShape: "node", html: "" }); setMenu(null); }}>
            <span className="wb-menu-icon">◯</span> Node
          </button>
          <button role="menuitem" onClick={() => { shared.addBox(menu.at); setMenu(null); }}>
            <span className="wb-menu-icon">¶</span> Text box
          </button>
          <button role="menuitem" onClick={() => { shared.addBox(menu.at, { drawing: [], height: DRAWING_HEIGHT }); setMenu(null); }}>
            <span className="wb-menu-icon">✎</span> Drawing
          </button>
          <button role="menuitem" onClick={() => { shared.pickImage(menu.at); setMenu(null); }}>
            <span className="wb-menu-icon">▣</span> Image…
          </button>
          <button role="menuitem" onClick={() => { shared.addBox(menu.at, { table: NEW_TABLE(), tableMode: "doc" }); setMenu(null); }}>
            <span className="wb-menu-icon">▦</span> Table
          </button>
          <button role="menuitem" onClick={() => { shared.addBox(menu.at, { transcript: { title: "", turns: [] } }); setMenu(null); }}>
            <span className="wb-menu-icon">❝</span> Transcript
          </button>
        </div>
      )}
      {linkAsk && (
        <form
          className="wb-link-ask"
          style={{ left: linkAsk.left, top: linkAsk.top }}
          onPointerDown={(e) => e.stopPropagation()}
          onSubmit={(e) => {
            e.preventDefault();
            const link = safeHref(linkAsk.value.trim());
            if (!link) return setLinkAsk({ ...linkAsk, problem: "That isn't a web link." });
            addStoryAt(link, linkAsk.at);
            setLinkAsk(null);
          }}
        >
          <input autoFocus className="input" placeholder="Paste a story's link" value={linkAsk.value}
            onChange={(e) => setLinkAsk({ ...linkAsk, value: e.target.value, problem: undefined })}
            onKeyDown={(e) => e.key === "Escape" && setLinkAsk(null)}
            onBlur={() => !linkAsk.value.trim() && setLinkAsk(null)} />
          <button className="btn small">Add</button>
          {linkAsk.problem && <span className="signin-error">{linkAsk.problem}</span>}
        </form>
      )}
      {mapShown && (() => {
        // Everything on the board, and the part on screen, at one scale.
        const host = canvas.current?.getBoundingClientRect();
        if (!host) return null;
        const seen = { x: -view.x / view.zoom, y: -view.y / view.zoom, w: host.width / view.zoom, h: host.height / view.zoom };
        const rects = [...positions.entries()].map(([id, r]) => ({ id, x: r.x, y: r.y, w: r.w, h: sizes[id]?.h ?? 160 }));
        const all = [...rects, seen];
        const minX = Math.min(...all.map((r) => r.x)) - 40;
        const minY = Math.min(...all.map((r) => r.y)) - 40;
        const maxX = Math.max(...all.map((r) => r.x + r.w)) + 40;
        const maxY = Math.max(...all.map((r) => r.y + r.h)) + 40;
        const W = 200;
        const H = 140;
        const k = Math.min(W / (maxX - minX), H / (maxY - minY));
        const ox = (W - (maxX - minX) * k) / 2;
        const oy = (H - (maxY - minY) * k) / 2;
        const sx = (x: number) => ox + (x - minX) * k;
        const sy = (y: number) => oy + (y - minY) * k;
        return (
          <svg className="wb-minimap" width={W} height={H} viewBox={`0 0 ${W} ${H}`} aria-label="Map of the whole board"
            onPointerDown={(e) => {
              // A click on the map centres the view there.
              e.stopPropagation();
              const r = e.currentTarget.getBoundingClientRect();
              const bx = minX + (e.clientX - r.left - ox) / k;
              const by = minY + (e.clientY - r.top - oy) / k;
              setView((v) => ({ ...v, x: host.width / 2 - bx * v.zoom, y: host.height / 2 - by * v.zoom }));
            }}>
            {rects.map((r) =>
              isNode(r.id) ? (
                // A node is a dot in its colour, on the map as on the board.
                <circle key={r.id} className="mm-node-circle" cx={sx(r.x + r.w / 2)} cy={sy(r.y + r.h / 2)}
                  r={Math.max(2, (Math.min(r.w, r.h) * k) / 2)} style={{ fill: labelColorOf(board![r.id] as BoxItem) }} />
              ) : (
                <rect key={r.id} className={labelIds.has(r.id) ? "mm-label" : "mm-node"} x={sx(r.x)} y={sy(r.y)}
                  width={Math.max(2, r.w * k)} height={Math.max(2, r.h * k)} rx={1.5} />
              ),
            )}
            <rect className="mm-view" x={sx(seen.x)} y={sy(seen.y)} width={seen.w * k} height={seen.h * k} rx={2} />
          </svg>
        );
      })()}
      <div
        ref={canvas}
        className={`wb-canvas${connecting !== false ? " connecting" : ""}${marquee ? " selecting" : ""}${shared.tags.lit ? " tag-focus" : ""}`}
        onPointerDownCapture={markBoardUsed}
        onPointerDown={startPan}
        onDoubleClick={(event) => {
          if (event.target === event.currentTarget) shared.addBox(toBoard(event.clientX, event.clientY));
        }}
        onContextMenu={(event) => {
          if (event.target !== event.currentTarget) return;
          event.preventDefault();
          markBoardUsed();
          const box = event.currentTarget.getBoundingClientRect();
          setMenu({ left: event.clientX - box.left, top: event.clientY - box.top, at: toBoard(event.clientX, event.clientY) });
        }}
      >
        <div className="wb-layer" style={{ transform: `translate(${view.x}px, ${view.y}px) scale(${view.zoom})` }}>
          <svg className="wb-lines" width={1} height={1} style={haze > 0 && !lowPower ? { filter: `blur(${blurPx / view.zoom}px)`, transition: "filter 0.35s ease" } : undefined}>
            {aiLinks.map((link) => line(link.id, link.from, link.to, "wb-line ai"))}
            {userLinks.map((link) =>
              line(link.id, link.from, link.to, "wb-line", () => onBoard((current) => remove(current, link.id))),
            )}
          </svg>
          {marquee && (
            <div
              className="wb-marquee"
              style={{
                left: Math.min(marquee.x0, marquee.x1),
                top: Math.min(marquee.y0, marquee.y1),
                width: Math.abs(marquee.x1 - marquee.x0),
                height: Math.abs(marquee.y1 - marquee.y0),
              }}
            />
          )}
          {sections.map((sec) => (
            <div key={`far-${sec.id}`} className="wb-far" aria-hidden="true">
              {sec.tinted.map((r) => (
                <div key={r.id} className="wb-far-blob"
                  style={{ left: r.x, top: r.y, width: r.w, height: r.h, background: sec.color, opacity: 0.5 * tint, ...(blurPx > 0 ? { filter: `blur(${(blurPx * 2) / view.zoom}px)` } : {}) }} />
              ))}
            </div>
          ))}
          {nodes.map((node) => {
            const pos = positions.get(node.id)!;
            return (
              <div
                key={node.id}
                ref={(el) => {
                  if (el) nodeEls.current.set(node.id, el);
                  else nodeEls.current.delete(node.id);
                }}
                className={`wb-node kind-${node.kind}${connecting === node.id ? " picked" : ""}${drag?.id === node.id || drag?.group.has(node.id) ? " dragging" : ""}${drag?.join === node.id ? " join-target" : ""}${selected.has(node.id) ? " selected" : ""}${shared.tags.lit?.has(node.id) ? " tag-lit" : ""}`}
                style={{
                  left: pos.x, top: pos.y, width: pos.w,
                  // Every card blurs as the board zooms out; a section's cards also fade under its colour.
                  ...(haze > 0 && !isNode(node.id)
                    ? lowPower
                      ? { opacity: grouped.has(node.id) ? 1 - 0.55 * haze : 1 - 0.35 * haze }
                      : { filter: `blur(${blurPx / view.zoom}px)`, opacity: grouped.has(node.id) ? 1 - 0.35 * haze : 1 }
                    : {}),
                }}
                onContextMenu={(event) => {
                  // Typing keeps the browser's own menu (spelling, copy and paste).
                  if ((event.target as HTMLElement).closest(".rich-body, input, textarea")) return;
                  event.preventDefault();
                  event.stopPropagation();
                  const box = canvas.current!.getBoundingClientRect();
                  setNodeMenu({ id: node.id, left: event.clientX - box.left, top: event.clientY - box.top });
                }}
                onPointerEnter={() => setFocus(node.id)}
                onPointerLeave={() => setFocus((current) => (current === node.id ? null : current))}
                onPointerDownCapture={(event) => {
                  // In connect mode, any click on a node picks it.
                  if (connecting !== false) startDrag(node.id)(event);
                }}
              >
                {node.render(startDrag(node.id))}
                <div
                  className="wb-resize"
                  role="separator"
                  aria-orientation="vertical"
                  aria-label="Drag to make this card wider or narrower"
                  title="Drag to resize"
                  onPointerDown={startResize(node.id)}
                />
              </div>
            );
          })}
          {/* Section headers over everything, never blurred, all the same size on screen. */}
          {sections.map((sec) => {
            // A node stays a circle zoomed out: at least a readable size on screen, its name inside.
            if (sec.node) {
              const d = Math.max(sec.node.w, 56 / view.zoom);
              return (
                <div key={`node-${sec.id}`} className="wb-far-node" aria-hidden="true"
                  style={{
                    left: sec.node.x + sec.node.w / 2, top: sec.node.y + sec.node.w / 2, width: d, height: d,
                    background: sec.color, fontSize: Math.min(d * 0.21, 15 / view.zoom),
                  }}>
                  {sec.text}
                </div>
              );
            }
            const cx = (sec.box.x0 + sec.box.x1) / 2;
            const cy = (sec.box.y0 + sec.box.y1) / 2;
            const fit = ((sec.box.x1 - sec.box.x0) * view.zoom * 0.9) / Math.max(4, Math.max(...sec.text.split(/\s+/).map((w) => w.length)) * 0.6);
            const px = Math.min(40, Math.max(22, fit));
            return (
              <div key={`title-${sec.id}`} className="wb-far-title" aria-hidden="true"
                style={{
                  left: cx, top: cy, opacity: Math.min(1, haze * 1.4),
                  fontSize: px / view.zoom,
                  // Wraps to about its section's width, never narrower than a few words.
                  maxWidth: Math.max(sec.box.x1 - sec.box.x0, 160 / view.zoom),
                }}
                ref={(el) => {
                  if (el) titleEls.current.set(sec.id, el);
                  else titleEls.current.delete(sec.id);
                }}>
                {sec.text}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------------- */
/* Tabs                                                                    */
/* ---------------------------------------------------------------------- */

/**
 * The subject's tabs, like a Google Docs document's: click to switch,
 * double-click to rename, + to add one, × to close one (its contents move to
 * the first tab).
 */
function TabBar({
  tabs,
  current,
  onSwitch,
  onAdd,
  onRename,
  onDelete,
  contacts,
  outline = [],
  onGo,
}: {
  outline?: OutlineEntry[];
  onGo?: (entry: OutlineEntry) => void;
  tabs: Tab[];
  current: string;
  onSwitch: (tab: string) => void;
  onAdd: (name: string) => void;
  onRename: (tab: string, name: string) => void;
  onDelete: (tab: string) => void;
  contacts?: { count: number; open: boolean; onOpen: () => void };
}) {
  const [editing, setEditing] = useState<{ id: string | null; draft: string } | null>(null);
  const [confirming, setConfirming] = useState<string | null>(null);
  /** The open tab's headings, shown by clicking its name. */
  const [outlineOpen, setOutlineOpen] = useState(false);

  const finish = () => {
    if (!editing) return;
    const name = editing.draft.trim();
    if (name) {
      if (editing.id === null) onAdd(name);
      else onRename(editing.id, name);
    }
    setEditing(null);
  };

  const field = (
    <input
      className="input subject-tab-input"
      autoFocus
      aria-label="Tab name"
      value={editing?.draft ?? ""}
      onFocus={(event) => event.currentTarget.select()}
      onChange={(event) => setEditing((e) => (e ? { ...e, draft: event.target.value } : e))}
      onKeyDown={(event) => {
        if (event.key === "Enter") finish();
        if (event.key === "Escape") setEditing(null);
      }}
      onBlur={finish}
    />
  );

  return (
    <div className="subject-tabs" role="tablist" aria-label="Tabs">
      {tabs.map((tab) =>
        editing?.id === tab.id ? (
          <span key={tab.id} className="subject-tab editing">{field}</span>
        ) : confirming === tab.id ? (
          <span key={tab.id} className="subject-tab confirming">
            Close “{tab.name}”? Its stories move to “{tabs[0].name}”.
            <button className="link-btn danger" onClick={() => { setConfirming(null); onDelete(tab.id); }}>Close</button>
            <button className="link-btn" onClick={() => setConfirming(null)}>Keep</button>
          </span>
        ) : (
          <span key={tab.id} className={`subject-tab${tab.id === current ? " on" : ""}`}>
            <button
              role="tab"
              aria-selected={tab.id === current}
              className="subject-tab-name"
              title="Double-click to rename"
              aria-expanded={onGo && tab.id === current ? outlineOpen : undefined}
              onClick={() => {
                if (tab.id === current) setOutlineOpen((o) => !o);
                else {
                  onSwitch(tab.id);
                  setOutlineOpen(true);
                }
              }}
              onDoubleClick={() => setEditing({ id: tab.id, draft: tab.name })}
            >
              {tab.name}
            </button>
            {tab.id === current && (
              <button className="subject-tab-close subject-tab-rename" aria-label={`Rename tab ${tab.name}`} title="Rename"
                onClick={() => setEditing({ id: tab.id, draft: tab.name })}>
                ✎
              </button>
            )}
            {tab.id !== MAIN_TAB && tab.id === current && (
              <button className="subject-tab-close" aria-label={`Close tab ${tab.name}`} onClick={() => setConfirming(tab.id)}>
                ×
              </button>
            )}
            {onGo && tab.id === current && outlineOpen && (
              <ul className="tab-outline">
                {outline.length === 0 ? (
                  <li className="tab-outline-empty">No headings yet — add a section label, or an H heading in a text box.</li>
                ) : (
                  outline.map((entry, i) => (
                    <li key={`${entry.id}-${entry.n}-${i}`}>
                      <button className={`tab-outline-item level-${entry.level}`} onClick={() => onGo(entry)} title={entry.text}>
                        {entry.text}
                      </button>
                    </li>
                  ))
                )}
              </ul>
            )}
          </span>
        ),
      )}
      {editing?.id === null ? (
        <span className="subject-tab editing">{field}</span>
      ) : (
        <button className="subject-tab-add" aria-label="Add a tab" title="Add a tab" onClick={() => setEditing({ id: null, draft: "" })}>
          +
        </button>
      )}
      {contacts && (
        <button
          role="tab"
          aria-selected={contacts.open}
          className={`subject-tab-contacts${contacts.open ? " on" : ""}`}
          onClick={contacts.onOpen}
          title="People to interview for this subject"
        >
          Contacts{contacts.count > 0 && <span className="count">{contacts.count}</span>}
        </button>
      )}
    </div>
  );
}

/** The ⋯ menu that holds everything the header does not need to show. */
function MoreMenu({ children }: { children: (close: () => void) => React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!open) return;
    const away = (event: PointerEvent) => {
      if (!ref.current?.contains(event.target as globalThis.Node)) setOpen(false);
    };
    const esc = (event: KeyboardEvent) => event.key === "Escape" && setOpen(false);
    document.addEventListener("pointerdown", away);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("pointerdown", away);
      document.removeEventListener("keydown", esc);
    };
  }, [open]);
  return (
    <div className="more-wrap" ref={ref}>
      <button className="btn ghost small more-btn" aria-label="More" aria-haspopup="menu" aria-expanded={open}
        onClick={() => setOpen((o) => !o)}>
        ⋯
      </button>
      {open && (
        <div className="more-menu" role="menu">
          {children(() => setOpen(false))}
        </div>
      )}
    </div>
  );
}

/** How many ancestors of an element match a selector, itself excluded. */
function countAncestors(el: Element, selector: string) {
  let count = 0;
  for (let node = el.parentElement; node; node = node.parentElement) if (node.matches(selector)) count += 1;
  return count;
}
