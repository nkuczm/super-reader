import test from "node:test";
import assert from "node:assert/strict";
import { NODE_FONT_MAX, NODE_FONT_MIN, nodeFontSize, wrapWords } from "../lib/node-fit";

test("a short name keeps the full size", () => {
  assert.equal(nodeFontSize("Housing", 170), NODE_FONT_MAX);
});

test("a longer name wraps and shrinks only as far as it must", () => {
  const size = nodeFontSize("City council housing vote and the tenant response", 170);
  assert.ok(size < NODE_FONT_MAX && size >= NODE_FONT_MIN, String(size));
});

test("a very long name stops shrinking at the floor", () => {
  const long = "A very long node name that keeps going and going well past anything that could fit inside the circle at a readable size, and then goes on some more for good measure";
  assert.equal(nodeFontSize(long, 170), NODE_FONT_MIN);
});

test("a bigger circle gives the same name bigger type", () => {
  const name = "Interviews with residents of the east side about the rezoning plan";
  assert.ok(nodeFontSize(name, 300) > nodeFontSize(name, 170));
});

test("words wrap whole, and only a word wider than the line is broken", () => {
  assert.deepEqual(wrapWords("tenant groups vow to fight", 12), ["tenant", "groups vow", "to fight"]);
  assert.deepEqual(wrapWords("supercalifragilistic", 8), ["supercal", "ifragili", "stic"]);
});
