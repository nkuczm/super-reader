"use client";

import { memo, useLayoutEffect, useMemo, useRef, useState } from "react";
import { layoutBoard, GAP } from "@/lib/board-layout";
import { safeGrid } from "@/lib/sheet";
import { safeTranscript } from "@/lib/transcript";
import {
  bylineOf,
  drawingSvg,
  labelColorOf,
  live,
  metaOf,
  safeImage,
  sanitizeRichText,
  textOf,
  type Board,
  type BoxItem,
  type Card,
  type InsightItem,
  type LinkItem,
  type PosItem,
} from "@/lib/subjects";

/** The whiteboard's card width; nodes nobody placed start in its columns. */
const CARD_W = 300;
/**
 * How much of the board a thumbnail shows: about two cards across, the way a
 * document's thumbnail shows the top of its first page — the writing at a
 * size you can make out, not the whole board shrunk to specks.
 */
const WINDOW_W = 470;
/** The tile's shape (width ÷ height); the stylesheet gives the preview the same. */
export const THUMB_ASPECT = 1.45;
const WINDOW_H = WINDOW_W / THUMB_ASPECT;

type Node =
  | { id: string; kind: "card"; card: Card }
  | { id: string; kind: "box"; box: BoxItem }
  | { id: string; kind: "insight"; insight: InsightItem };

/** A card's height before it is drawn: enough to lay the board out as it is on screen. */
function heightOf(node: Node): number {
  if (node.kind === "card") {
    const words = textOf(node.card.note ?? "").length;
    return 70 + node.card.quotes.length * 44 + Math.min(260, Math.ceil(words / 42) * 20);
  }
  if (node.kind === "insight") return 110;
  const box = node.box;
  if (box.label) return box.labelShape === "node" ? 170 : 56;
  if (safeImage(box.image)) return 230;
  if (box.drawing) return 40 + Math.min(1200, Number(box.height) || 300) / 2;
  if (box.table) return 60 + Math.min(8, safeGrid(box.table).length) * 30;
  if (box.transcript) return 220;
  return 40 + Math.min(16, Math.ceil(textOf(box.html).length / 42)) * 20;
}

type Rect = { x: number; y: number; w: number; h: number };
/** Where the line from one card's centre towards another's leaves its edge — so lines join cards, not cross their text. */
function edgeToward(from: Rect, to: Rect) {
  const cx = from.x + from.w / 2;
  const cy = from.y + from.h / 2;
  const dx = to.x + to.w / 2 - cx;
  const dy = to.y + to.h / 2 - cy;
  if (!dx && !dy) return { x: cx, y: cy };
  const t = Math.min(dx ? from.w / 2 / Math.abs(dx) : Infinity, dy ? from.h / 2 / Math.abs(dy) : Infinity);
  return { x: cx + dx * t, y: cy + dy * t };
}

