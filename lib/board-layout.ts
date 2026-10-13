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
 * Lines from a section label that would only repeat a path already drawn.
 * When cards linked to the same label are also linked to one another —
 * directly, or through cards between them — only the one nearest the label
 * keeps its own line from it, and the rest are reached through the chain:
 * label → first card → next card, instead of a fan of lines from the label
 * to each. The links themselves stay; only their drawing is spared, so
 * sections and the document's order still count every member.
 */
export function chainedLabelLinks(
  links: { id: string; from: string; to: string }[],
  isLabel: (id: string) => boolean,
  place: (id: string) => Rect | undefined,
): Set<string> {
  const hidden = new Set<string>();
  // Which cards (not labels) reach which, through links between cards.
  const next = new Map<string, string[]>();
  for (const l of links) {
    if (isLabel(l.from) || isLabel(l.to)) continue;
    next.set(l.from, [...(next.get(l.from) ?? []), l.to]);
    next.set(l.to, [...(next.get(l.to) ?? []), l.from]);
  }
  const group = new Map<string, number>();
  let n = 0;
  for (const start of next.keys()) {
    if (group.has(start)) continue;
    const stack = [start];
    group.set(start, n);
    while (stack.length) for (const other of next.get(stack.pop()!) ?? []) if (!group.has(other)) (group.set(other, n), stack.push(other));
    n++;
  }
  const centre = (r: Rect) => ({ x: r.x + r.w / 2, y: r.y + r.h / 2 });
  const byLabel = new Map<string, { link: string; member: string }[]>();
  for (const l of links) {
    const label = isLabel(l.from) ? l.from : isLabel(l.to) ? l.to : null;
    if (!label) continue;
    const member = label === l.from ? l.to : l.from;
    if (isLabel(member)) continue;
    byLabel.set(label, [...(byLabel.get(label) ?? []), { link: l.id, member }]);
  }
  for (const [label, members] of byLabel) {
    const at = place(label);
    const chains = new Map<number, { link: string; member: string }[]>();
    for (const m of members) {
      const g = group.get(m.member);
      if (g === undefined) continue;
      chains.set(g, [...(chains.get(g) ?? []), m]);
    }
    for (const chain of chains.values()) {
      if (chain.length < 2) continue;
      // The member nearest the label keeps its line; the others hang off the chain.
      const distance = (id: string) => {
        const r = place(id);
        if (!r || !at) return Infinity;
        const p = centre(r);
        const q = centre(at);
        return Math.hypot(p.x - q.x, p.y - q.y);
      };
      const keep = chain.reduce((best, m) => (distance(m.member) < distance(best.member) ? m : best));
      for (const m of chain) if (m !== keep) hidden.add(m.link);
    }
  }
  return hidden;
}

/**
 * A line between two rectangles, leaving from the facing sides and curving
 * in, so it runs through the gap between two cards instead of across both.
 */
export function edgePath(a: Rect, b: Rect, round: { a?: boolean; b?: boolean } = {}): { d: string; mid: { x: number; y: number } } {
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
  // A round end (a node) is left from wherever on its circle faces the other
  // end, and the curve sets off straight out from it — lines fan out on
  // every side rather than queueing at one edge.
  const radial = (rect: Rect, toward: { x: number; y: number }) => {
    const c = { x: rect.x + rect.w / 2, y: rect.y + rect.h / 2 };
    const dx = toward.x - c.x;
    const dy = toward.y - c.y;
    const len = Math.hypot(dx, dy) || 1;
    const radius = Math.min(rect.w, rect.h) / 2;
    return { p: { x: c.x + (dx / len) * radius, y: c.y + (dy / len) * radius }, u: { x: dx / len, y: dy / len } };
  };
  if (round.a || round.b) {
    const pull = Math.max(40, Math.hypot(bc.x - ac.x, bc.y - ac.y) / 3);
    if (round.a) {
      const { p, u } = radial(a, round.b ? bc : end);
      start = p;
      c1 = { x: p.x + u.x * pull, y: p.y + u.y * pull };
    }
    if (round.b) {
      const { p, u } = radial(b, round.a ? ac : start);
      end = p;
      c2 = { x: p.x + u.x * pull, y: p.y + u.y * pull };
    }
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

/**
 * Where a board opens: on its busiest stretch, so the first thing seen is
 * the work rather than empty canvas.
 *
 * A screen-sized window is put over each block in turn; the one holding the
 * most blocks wins, the nearest the middle of the whole board on a tie, and
 * the view is centred on the blocks inside it. A board that fits on the
 * screen is simply centred. `screen` is the canvas in pixels; the window is
 * that at `zoom`. Nothing on the board: nothing to centre on.
 */
export function busiestView(rects: Rect[], screen: { width: number; height: number }, zoom: number): { x: number; y: number; zoom: number } | null {
  if (rects.length === 0 || !screen.width || !screen.height) return null;
  const centres = rects.map((r) => ({ x: r.x + r.w / 2, y: r.y + r.h / 2 }));
  const mid = {
    x: centres.reduce((sum, c) => sum + c.x, 0) / centres.length,
    y: centres.reduce((sum, c) => sum + c.y, 0) / centres.length,
  };
  const half = { w: screen.width / zoom / 2, h: screen.height / zoom / 2 };
  const inside = (c: { x: number; y: number }) =>
    rects.filter((_, j) => Math.abs(centres[j].x - c.x) <= half.w && Math.abs(centres[j].y - c.y) <= half.h);
  let best: Rect[] = [];
  let bestFromMid = Infinity;
  for (const c of centres) {
    const held = inside(c);
    const fromMid = Math.hypot(c.x - mid.x, c.y - mid.y);
    if (held.length > best.length || (held.length === best.length && fromMid < bestFromMid)) {
      best = held;
      bestFromMid = fromMid;
    }
  }
  const minX = Math.min(...best.map((r) => r.x));
  const minY = Math.min(...best.map((r) => r.y));
  const maxX = Math.max(...best.map((r) => r.x + r.w));
  const maxY = Math.max(...best.map((r) => r.y + r.h));
  // Centred where it fits; where it does not, its top-left corner shows, a
  // margin in, rather than its middle with the start of it off the screen.
  const margin = 40 / zoom;
  const along = (lo: number, hi: number, halfSpan: number) => (hi - lo <= 2 * (halfSpan - margin) ? (lo + hi) / 2 : lo - margin + halfSpan);
  const focus = { x: along(minX, maxX, half.w), y: along(minY, maxY, half.h) };
  return { zoom, x: screen.width / 2 - focus.x * zoom, y: screen.height / 2 - focus.y * zoom };
}
