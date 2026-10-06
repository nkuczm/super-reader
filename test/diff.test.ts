import test from "node:test";
import assert from "node:assert/strict";
import { alignRows, diffSummary, wordDiff } from "../lib/diff";

test("a word diff keeps the text, marking what went and what came", () => {
  const d = wordDiff("The firm began in 2004 with ten staff.", "The firm began in 2005 with ten staff.");
  assert.deepEqual(d.filter((p) => p.kind !== "same"), [{ kind: "del", text: "2004" }, { kind: "ins", text: "2005" }]);
  assert.equal(d.filter((p) => p.kind !== "del").map((p) => p.text).join(""), "The firm began in 2005 with ten staff.");
  assert.equal(d.filter((p) => p.kind !== "ins").map((p) => p.text).join(""), "The firm began in 2004 with ten staff.");
});

test("rows line up: unchanged, edited, added and removed", () => {
  const a = [["Visual", "Words"], ["Drone", "Intro line"], ["CEO", "Old quote"], ["Gone", "Cut this"]];
  const b = [["Visual", "Words"], ["Drone", "Intro line"], ["New shot", "A new line"], ["CEO", "New quote"]];
  const kinds = alignRows(a, b).map((p) => p.kind);
  assert.deepEqual(kinds.slice(0, 2), ["same", "same"]);
  assert.equal(kinds.filter((k) => k === "changed").length, 2);
  const s = diffSummary(a, b);
  assert.ok(s.added > 0 && s.removed > 0);
});

test("a row added at the end and one removed from the middle", () => {
  const a = [["a"], ["b"], ["c"]];
  const b = [["a"], ["c"], ["d"]];
  assert.deepEqual(alignRows(a, b), [
    { kind: "same", a: 0, b: 0 }, { kind: "removed", a: 1 }, { kind: "same", a: 2, b: 1 }, { kind: "added", b: 2 },
  ]);
  assert.deepEqual(diffSummary(a, b), { added: 1, removed: 1, rowsAdded: 1, rowsRemoved: 1 });
});

test("punctuation is its own token: adding ', wide' leaves the word alone", () => {
  assert.deepEqual(wordDiff("Office exterior", "Office exterior, wide").filter((p) => p.kind !== "same"), [{ kind: "ins", text: ", wide" }]);
});
