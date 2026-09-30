/**
 * Placing things on the whiteboard so they never sit on top of each other,
 * and drawing the lines between them so they stay readable.
 *
 * Cards are as tall as their content, which changes as quotes and notes are
 * added, so any layout worked out from a fixed row height eventually stacks
 * one card over the next. Everything here works from measured rectangles
 * instead, and settles every overlap by moving the later card down.
 */

export type Rect = { x: number; y: number; w: number; h: number };

export const GAP = 24;

function overlaps(a: Rect, b: Rect, gap = GAP) {
  return a.x < b.x + b.w + gap && b.x < a.x + a.w + gap && a.y < b.y + b.h + gap && b.y < a.y + a.h + gap;
}

/**
 * Move `rect` straight down until it clears every one of `fixed`. Only ever
 * down: a card someone put somewhere stays in its column, and the board
 * grows downwards, which is the direction it scrolls.
 */
export function settle(rect: Rect, fixed: Rect[], gap = GAP): Rect {
  let current = { ...rect };
  for (let guard = 0; guard < 500; guard += 1) {
    const hit = fixed.find((other) => overlaps(current, other, gap));
    if (!hit) return current;
    current = { ...current, y: hit.y + hit.h + gap };
  }
  return current;
}

/**
 * Every node's final rectangle. Nodes the reader placed are settled first,
 * in order down the board, so a card that grew pushes the one below it
 * rather than covering it; nodes nobody placed then fill their column from
 * the top, below whatever is already there.
 */
export function layoutBoard(
  nodes: { id: string; placed: boolean; x: number; y: number; w: number; h: number }[],
  gap = GAP,
): Map<string, Rect> {
  const out = new Map<string, Rect>();
  const fixed: Rect[] = [];
  const placed = nodes.filter((n) => n.placed).sort((a, b) => a.y - b.y || a.x - b.x);
  const free = nodes.filter((n) => !n.placed);
  for (const node of [...placed, ...free]) {
    const rect = settle({ x: node.x, y: node.y, w: node.w, h: node.h }, fixed, gap);
    fixed.push(rect);
    out.set(node.id, rect);
  }
  return out;
}

/**
 * A line between two rectangles, leaving from the facing sides and curving
 * in, so it runs through the gap between two cards instead of across both.
 */
export function edgePath(a: Rect, b: Rect): { d: string; mid: { x: number; y: number } } {
  const ac = { x: a.x + a.w / 2, y: a.y + a.h / 2 };
  const bc = { x: b.x + b.w / 2, y: b.y + b.h / 2 };
  const horizontalGap = Math.max(b.x - (a.x + a.w), a.x - (b.x + b.w));
  const verticalGap = Math.max(b.y - (a.y + a.h), a.y - (b.y + b.h));

  let start: { x: number; y: number };
  let end: { x: number; y: number };
  let c1: { x: number; y: number };
  let c2: { x: number; y: number };
  if (horizontalGap >= verticalGap) {
    const right = bc.x >= ac.x;
    start = { x: right ? a.x + a.w : a.x, y: ac.y };
    end = { x: right ? b.x : b.x + b.w, y: bc.y };
    const pull = Math.max(40, Math.abs(end.x - start.x) / 2);
    c1 = { x: start.x + (right ? pull : -pull), y: start.y };
    c2 = { x: end.x + (right ? -pull : pull), y: end.y };
  } else {
    const down = bc.y >= ac.y;
    start = { x: ac.x, y: down ? a.y + a.h : a.y };
    end = { x: bc.x, y: down ? b.y : b.y + b.h };
    const pull = Math.max(40, Math.abs(end.y - start.y) / 2);
    c1 = { x: start.x, y: start.y + (down ? pull : -pull) };
    c2 = { x: end.x, y: end.y + (down ? -pull : pull) };
  }
  const r = (n: number) => Math.round(n);
  return {
    d: `M${r(start.x)} ${r(start.y)} C${r(c1.x)} ${r(c1.y)} ${r(c2.x)} ${r(c2.y)} ${r(end.x)} ${r(end.y)}`,
    // The curve's midpoint, for the remove button on a drawn connection.
    mid: {
      x: r(0.125 * start.x + 0.375 * c1.x + 0.375 * c2.x + 0.125 * end.x),
      y: r(0.125 * start.y + 0.375 * c1.y + 0.375 * c2.y + 0.125 * end.y),
    },
  };
}
