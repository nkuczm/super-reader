"use client";

import { memo, useMemo } from "react";
import { layoutBoard, GAP } from "@/lib/board-layout";
import { live, type Board, type PosItem } from "@/lib/subjects";

/** The whiteboard's card width; nodes nobody placed start in its columns. */
const CARD_W = 300;
/** At most this many pictures are drawn in a thumbnail; the rest show as their boxes. */
const MAX_PICTURES = 6;

type Node = { id: string; kind: "card" | "box" | "insight" | "suggest"; title: string; lines: number; image?: string; table?: boolean };

const text = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();

/**
 * A glimpse of the whiteboard: a window around its busiest middle, the
 * shape of the tile, with every card and box there where it sits. Heights are estimated from what each holds
 * (the board measures them on screen; a thumbnail does not need to), and it
 * is drawn as one small SVG — no cards are rendered, so a grid of subjects
 * stays cheap.
 */
function BoardThumb({ board, cards }: { board: Board | undefined; cards: { id: string; title: string; quotes: unknown[] }[] }) {
  const drawing = useMemo(() => {
    const items = live(board);
    const placed = new Map<string, { x: number; y: number; w: number }>();
    for (const item of items) if (item.kind === "pos") placed.set((item as PosItem).target, { x: item.x, y: item.y, w: item.w });
    const nodes: Node[] = [
      ...cards.map((card) => ({ id: card.id, kind: "card" as const, title: card.title, lines: 2 + Math.min(6, card.quotes.length * 2) })),
      ...items
        .filter((item) => item.kind === "box")
        .map((item) => {
          const box = item as unknown as { id: string; html?: string; image?: string; table?: unknown };
          const words = text(box.html ?? "");
          return { id: box.id, kind: "box" as const, title: words.slice(0, 60), lines: Math.min(14, 1 + Math.ceil(words.length / 45)), image: typeof box.image === "string" && box.image.startsWith("data:image/") ? box.image : undefined, table: Boolean(box.table) };
        }),
      ...items.filter((item) => item.kind === "insight").map((item) => ({ id: item.id, kind: "insight" as const, title: "", lines: 4 })),
      ...items.filter((item) => item.kind === "suggest" && (item as { state?: string }).state === "pending").map((item) => ({ id: item.id, kind: "suggest" as const, title: "", lines: 3 })),
    ];
    if (!nodes.length) return null;
    const counters = { card: 0, box: 0, insight: 0, suggest: 0 };
    const cardsBottom = Math.ceil(cards.length / 2) * 200;
    const heightOf = (n: Node) => (n.image ? 220 : 40 + n.lines * 18);
    const laid = layoutBoard(
      nodes.map((node) => {
        const saved = placed.get(node.id);
        const h = heightOf(node);
        if (saved) return { id: node.id, placed: true, x: saved.x, y: saved.y, w: saved.w || CARD_W, h };
        const n = counters[node.kind]++;
        const x = node.kind === "card" || node.kind === "suggest" ? (n % 2) * (CARD_W + GAP) : 2 * (CARD_W + GAP) + 40;
        return { id: node.id, placed: false, x, y: node.kind === "suggest" ? cardsBottom : 0, w: CARD_W, h };
      }),
    );
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const r of laid.values()) {
      minX = Math.min(minX, r.x); minY = Math.min(minY, r.y);
      maxX = Math.max(maxX, r.x + r.w); maxY = Math.max(maxY, r.y + r.h);
    }
    // Not the whole board: a window the shape of the tile, around where the
    // board is busiest — the middle of its cards, by the median of their
    // centres — wide enough to show a few of them at a readable size.
    const centres = [...laid.values()].map((r) => ({ x: r.x + r.w / 2, y: r.y + r.h / 2 }));
    const median = (values: number[]) => values.sort((a, b) => a - b)[Math.floor(values.length / 2)];
    const cx = median(centres.map((c) => c.x));
    const cy = median(centres.map((c) => c.y));
    const ASPECT = 1.55;
    // A board that fits is shown whole; a big one, through a window about
    // four cards wide, or as tall as the board is when that is less.
    const fullW = maxX - minX + 40;
    const fullH = maxY - minY + 40;
    let w = Math.min(fullW, 1400);
    let h = Math.min(fullH, w / ASPECT);
    // Keep the tile's shape so nothing is cut off at the sides.
    if (w / h > ASPECT) h = w / ASPECT;
    else w = h * ASPECT;
    const clamp = (v: number, lo: number, hi: number) => (hi < lo ? (lo + hi) / 2 : Math.max(lo, Math.min(hi, v)));
    const x = clamp(cx - w / 2, minX - 20, maxX + 20 - w);
    const y = clamp(cy - h / 2, minY - 20, maxY + 20 - h);
    let pictures = 0;
    return {
      box: `${x} ${y} ${w} ${h}`,
      shapes: nodes.map((node) => ({ node, rect: laid.get(node.id)!, image: node.image && pictures++ < MAX_PICTURES ? node.image : undefined })),
    };
  }, [board, cards]);

  if (!drawing) return <span className="subject-tile-empty">Nothing on the board yet</span>;
  return (
    <svg className="board-thumb" viewBox={drawing.box} preserveAspectRatio="xMidYMid meet" aria-hidden="true">
      {drawing.shapes.map(({ node, rect, image }) => (
        <g key={node.id} className={`bt-${node.kind}`}>
          <rect x={rect.x} y={rect.y} width={rect.w} height={rect.h} rx={10} />
          {image ? (
            <image href={image} x={rect.x + 8} y={rect.y + 8} width={rect.w - 16} height={rect.h - 16} preserveAspectRatio="xMidYMid slice" />
          ) : (
            <>
              {node.title && (
                <text x={rect.x + 14} y={rect.y + 34} className="bt-title">
                  {node.title.length > 34 ? `${node.title.slice(0, 33)}…` : node.title}
                </text>
              )}
              {Array.from({ length: Math.min(node.lines, Math.floor((rect.h - 50) / 18)) }, (_, i) => (
                <rect key={i} className="bt-line" x={rect.x + 14} y={rect.y + 50 + i * 18} width={(rect.w - 28) * (i % 3 === 2 ? 0.6 : 0.92)} height={7} rx={3} />
              ))}
            </>
          )}
        </g>
      ))}
    </svg>
  );
}

export default memo(BoardThumb);
