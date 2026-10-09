import test from "node:test";
import assert from "node:assert/strict";
import { chainedLabelLinks, edgePath } from "../lib/board-layout";

const rects: Record<string, { x: number; y: number; w: number; h: number }> = {
  H: { x: 0, y: 0, w: 170, h: 170 },
  A: { x: 300, y: 0, w: 280, h: 120 },
  C: { x: 650, y: 0, w: 280, h: 120 },
  B: { x: 1000, y: 0, w: 280, h: 120 },
  D: { x: 0, y: 400, w: 280, h: 120 },
};
const isLabel = (id: string) => id === "H";
const place = (id: string) => rects[id];

test("cards chained to each other under one header are drawn through the chain, nearest first", () => {
  const links = [
    { id: "HA", from: "H", to: "A" }, { id: "HB", from: "H", to: "B" }, { id: "HD", from: "H", to: "D" },
    { id: "AC", from: "A", to: "C" }, { id: "CB", from: "C", to: "B" },
  ];
  // A and B are joined through C: only A, the nearer, keeps its line from H. D stands alone and keeps its own.
  assert.deepEqual([...chainedLabelLinks(links, isLabel, place)], ["HB"]);
});

test("cards under a header that are not joined to each other each keep their own line", () => {
  const links = [{ id: "HA", from: "H", to: "A" }, { id: "HB", from: "B", to: "H" }];
  assert.equal(chainedLabelLinks(links, isLabel, place).size, 0);
});

test("a path through another header does not count as a chain", () => {
  const links = [{ id: "HA", from: "H", to: "A" }, { id: "HB", from: "H", to: "B" }, { id: "AX", from: "A", to: "X" }, { id: "XB", from: "X", to: "B" }];
  assert.equal(chainedLabelLinks(links, (id) => id === "H" || id === "X", place).size, 0);
});

test("a line leaves a node's circle facing the other end, from any side", () => {
  const node = rects.H; // centre (85, 85), radius 85
  const start = (b: { x: number; y: number; w: number; h: number }) => {
    const m = edgePath(node, b, { a: true }).d.match(/^M(-?\d+) (-?\d+)/)!;
    return { x: Number(m[1]), y: Number(m[2]) };
  };
  const right = start(rects.A);
  assert.ok(Math.abs(Math.hypot(right.x - 85, right.y - 85) - 85) <= 1, "on the circle");
  assert.ok(right.x > 150, "towards the right");
  const below = start(rects.D);
  assert.ok(below.y > 150, "towards below");
  const aboveLeft = start({ x: -600, y: -500, w: 200, h: 100 });
  assert.ok(aboveLeft.x < 40 && aboveLeft.y < 40, "towards above-left");
});
