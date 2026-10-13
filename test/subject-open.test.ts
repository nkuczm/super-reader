import test from "node:test";
import assert from "node:assert/strict";
import { busiestView } from "../lib/board-layout";
import { lastOpened, markOpened, newSince } from "../lib/subject-seen";

const card = (x: number, y: number) => ({ x, y, w: 280, h: 160 });

test("a board opens on its busiest stretch, not its top-left corner", () => {
  // One stray card near the origin; a cluster of six far to the right and down.
  const rects = [card(0, 0), ...[0, 1, 2].flatMap((i) => [card(3000 + i * 300, 2000), card(3000 + i * 300, 2200)])];
  const view = busiestView(rects, { width: 1200, height: 800 }, 1)!;
  // The cluster's middle, 3000..3880 × 2000..2360, is at the middle of the screen.
  const middle = { x: (600 - view.x) / view.zoom, y: (400 - view.y) / view.zoom };
  assert.ok(Math.abs(middle.x - 3440) < 1 && Math.abs(middle.y - 2180) < 1, JSON.stringify(middle));
});

test("a board that fits on the screen is centred", () => {
  const rects = [card(100, 100), card(500, 300)];
  const view = busiestView(rects, { width: 1400, height: 900 }, 1)!;
  // Content 100..780 × 100..460: its middle (440, 280) at the screen's (700, 450).
  assert.deepEqual(view, { zoom: 1, x: 700 - 440, y: 450 - 280 });
});

test("a stretch taller than the screen shows its top, not its middle cut in half", () => {
  // A long column, evenly packed: every screenful is as busy, so the middle
  // of the board wins, and the top card of that stretch sits a margin down.
  const rects = Array.from({ length: 12 }, (_, i) => card(0, i * 200));
  const view = busiestView(rects, { width: 1200, height: 800 }, 1)!;
  const tops = rects.map((r) => r.y * view.zoom + view.y);
  assert.ok(tops.includes(40), tops.join(", "));
  assert.ok(view.y < 0, "the middle of the column, not its start");
});

test("an empty board has nothing to centre on", () => {
  assert.equal(busiestView([], { width: 1200, height: 800 }, 1), null);
});

test("the stories added since a subject was last open are new; the rest are not", () => {
  const cards = [{ id: "a", at: 100 }, { id: "b", at: 250 }, { id: "c", at: 300 }];
  assert.deepEqual([...newSince(cards, 200)], ["b", "c"]);
  assert.deepEqual([...newSince(cards, 400)], []);
});

test("opening a subject marks it seen on this device; one never opened counts from when tracking began", () => {
  const store = new Map<string, string>();
  (globalThis as { window?: unknown }).window = {
    localStorage: {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
    },
  };
  try {
    assert.equal(lastOpened("s1", 1000), 1000, "tracking begins now");
    assert.equal(lastOpened("s2", 5000), 1000, "a subject not yet opened counts from then");
    markOpened("s1", 2000);
    assert.equal(lastOpened("s1", 9000), 2000);
  } finally {
    delete (globalThis as { window?: unknown }).window;
  }
});
