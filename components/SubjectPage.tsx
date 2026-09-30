"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Icon } from "./icons";
import RichText from "./RichText";
import type { Note, NoteEntry } from "@/lib/notes";
import {
  applySynthesis,
  cardNoteId,
  cardsOf,
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

type Props = {
  note: Note;
  board: Board | undefined;
  onBoard: (update: (board: Board | undefined) => Board) => void;
  onOpenArticle: (link: string, title: string, quote: string) => void;
  /** The note's entries after a quote is taken out — see NotePage. */
  onCommitEntries: (entries: NoteEntry[], known: ReadonlySet<string>) => void;
  onOpenMenu?: () => void;
  /** Headers carrying the reader's keys, or undefined when there are none. */
  keyHeaders: () => HeadersInit | undefined;
  hasAiKey: boolean;
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
  const { note, board, onBoard, keyHeaders, hasAiKey } = props;
  const meta = metaOf(board);
  const cards = useMemo(() => cardsOf(note, board), [note, board]);
  const items = useMemo(() => live(board), [board]);
  const boxes = items.filter((item): item is BoxItem => item.kind === "box");
  const insights = items.filter((item): item is InsightItem => item.kind === "insight");
  const suggestions = items.filter(
    (item): item is SuggestItem => item.kind === "suggest" && item.state === "pending",
  );
  const [run, setRun] = useState<RunState>({ state: "idle" });
  const [focusBox, setFocusBox] = useState<string | null>(null);

  // A note that has writing of its own brings it onto the board, once.
  useEffect(() => {
    if (!meta.migrated) onBoard((current) => migrateNoteWriting(note, current));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [note.id, meta.migrated]);

  const setView = (view: "doc" | "board") => onBoard((current) => put(current, { ...metaOf(current), view }));

  const addBox = (at?: { x: number; y: number }) => {
    const id = newItemId("box");
    onBoard((current) => {
      let next = put(current, { id, kind: "box", html: "", at: Date.now() });
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
      return remove(remove(next, cardNoteId(card.id)), posId(card.id));
    });
  };

  const removeQuote = (quoteId: string) => {
    const known = new Set(note.entries.map((entry) => entry.id));
    props.onCommitEntries(note.entries.filter((entry) => entry.id !== quoteId), known);
  };

  const setCardNote = (card: Card, html: string) =>
    onBoard((current) => put(current, { id: cardNoteId(card.id), kind: "cardnote", card: card.id, html, at: Date.now() }));

  const decide = (suggestion: SuggestItem, state: "accepted" | "dismissed") =>
    onBoard((current) => put(current, { ...suggestion, state, at: Date.now() }));

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
        body: JSON.stringify(given),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "The run failed.");
      onBoard((current) => applySynthesis(current, given, data as SynthesisResult));
      setRun({ state: "idle" });
    } catch (error) {
      // Recorded as run, so a failing key does not retry on every keystroke.
      onBoard((current) => put(current, { ...metaOf(current), ranAt: Date.now() }));
      setRun({ state: "error", message: error instanceof Error ? error.message : "The run failed." });
    } finally {
      running.current = false;
    }
  }, [input, keyHeaders, onBoard]);

  // Lightweight and automatic: a while after the material changes, and not
  // more often than every quarter of an hour.
  useEffect(() => {
    if (!hasAiKey || !shouldAutoRun(input, meta)) return;
    const timer = setTimeout(() => void synthesize(), 8000);
    return () => clearTimeout(timer);
  }, [hasAiKey, input, meta, synthesize]);

  const aiStatus = !hasAiKey ? (
    <span className="subject-ai-hint">Add an Anthropic key in Settings → API keys for insights.</span>
  ) : run.state === "running" ? (
    <span className="subject-ai-hint">Thinking across {cards.length} stories…</span>
  ) : run.state === "error" ? (
    <span className="subject-ai-hint error">{run.message}</span>
  ) : cards.length < 2 ? (
    <span className="subject-ai-hint">Insights start once there are two stories.</span>
  ) : null;

  const shared = {
    cards,
    boxes,
    insights,
    suggestions,
    focusBox,
    onOpenArticle: props.onOpenArticle,
    removeCard,
    removeQuote,
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
        <div>
          <h1>{note.name}</h1>
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
          <button className="btn ghost small" disabled={!hasAiKey || cards.length < 2 || run.state === "running"}
            onClick={() => void synthesize()} title="Find connections and suggest reading now">
            ✦ Insights
          </button>
        </div>
      </div>
      {aiStatus && <div className="subject-ai-bar">{aiStatus}</div>}

      {meta.view === "board" ? (
        <Whiteboard {...shared} board={board} onBoard={onBoard} addBox={addBox} />
      ) : (
        <DocumentView {...shared} />
      )}
    </div>
  );
}