/** What a block shows in the thumbnail: its own content, read-only, nothing interactive. */
function Block({ node }: { node: Node }) {
  if (node.kind === "card") {
    const { card } = node;
    const byline = bylineOf(card);
    return (
      <div className="bt-card">
        <div className="bt-card-title">{card.title}</div>
        {byline && <div className="bt-byline">{byline}</div>}
        {card.quotes.length > 0 && (
          <ul className="bt-quotes">{card.quotes.slice(0, 4).map((q) => <li key={q.id}>“{q.text}”</li>)}</ul>
        )}
        {card.note && <div className="bt-text" dangerouslySetInnerHTML={{ __html: sanitizeRichText(card.note).replace(/<img[^>]*>/g, "") }} />}
      </div>
    );
  }
  if (node.kind === "insight") {
    return <div className="bt-box bt-insight"><span className="bt-tag">✦ Insight</span> {node.insight.text}</div>;
  }
  const box = node.box;
  if (box.label && box.labelShape === "node") {
    return <div className="bt-node-circle" style={{ "--label-color": labelColorOf(box) } as React.CSSProperties}>{textOf(box.html).trim()}</div>;
  }
  if (box.label) {
    return <div className="bt-label" style={{ "--label-color": labelColorOf(box) } as React.CSSProperties}>{textOf(box.html).trim()}</div>;
  }
  const image = safeImage(box.image);
  if (image) {
    return (
      <div className="bt-box bt-picture">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={image} alt="" />
        {box.caption && <div className="bt-caption">{box.caption}</div>}
      </div>
    );
  }
  if (box.drawing) {
    return (
      <div className="bt-box bt-picture">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={drawingSvg(box)} alt="" />
      </div>
    );
  }
  if (box.table) {
    const grid = safeGrid(box.table).slice(0, 8);
    return (
      <div className="bt-box">
        {box.tableName && <div className="bt-table-name">{box.tableName}</div>}
        <table className="bt-table">
          <tbody>
            {grid.map((row, r) => (
              <tr key={r}>{row.slice(0, 4).map((cell, c) => <td key={c}>{(/[<&]/.test(cell) ? textOf(cell) : cell).slice(0, 90)}</td>)}</tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  }
  if (box.transcript) {
    const { title, turns } = safeTranscript(box.transcript);
    return (
      <div className="bt-box">
        <div className="bt-table-name">Transcript{title ? ` — ${title}` : ""}</div>
        {turns.slice(0, 4).map((t, i) => (
          <p key={i} className="bt-turn">{t.s && <b>{t.s}: </b>}{t.x.slice(0, 160)}</p>
        ))}
      </div>
    );
  }
  return <div className="bt-box bt-text" dangerouslySetInnerHTML={{ __html: sanitizeRichText(box.html).replace(/<img[^>]*>/g, "") }} />;
}

/**
 * The thumbnail of a subject: the middle of its whiteboard as it looks, at a
 * size you can read the shape of — like a document's thumbnail showing the
 * top of its first page. A window two cards wide is taken around where the
 * board is busiest (the median of its cards' centres) and scaled to the
 * tile. The cards are drawn from what they hold, read-only; only the ones in
 * the window are drawn at all, so a page of subjects stays light.
 */
function BoardThumb({ board, cards }: { board: Board | undefined; cards: Card[] }) {
  const holder = useRef<HTMLDivElement | null>(null);
  const [scale, setScale] = useState(0.36);
  useLayoutEffect(() => {
    const el = holder.current;
    if (!el) return;
    const fit = () => el.clientWidth && setScale(el.clientWidth / WINDOW_W);
    fit();
    const watch = new ResizeObserver(fit);
    watch.observe(el);
    return () => watch.disconnect();
  }, []);

  const view = useMemo(() => {
    const items = live(board);
    const placed = new Map<string, { x: number; y: number; w: number }>();
    for (const item of items) if (item.kind === "pos") placed.set((item as PosItem).target, { x: item.x, y: item.y, w: item.w });
    const nodes: Node[] = [
      ...cards.map((card) => ({ id: card.id, kind: "card" as const, card })),
      ...items.filter((item): item is BoxItem => item.kind === "box" && !item.embedded).map((box) => ({ id: box.id, kind: "box" as const, box })),
      ...items.filter((item): item is InsightItem => item.kind === "insight" && !metaOf(board).aiOff).map((insight) => ({ id: insight.id, kind: "insight" as const, insight })),
    ];
    if (!nodes.length) return null;
    const counters = { card: 0, box: 0, insight: 0 };
    const laid = layoutBoard(
      nodes.map((node) => {
        const saved = placed.get(node.id);
        const h = heightOf(node);
        if (saved) return { id: node.id, placed: true, x: saved.x, y: saved.y, w: saved.w || CARD_W, h };
        const n = counters[node.kind]++;
        const x = node.kind === "card" ? (n % 2) * (CARD_W + GAP) : 2 * (CARD_W + GAP) + 40;
        return { id: node.id, placed: false, x, y: 0, w: CARD_W, h };
      }),
    );
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const r of laid.values()) {
      minX = Math.min(minX, r.x); minY = Math.min(minY, r.y);
      maxX = Math.max(maxX, r.x + r.w); maxY = Math.max(maxY, r.y + r.h);
    }
    // Like a page: the window starts at a card's edge, never through one. A
    // board that fits is shown from its top-left corner; a bigger one from the
    // card nearest its busiest middle (the median of the cards' centres),
    // taking in anything just above that card — its section label, say.
    const rects = [...laid.values()];
    let x: number;
    let y: number;
    if (maxX - minX + 32 <= WINDOW_W && maxY - minY + 32 <= WINDOW_H) {
      x = minX - 16;
      y = minY - 16;
    } else {
      const median = (values: number[]) => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];
      const mx = median(rects.map((r) => r.x + r.w / 2));
      const my = median(rects.map((r) => r.y + r.h / 2));
      const anchor = rects.reduce((best, r) => (Math.hypot(r.x + r.w / 2 - mx, r.y + r.h / 2 - my) < Math.hypot(best.x + best.w / 2 - mx, best.y + best.h / 2 - my) ? r : best));
      // Not so far right that the page runs off the board's right edge with room to spare on the left.
      x = Math.max(minX - 16, Math.min(anchor.x - 16, maxX + 16 - WINDOW_W));
      const above = rects.filter((r) => r.x < x + WINDOW_W && r.x + r.w > x && r.y < anchor.y && r.y >= anchor.y - WINDOW_H * 0.4);
      y = Math.min(anchor.y, ...above.map((r) => r.y)) - 16;
    }
    const inView = (r: { x: number; y: number; w: number; h: number }) => r.x < x + WINDOW_W && r.x + r.w > x && r.y < y + WINDOW_H && r.y + r.h > y;
    const shown = nodes.map((node) => ({ node, rect: laid.get(node.id)! })).filter(({ rect }) => inView(rect));
    const links = items
      .filter((item): item is LinkItem => item.kind === "link")
      .map((l) => ({ id: l.id, a: laid.get(l.from), b: laid.get(l.to) }))
      .filter((l): l is { id: string; a: NonNullable<typeof l.a>; b: NonNullable<typeof l.b> } => Boolean(l.a && l.b) && (inView(l.a!) || inView(l.b!)));
    return { x, y, shown, links };
  }, [board, cards]);

  return (
    <div className="bt-page" ref={holder} aria-hidden="true">
      {view ? (
        <div className="bt-canvas" style={{ width: WINDOW_W, height: WINDOW_H, transform: `scale(${scale})` }}>
          <svg className="bt-links" width={WINDOW_W} height={WINDOW_H}>
            {view.links.map(({ id, a, b }) => {
              const [p, q] = [edgeToward(a, b), edgeToward(b, a)];
              return <line key={id} x1={p.x - view.x} y1={p.y - view.y} x2={q.x - view.x} y2={q.y - view.y} />;
            })}
          </svg>
          {view.shown.map(({ node, rect }) => (
            <div key={node.id} className="bt-node" style={{ left: rect.x - view.x, top: rect.y - view.y, width: rect.w, maxHeight: rect.h }}>
              <Block node={node} />
            </div>
          ))}
        </div>
      ) : (
        <span className="subject-tile-empty">Nothing on the board yet</span>
      )}
    </div>
  );
}

export default memo(BoardThumb);
