import test from "node:test";
import assert from "node:assert/strict";
import { edgePath, layoutBoard, settle, GAP, type Rect } from "../lib/board-layout";

function clear(rects: Rect[]) {
  for (let i = 0; i < rects.length; i += 1) {
    for (let j = i + 1; j < rects.length; j += 1) {
      const a = rects[i];
      const b = rects[j];
      const apart = a.x + a.w <= b.x || b.x + b.w <= a.x || a.y + a.h <= b.y || b.y + b.h <= a.y;
      assert.ok(apart, `${JSON.stringify(a)} overlaps ${JSON.stringify(b)}`);
    }
  }
}

test("cards taller than a row never land on the card below", () => {
  const nodes = Array.from({ length: 6 }, (_, i) => ({
    id: `c${i}`, placed: false, x: (i % 2) * 324, y: 0, w: 300, h: 180 + i * 90,
  }));
  clear([...layoutBoard(nodes).values()]);
});

test("placed cards that grew into each other are pulled apart, downwards", () => {
  const laid = layoutBoard([
    { id: "a", placed: true, x: 0, y: 0, w: 300, h: 500 },
    { id: "b", placed: true, x: 40, y: 200, w: 300, h: 200 },
    { id: "free", placed: false, x: 0, y: 0, w: 300, h: 100 },
  ]);
  clear([...laid.values()]);
  assert.equal(laid.get("a")!.y, 0, "the first card stays put");
  assert.equal(laid.get("b")!.y, 500 + GAP);
});

test("a card dropped on another lands just below it", () => {
  const landed = settle({ x: 10, y: 10, w: 300, h: 100 }, [{ x: 0, y: 0, w: 300, h: 250 }]);
  assert.equal(landed.y, 250 + GAP);
});

test("lines leave from the facing sides, not through the middle", () => {
  const { d } = edgePath({ x: 0, y: 0, w: 300, h: 200 }, { x: 400, y: 0, w: 300, h: 200 });
  assert.match(d, /^M300 100 /, "starts at the right edge of the left card");
  assert.match(d, / 400 100$/, "ends at the left edge of the right card");
});
