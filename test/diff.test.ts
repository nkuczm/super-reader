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

/** Old text and new text, read back off a diff. */
const sides = (d: { kind: string; text: string }[]) => ({
  was: d.filter((p) => p.kind !== "ins").map((p) => p.text).join(""),
  now: d.filter((p) => p.kind !== "del").map((p) => p.text).join(""),
});
/** The diff as markup, for reading in an assertion. */
const shown = (d: { kind: string; text: string }[]) => d.map((p) => (p.kind === "del" ? `[-${p.text}-]` : p.kind === "ins" ? `{+${p.text}+}` : p.text)).join("");

test("a rewritten phrase reads as the old phrase, then the new, not word by word", () => {
  const a = "The council said the plan was cheap and quick to build, officials added.";
  const b = "The council said the scheme was costly and slow to build, officials added.";
  const d = wordDiff(a, b);
  assert.deepEqual(sides(d), { was: a, now: b });
  assert.equal(shown(d), "The council said the [-plan was cheap and quick-]{+scheme was costly and slow+} to build, officials added.");
});

test("a sentence mostly rewritten is shown whole: old sentence, then new", () => {
  const a = "Prices rose sharply in March. The bank held rates.";
  const b = "Costs fell slightly over April. The bank held rates.";
  const d = wordDiff(a, b);
  assert.deepEqual(sides(d), { was: a, now: b });
  assert.equal(shown(d), "[-Prices rose sharply in March.-]{+Costs fell slightly over April.+} The bank held rates.");
});

test("separate small edits far apart in a sentence stay separate", () => {
  const a = "In 2004 the firm, which then had ten staff and one office in Leeds, began trading.";
  const b = "In 2005 the firm, which then had ten staff and one office in York, began trading.";
  assert.equal(shown(wordDiff(a, b)), "In [-2004-]{+2005+} the firm, which then had ten staff and one office in [-Leeds-]{+York+}, began trading.");
});

test("no change ever alternates old and new words: each change is one deletion then one insertion", () => {
  const pairs = [
    ["the quick brown fox jumps over the lazy dog", "a slow red fox leaps across the sleepy cat"],
    ["One two three four five six seven eight.", "One 2 three 4 five 6 seven 8."],
    ["Keep this. Change that bit here. Keep this too.", "Keep this. Alter the piece there. Keep this too."],
  ];
  for (const [a, b] of pairs) {
    const d = wordDiff(a, b);
    assert.deepEqual(sides(d), { was: a, now: b });
    for (let k = 1; k < d.length; k++) {
      assert.ok(!(d[k - 1].kind === "ins" && d[k].kind === "del"), `insertion then deletion in ${shown(d)}`);
      assert.notEqual(d[k - 1].kind, d[k].kind);
    }
  }
});

test("the summary still counts only the words that changed", () => {
  const s = diffSummary([["The plan was cheap and quick to build."]], [["The scheme was costly and slow to build."]]);
  assert.deepEqual({ added: s.added, removed: s.removed }, { added: 3, removed: 3 });
});