type Shared = {
  cards: Card[];
  boxes: BoxItem[];
  insights: InsightItem[];
  suggestions: SuggestItem[];
  focusBox: string | null;
  onOpenArticle: (link: string, title: string, quote: string) => void;
  removeCard: (card: Card) => void;
  removeQuote: (id: string) => void;
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
        <button className="icon-btn subtle" aria-label="Remove story from subject" title="Remove from subject"
          onPointerDown={(e) => e.stopPropagation()} onClick={() => shared.removeCard(card)}>
          {Icon.close}
        </button>
      </div>
      {card.source && <div className="subject-card-source">{card.source}</div>}
      <div className="subject-card-body">
        {card.quotes.map((quote) => (
          <blockquote key={quote.id} className="subject-quote">
            <button className="subject-quote-text" onPointerDown={(e) => e.stopPropagation()}
              onClick={() => shared.onOpenArticle(card.link, card.title, quote.text)}>
              “{quote.text}”
            </button>
            <button className="icon-btn subtle" aria-label="Remove quote" onPointerDown={(e) => e.stopPropagation()}
              onClick={() => shared.removeQuote(quote.id)}>
              {Icon.close}
            </button>
          </blockquote>
        ))}
        <RichText
          className="subject-card-note"
          html={card.note}
          placeholder="Add notes…"
          onChange={(html) => shared.setCardNote(card, html)}
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

function SuggestionCard({ suggestion, shared, dragHandle }: { suggestion: SuggestItem; shared: Shared; dragHandle?: (e: React.PointerEvent) => void }) {
  const [open, setOpen] = useState(false);
  return (
    <div className={`subject-suggest${open ? " open" : ""}`} onPointerDown={dragHandle}>
      <span className="ai-tag">✦ Suggested reading</span>
      <button className="subject-card-title" onClick={() => setOpen((v) => !v)}>
        {suggestion.title}
      </button>
      {suggestion.source && <div className="subject-card-source">{suggestion.source}</div>}
      <p className="subject-suggest-why">{suggestion.why}</p>
      {open && (
        <div className="subject-suggest-actions" onPointerDown={(e) => e.stopPropagation()}>
          <button className="btn small" onClick={() => shared.decide(suggestion, "accepted")}>Add to subject</button>
          <button className="btn ghost small" onClick={() => shared.onOpenArticle(suggestion.link, suggestion.title, "")}>Read</button>
          <button className="btn ghost small" onClick={() => shared.decide(suggestion, "dismissed")}>Not relevant</button>
        </div>
      )}
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
  const [view, setView] = useState({ x: 40, y: 40, zoom: 1 });
  const [drag, setDrag] = useState<{ id: string; x: number; y: number } | null>(null);
  const [connecting, setConnecting] = useState<string | null | false>(false);
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

  /** Where each node sits: its saved place, or a tidy default by kind. */
  const positions = useMemo(() => {
    const placed = new Map<string, { x: number; y: number; w: number }>();
    for (const item of live(board)) {
      if (item.kind === "pos") placed.set((item as PosItem).target, { x: item.x, y: item.y, w: item.w });
    }
    const out = new Map<string, { x: number; y: number; w: number }>();
    const counters = { card: 0, box: 0, insight: 0, suggest: 0 };
    for (const node of nodes) {
      const saved = placed.get(node.id);
      if (saved) {
        out.set(node.id, saved);
        continue;
      }
      const n = counters[node.kind]++;
      // Stories in two columns, your boxes and the AI's insights in a third
      // beside them, suggestions under the stories.
      const cardRows = Math.ceil(shared.cards.length / 2) || 1;
      const x =
        node.kind === "card" ? (n % 2) * (CARD_W + 40)
        : node.kind === "suggest" ? (n % 2) * (CARD_W + 40)
        : 2 * (CARD_W + 40) + 40;
      const y =
        node.kind === "card" ? Math.floor(n / 2) * 340
        : node.kind === "suggest" ? cardRows * 340 + Math.floor(n / 2) * 220
        : node.kind === "box" ? n * 200
        : shared.boxes.length * 200 + n * 190;
      out.set(node.id, { x, y, w: CARD_W });
    }
    if (drag) {
      const current = out.get(drag.id);
      if (current) out.set(drag.id, { ...current, x: drag.x, y: drag.y });
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [board, shared.cards, shared.boxes, shared.insights, shared.suggestions, drag]);

  // Heights are whatever the content makes them; lines need to know them.
  useLayoutEffect(() => {
    const observer = new ResizeObserver(() => {
      const next: Record<string, { w: number; h: number }> = {};
      nodeEls.current.forEach((el, id) => (next[id] = { w: el.offsetWidth, h: el.offsetHeight }));
      setSizes((current) => (JSON.stringify(current) === JSON.stringify(next) ? current : next));
    });
    nodeEls.current.forEach((el) => observer.observe(el));
    return () => observer.disconnect();
  });

  const center = (id: string) => {
    const pos = positions.get(id);
    const size = sizes[id] ?? { w: CARD_W, h: 120 };
    return pos ? { x: pos.x + size.w / 2, y: pos.y + size.h / 2 } : null;
  };

  const userLinks = live(board).filter((item): item is LinkItem => item.kind === "link");
  const aiLinks = shared.insights.flatMap((insight) => insight.refs.map((ref) => ({ id: `${insight.id}->${ref}`, from: insight.id, to: ref })));

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
        onBoard((current) => put(current, { id: posId(id), kind: "pos", target: id, x: Math.round(last.x), y: Math.round(last.y), w: origin.w, at: Date.now() }));
      }
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  const startPan = (event: React.PointerEvent) => {
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

  const zoomBy = (factor: number) => setView((v) => ({ ...v, zoom: Math.min(2, Math.max(0.3, v.zoom * factor)) }));

  const onWheel = (event: React.WheelEvent) => {
    if (event.ctrlKey || event.metaKey) {
      zoomBy(event.deltaY < 0 ? 1.1 : 0.9);
    } else {
      setView((v) => ({ ...v, x: v.x - event.deltaX, y: v.y - event.deltaY }));
    }
  };

  const toBoard = (clientX: number, clientY: number) => {
    const rect = canvas.current?.getBoundingClientRect();
    return {
      x: Math.round((clientX - (rect?.left ?? 0) - view.x) / view.zoom),
      y: Math.round((clientY - (rect?.top ?? 0) - view.y) / view.zoom),
    };
  };

  const line = (key: string, from: string, to: string, className: string, onRemove?: () => void) => {
    const a = center(from);
    const b = center(to);
    if (!a || !b) return null;
    return (
      <g key={key} className={className}>
        <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} />
        {onRemove && (
          <g className="wb-unlink" transform={`translate(${(a.x + b.x) / 2} ${(a.y + b.y) / 2})`} onClick={onRemove}>
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
        <button className="btn ghost small" onClick={() => zoomBy(1.2)} aria-label="Zoom in">+</button>
        <button className="btn ghost small" onClick={() => zoomBy(1 / 1.2)} aria-label="Zoom out">−</button>
        <button className="btn ghost small" onClick={() => setView({ x: 40, y: 40, zoom: 1 })}>Reset view</button>
        <span className="wb-hint">Drag cards by their top edge · double-click the board for a text box · ⌘/Ctrl + scroll to zoom</span>
      </div>
      <div
        ref={canvas}
        className={`wb-canvas${connecting !== false ? " connecting" : ""}`}
        onPointerDown={startPan}
        onWheel={onWheel}
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
                onPointerDownCapture={(event) => {
                  // In connect mode, any click on a node picks it.
                  if (connecting !== false) startDrag(node.id)(event);
                }}
              >
                {node.render(startDrag(node.id))}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
