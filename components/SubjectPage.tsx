"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Icon } from "./icons";
import RichText from "./RichText";
import SubjectHistory from "./SubjectHistory";
import type { Writing } from "./useAccount";
import type { Note, NoteEntry } from "@/lib/notes";
import {
  applySynthesis,
  cardNoteId,
  cardsOf,
  composeCardDoc,
  escapeHtml,
  sanitizeRichText,
  quoteIdsIn,
  live,
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
import { edgePath, layoutBoard, settle, GAP } from "@/lib/board-layout";
import { PROVIDER_NAME, recordSpend, type AiProvider } from "@/lib/spend";

type Props = {
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
  ai: { provider: AiProvider; model?: string };
  /** Who is signed in and whether the work is saved (useAccount). */
  accountStrip?: React.ReactNode;
  /** History and export live with the Google account. */
  signedIn?: boolean;
  onRestored?: (doc: Writing) => void;
};

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
export default function SubjectPage(props: Props) {
  const { note, board, onBoard, keyHeaders, hasAiKey, ai } = props;
  const meta = metaOf(board);
  const [historyOpen, setHistoryOpen] = useState(false);
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
  const allCards = useMemo(() => cardsOf(note, board), [note, board]);
  const items = useMemo(() => live(board), [board]);
  // Tabs: each is its own page of stories and boxes. The AI still reads the
  // whole subject, so insights can connect stories across tabs.
  const tabs = useMemo(() => tabsOf(board), [board]);
  const currentTab = activeTabOf(board);
  const cards = allCards.filter((card) => tabOf(board, card.id, tabs) === currentTab);
  const tabCardIds = new Set(cards.map((card) => card.id));
  const boxes = items.filter(
    (item): item is BoxItem => item.kind === "box" && tabOf(board, item.id, tabs) === currentTab,
  );
  // An insight shows on each tab whose stories it draws on; one about no
  // story in particular shows on the first tab.
  const insights = items.filter(
    (item): item is InsightItem =>
      item.kind === "insight" &&
      (item.refs.some((ref) => tabCardIds.has(ref)) || (item.refs.length === 0 && currentTab === MAIN_TAB)),
  );
  const suggestions = items.filter(
    (item): item is SuggestItem => item.kind === "suggest" && item.state === "pending",
  );
  const [run, setRun] = useState<RunState>({ state: "idle" });
  const [focusBox, setFocusBox] = useState<string | null>(null);
  const [renaming, setRenaming] = useState<string | null>(null);

  // A note that has writing of its own brings it onto the board, once.
  useEffect(() => {
    if (!meta.migrated) onBoard((current) => migrateNoteWriting(note, current));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [note.id, meta.migrated]);

  const setView = (view: "doc" | "board") => onBoard((current) => put(current, { ...metaOf(current), view }));

  const addBox = (at?: { x: number; y: number }) => {
    const id = newItemId("box");
    onBoard((current) => {
      let next = placeNew(put(current, { id, kind: "box", html: "", at: Date.now() }), id);
      if (at) next = put(next, { id: posId(id), kind: "pos", target: id, x: at.x, y: at.y, w: 280, at: Date.now() });
      return next;
    });
    setFocusBox(id);
  };

  const removeCard = (card: Card) => {
    const quoteIds = new Set(card.quotes.map((quote) => quote.id));
    if (quoteIds.size > 0) {
      const known = new Set(note.entries.map((entry) => entry.id));
      props.onCommitEntries(note.entries.filter((entry) => !quoteIds.has(entry.id)), known);
    }
    onBoard((current) => {
      let next = current ?? {};
      for (const item of live(next)) {
        if ((item.kind === "story" || item.kind === "suggest") && canonicalUrl(item.link) === card.id) {
          next = remove(next, item.id);
        }
      }
      for (const item of live(next)) {
        if (item.kind === "cardnote" && item.card === card.id) next = remove(next, item.id);
      }
      return remove(next, posId(card.id));
    });
  };

  const removeQuotes = (quoteIds: string[]) => {
    const gone = new Set(quoteIds);
    const known = new Set(note.entries.map((entry) => entry.id));
    props.onCommitEntries(note.entries.filter((entry) => !gone.has(entry.id)), known);
  };

  const setCardNote = (card: Card, html: string) =>
    onBoard((current) => put(current, { id: cardNoteId(card.id), kind: "cardnote", card: card.id, html, at: Date.now() }));

  const decide = (suggestion: SuggestItem, state: "accepted" | "dismissed") =>
    onBoard((current) => {
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
  const copyTab = async () => {
    const tabName = tabs.find((tab) => tab.id === currentTab)?.name;
    const unlinkQuotes = (html: string) => sanitizeRichText(html).replace(/<a data-quote="[^"]+">([\s\S]*?)<\/a>/g, "$1");
    const parts: string[] = [`<h2>${escapeHtml(note.name)}${tabs.length > 1 && tabName ? ` — ${escapeHtml(tabName)}` : ""}</h2>`];
    for (const card of cards) {
      parts.push(`<h3><a href="${escapeHtml(card.link)}">${escapeHtml(card.title)}</a></h3>`);
      if (card.source) parts.push(`<p><i>${escapeHtml(card.source)}</i></p>`);
      parts.push(unlinkQuotes(composeCardDoc(card.note, card.quotes)));
    }
    for (const box of boxes) parts.push(unlinkQuotes(box.html));
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
      li.prepend(document.createTextNode(`${"  ".repeat(depth)}• `));
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
        body: JSON.stringify({ ...given, provider: ai.provider, model: ai.model }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "The run failed.");
      if ((data as SynthesisResult).usage) recordSpend((data as SynthesisResult).usage!, note.name);
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
    if (!hasAiKey || !shouldAutoRun(input, meta)) return;
    const timer = setTimeout(() => void synthesize(), 8000);
    return () => clearTimeout(timer);
  }, [hasAiKey, input, meta, synthesize]);

  const aiStatus = !hasAiKey ? (
    <span className="subject-ai-hint">
      Add your {PROVIDER_NAME[ai.provider]} key in Settings → API keys for insights.
    </span>
  ) : run.state === "running" ? (
    <span className="subject-ai-hint">Thinking across {allCards.length} stories…</span>
  ) : run.state === "error" ? (
    <span className="subject-ai-hint error">{run.message}</span>
  ) : allCards.length < 2 ? (
    <span className="subject-ai-hint">Insights start once there are two stories.</span>
  ) : null;

  const shared = {
    tabs,
    currentTab,
    moveCard,
    cards,
    boxes,
    insights,
    suggestions,
    focusBox,
    onOpenArticle: props.onOpenArticle,
    removeCard,
    removeQuotes,
    setCardNote,
    decide,
    setBox: (box: BoxItem, html: string) => onBoard((current) => put(current, { ...box, html, at: Date.now() })),
    removeBox: (box: BoxItem) => onBoard((current) => remove(remove(current, box.id), posId(box.id))),
  };

  return (
    <div className="subject-page">
      <div className="main-head subject-head">
        {props.onOpenMenu && (
          <button className="menu-btn" onClick={props.onOpenMenu} aria-label="Open feeds">
            {Icon.menu}
          </button>
        )}
        {props.onBack && (
          <button className="btn ghost small" onClick={props.onBack} aria-label="All subjects">
            {Icon.back} Subjects
          </button>
        )}
        <div>
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
          <p className="sub">
            {cards.length} {cards.length === 1 ? "story" : "stories"}
            {insights.length > 0 && ` · ${insights.length} insights`}
            {suggestions.length > 0 && ` · ${suggestions.length} suggested`}
          </p>
        </div>
        <div className="subject-actions">
          <div className="seg" role="tablist" aria-label="View">
            <button role="tab" aria-selected={meta.view !== "board"} className={meta.view !== "board" ? "on" : ""}
              onClick={() => setView("doc")}>Document</button>
            <button role="tab" aria-selected={meta.view === "board"} className={meta.view === "board" ? "on" : ""}
              onClick={() => setView("board")}>Whiteboard</button>
          </div>
          <button className="btn ghost small" onClick={() => addBox()}>+ Text box</button>
          <button className="btn ghost small" onClick={() => void copyTab()} title="Copy this tab as formatted text, for Google Docs and the like">
            {copied ? "Copied" : "Copy"}
          </button>
          <button
            className={`btn ghost small ${meta.offline ? "on" : ""}`}
            aria-pressed={Boolean(meta.offline)}
            onClick={() => onBoard((current) => put(current, { ...metaOf(current), offline: !metaOf(current).offline }))}
            title="Keep every story in this subject downloaded for reading without a connection"
          >
            {meta.offline ? "✓ Available offline" : "Make available offline"}
          </button>
          {props.signedIn && (
            <>
              <button className="btn ghost small" onClick={() => setHistoryOpen(true)}>
                History
              </button>
              <button className="btn ghost small" disabled={exporting === "working"} onClick={() => void exportDoc()}>
                {exporting === "working" ? "Exporting…" : "Export to Google Doc"}
              </button>
            </>
          )}
          <button className="btn ghost small" disabled={!hasAiKey || allCards.length < 2 || run.state === "running"}
            onClick={() => void synthesize()} title="Find connections and suggest reading now">
            ✦ Insights
          </button>
        </div>
      </div>
      {props.accountStrip}
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
      {historyOpen && (
        <SubjectHistory
          subjectId={note.id}
          onClose={() => setHistoryOpen(false)}
          onRestored={(doc) => props.onRestored?.(doc)}
        />
      )}
      {aiStatus && <div className="subject-ai-bar">{aiStatus}</div>}
      <TabBar
        tabs={tabs}
        current={currentTab}
        onSwitch={switchTab}
        onAdd={(name) => onBoard((current) => addTab(current, name).board)}
        onRename={(tab, name) => onBoard((current) => renameTab(current, tab, name))}
        onDelete={(tab) => onBoard((current) => deleteTab(current, tab))}
      />

      {meta.view === "board" ? (
        <Whiteboard {...shared} board={board} onBoard={onBoard} addBox={addBox} />
      ) : (
        <DocumentView {...shared} />
      )}
    </div>
  );
}

type Shared = {
  tabs: Tab[];
  currentTab: string;
  moveCard: (target: string, tab: string) => void;
  cards: Card[];
  boxes: BoxItem[];
  insights: InsightItem[];
  suggestions: SuggestItem[];
  focusBox: string | null;
  onOpenArticle: (link: string, title: string, quote: string) => void;
  removeCard: (card: Card) => void;
  removeQuotes: (ids: string[]) => void;
  setCardNote: (card: Card, html: string) => void;
  decide: (suggestion: SuggestItem, state: "accepted" | "dismissed") => void;
  setBox: (box: BoxItem, html: string) => void;
  removeBox: (box: BoxItem) => void;
};

/* ---------------------------------------------------------------------- */
/* Pieces shared by both views                                             */
/* ---------------------------------------------------------------------- */

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
  return (
    <div className="subject-card">
      <div className="subject-card-head" onPointerDown={dragHandle}>
        <button className="subject-card-title"
          onClick={() => shared.onOpenArticle(card.link, card.title, "")}>
          {card.title}
        </button>
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
        <button className="icon-btn subtle" aria-label="Remove story from subject" title="Remove from subject"
          onPointerDown={(e) => e.stopPropagation()} onClick={() => shared.removeCard(card)}>
          {Icon.close}
        </button>
      </div>
      {card.source && <div className="subject-card-source">{card.source}</div>}
      <div className="subject-card-body">
        {/* One document per story: the quotes are bullets in it, as links to
            their passages, and everything around them is yours to write. */}
        <RichText
          className="subject-card-note"
          html={composeCardDoc(card.note, card.quotes)}
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
          </div>
        ))}
      </div>
    </div>
  );
}

function TextBox({ box, shared, dragHandle }: { box: BoxItem; shared: Shared; dragHandle?: (e: React.PointerEvent) => void }) {
  return (
    <div className="subject-box">
      <div className="subject-box-head" onPointerDown={dragHandle}>
        <span className="subject-box-grip" aria-hidden="true">⋮⋮</span>
        <button className="icon-btn subtle" aria-label="Delete text box" onPointerDown={(e) => e.stopPropagation()}
          onClick={() => shared.removeBox(box)}>
          {Icon.close}
        </button>
      </div>
      <RichText html={box.html} placeholder="Write anything…" autoFocus={shared.focusBox === box.id}
        onChange={(html) => shared.setBox(box, html)} />
    </div>
  );
}

function InsightCard({ insight, cards, dragHandle }: { insight: InsightItem; cards: Card[]; dragHandle?: (e: React.PointerEvent) => void }) {
  const titles = insight.refs
    .map((ref) => cards.find((card) => card.id === ref)?.title)
    .filter(Boolean);
  return (
    <div className="subject-insight" onPointerDown={dragHandle}>
      <span className="ai-tag">✦ {INSIGHT_LABEL[insight.type]}</span>
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
/* Document view                                                           */
/* ---------------------------------------------------------------------- */

function DocumentView(shared: Shared) {
  const { inside, apart } = splitInsights(shared.insights);
  const stack = [
    ...shared.cards.map((card) => ({ at: card.at, key: card.id, node: <StoryCard card={card} own={inside.get(card.id) ?? []} shared={shared} /> })),
    ...shared.boxes.map((box) => ({ at: box.at, key: box.id, node: <TextBox box={box} shared={shared} /> })),
  ].sort((a, b) => a.at - b.at);

  return (
    <div className="subject-doc">
      {stack.length === 0 && (
        <p className="hint">
          Nothing here yet. Highlight a passage in an article and add it to this subject, use <strong>Subject</strong> in
          an article&apos;s toolbar to add the whole story, or start with a text box.
        </p>
      )}
      {stack.map((entry) => (
        <div key={entry.key}>{entry.node}</div>
      ))}
      {apart.length > 0 && (
        <div className="subject-insights-card">
          <div className="subject-insights-head">✦ Across your stories</div>
          {apart.map((insight) => (
            <div key={insight.id} className="subject-insight-row">
              <span className="ai-tag">{INSIGHT_LABEL[insight.type]}</span>
              <p>{insight.text}</p>
            </div>
          ))}
        </div>
      )}
      {shared.suggestions.map((suggestion) => (
        <SuggestionCard key={suggestion.id} suggestion={suggestion} shared={shared} />
      ))}
    </div>
  );
}

/* ---------------------------------------------------------------------- */
/* Whiteboard                                                              */
/* ---------------------------------------------------------------------- */

type Node = { id: string; kind: "card" | "box" | "insight" | "suggest"; render: (drag: (e: React.PointerEvent) => void) => React.ReactNode };

const CARD_W = 300;

function Whiteboard(
  shared: Shared & {
    board: Board | undefined;
    onBoard: Props["onBoard"];
    addBox: (at?: { x: number; y: number }) => void;
  },
) {
  const { board, onBoard } = shared;
  // A phone starts zoomed out, so more than one card fits across.
  const startView = () =>
    typeof window !== "undefined" && window.innerWidth < 760 ? { x: 12, y: 12, zoom: 0.55 } : { x: 40, y: 40, zoom: 1 };
  const [view, setView] = useState(startView);
  const [drag, setDrag] = useState<{ id: string; x: number; y: number } | null>(null);
  /** A card being widened or narrowed, by its right-hand edge. */
  const [resize, setResize] = useState<{ id: string; w: number } | null>(null);
  const [connecting, setConnecting] = useState<string | null | false>(false);
  const [focus, setFocus] = useState<string | null>(null);
  const [showAiLinks, setShowAiLinks] = useState(false);
  const [sizes, setSizes] = useState<Record<string, { w: number; h: number }>>({});
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
      render: (d: (e: React.PointerEvent) => void) => <InsightCard insight={insight} cards={shared.cards} dragHandle={d} />,
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
        .filter((node) => node.id !== drag?.id)
        .map((node) => {
          const h = sizes[node.id]?.h ?? 160;
          const saved = placed.get(node.id);
          const width = resize?.id === node.id ? resize.w : (saved?.w ?? CARD_W);
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
    }
    return laid;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [board, shared.cards, shared.boxes, shared.insights, shared.suggestions, drag, sizes, resize]);

  /**
   * Widen or narrow a card by dragging its right edge. Saved as the card's
   * width with its place; anything it now overlaps moves down out of the way.
   */
  const MIN_W = 200;
  const MAX_W = 900;
  const startResize = (id: string) => (event: React.PointerEvent) => {
    if (event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    const start = positions.get(id);
    if (!start) return;
    const origin = { px: event.clientX, w: start.w };
    let w = start.w;
    const move = (e: PointerEvent) => {
      w = Math.round(Math.min(MAX_W, Math.max(MIN_W, origin.w + (e.clientX - origin.px) / view.zoom)));
      setResize({ id, w });
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      setResize(null);
      if (w !== start.w) {
        onBoard((current) =>
          put(current, { id: posId(id), kind: "pos", target: id, x: Math.round(start.x), y: Math.round(start.y), w, at: Date.now() }),
        );
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

  const userLinks = live(board).filter((item): item is LinkItem => item.kind === "link");
  // The AI's links are shown for what the pointer is on, or all of them when
  // asked: drawn together they cross every card on the board.
  const aiLinks = shared.insights
    .flatMap((insight) => insight.refs.map((ref) => ({ id: `${insight.id}->${ref}`, from: insight.id, to: ref })))
    .filter((link) => showAiLinks || (focus !== null && (link.from === focus || link.to === focus)));

  const startDrag = (id: string) => (event: React.PointerEvent) => {
    if (event.button !== 0) return;
    if (connecting !== false) {
      event.stopPropagation();
      if (connecting === null) setConnecting(id);
      else {
        if (connecting !== id) {
          const [from, to] = [connecting, id].sort();
          onBoard((current) => put(current, { id: `link:${from}|${to}`, kind: "link", from, to, at: Date.now() }));
        }
        setConnecting(false);
      }
      return;
    }
    event.stopPropagation();
    // Text fields are for typing, not for dragging.
    if ((event.target as HTMLElement).closest(".rich-body, input, textarea")) return;
    const start = positions.get(id);
    if (!start) return;
    const origin = { px: event.clientX, py: event.clientY, x: start.x, y: start.y, w: start.w };
    let last = { x: start.x, y: start.y };
    // A press on a title is a click until it moves: only then is it a drag.
    let moved = false;
    const move = (e: PointerEvent) => {
      if (!moved && Math.hypot(e.clientX - origin.px, e.clientY - origin.py) < 5) return;
      moved = true;
      last = { x: origin.x + (e.clientX - origin.px) / view.zoom, y: origin.y + (e.clientY - origin.py) / view.zoom };
      setDrag({ id, ...last });
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
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
      if (moved && (last.x !== start.x || last.y !== start.y)) {
        // Dropped on top of something: it lands just below instead.
        const others = [...positions.entries()].filter(([other]) => other !== id).map(([, rect]) => rect);
        const landed = settle({ x: last.x, y: last.y, w: origin.w, h: sizes[id]?.h ?? 160 }, others);
        onBoard((current) => put(current, { id: posId(id), kind: "pos", target: id, x: Math.round(landed.x), y: Math.round(landed.y), w: origin.w, at: Date.now() }));
      }
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  const startPan = (event: React.PointerEvent) => {
    if (event.pointerType === "touch") return; // touch pans in the gesture handler
    if (event.button !== 0 || event.target !== event.currentTarget) return;
    const origin = { px: event.clientX, py: event.clientY, x: view.x, y: view.y };
    const move = (e: PointerEvent) => setView((v) => ({ ...v, x: origin.x + e.clientX - origin.px, y: origin.y + e.clientY - origin.py }));
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  const MIN_ZOOM = 0.3;
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
    const onDown = (event: PointerEvent) => {
      if (event.pointerType !== "touch") return;
      touches.set(event.pointerId, { x: event.clientX, y: event.clientY });
      if (touches.size === 2) startPinch();
      else if (touches.size === 1 && isBoard(event.target)) {
        gesture = { kind: "pan", startX: event.clientX, startY: event.clientY, view: viewRef.current };
      }
    };
    const onMove = (event: PointerEvent) => {
      if (!touches.has(event.pointerId)) return;
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

  const line = (key: string, from: string, to: string, className: string, onRemove?: () => void) => {
    const a = positions.get(from);
    const b = positions.get(to);
    if (!a || !b) return null;
    const { d, mid } = edgePath(a, b);
    return (
      <g key={key} className={className}>
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
          {connecting === false ? "Connect" : connecting === null ? "Pick the first…" : "Now the second…"}
        </button>
        <button className="btn ghost small" onClick={() => zoomBy(1.1)} aria-label="Zoom in">+</button>
        <button className="btn ghost small" onClick={() => zoomBy(1 / 1.1)} aria-label="Zoom out">−</button>
        <button className="btn ghost small" onClick={() => setView(startView())}>Reset view</button>
        <button className={`btn ghost small${showAiLinks ? " on" : ""}`} onClick={() => setShowAiLinks((v) => !v)}
          title="Show every line from the AI's insights to the stories they draw on">
          AI links
        </button>
        <button className="btn ghost small" title="Put everything back in tidy columns"
          onClick={() =>
            onBoard((current) => {
              let next = current ?? {};
              for (const item of live(next)) if (item.kind === "pos") next = remove(next, item.id);
              return next;
            })
          }>
          Tidy up
        </button>
        <span className="wb-hint">Drag by the title · point at a card to see its AI links · double-click for a text box</span>
      </div>
      <div
        ref={canvas}
        className={`wb-canvas${connecting !== false ? " connecting" : ""}`}
        onPointerDown={startPan}
        onDoubleClick={(event) => {
          if (event.target === event.currentTarget) shared.addBox(toBoard(event.clientX, event.clientY));
        }}
      >
        <div className="wb-layer" style={{ transform: `translate(${view.x}px, ${view.y}px) scale(${view.zoom})` }}>
          <svg className="wb-lines" width={1} height={1}>
            {aiLinks.map((link) => line(link.id, link.from, link.to, "wb-line ai"))}
            {userLinks.map((link) =>
              line(link.id, link.from, link.to, "wb-line", () => onBoard((current) => remove(current, link.id))),
            )}
          </svg>
          {nodes.map((node) => {
            const pos = positions.get(node.id)!;
            return (
              <div
                key={node.id}
                ref={(el) => {
                  if (el) nodeEls.current.set(node.id, el);
                  else nodeEls.current.delete(node.id);
                }}
                className={`wb-node kind-${node.kind}${connecting === node.id ? " picked" : ""}${drag?.id === node.id ? " dragging" : ""}`}
                style={{ left: pos.x, top: pos.y, width: pos.w }}
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
}: {
  tabs: Tab[];
  current: string;
  onSwitch: (tab: string) => void;
  onAdd: (name: string) => void;
  onRename: (tab: string, name: string) => void;
  onDelete: (tab: string) => void;
}) {
  const [editing, setEditing] = useState<{ id: string | null; draft: string } | null>(null);
  const [confirming, setConfirming] = useState<string | null>(null);

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
              onClick={() => onSwitch(tab.id)}
              onDoubleClick={() => setEditing({ id: tab.id, draft: tab.name })}
            >
              {tab.name}
            </button>
            {tab.id !== MAIN_TAB && tab.id === current && (
              <button className="subject-tab-close" aria-label={`Close tab ${tab.name}`} onClick={() => setConfirming(tab.id)}>
                ×
              </button>
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
    </div>
  );
}

/** How many ancestors of an element match a selector, itself excluded. */
function countAncestors(el: Element, selector: string) {
  let count = 0;
  for (let node = el.parentElement; node; node = node.parentElement) if (node.matches(selector)) count += 1;
  return count;
}
