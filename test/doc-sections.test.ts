import test from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { documentOrder, live, put, type Board, type BoardItem, type BoxItem, type StoryItem } from "../lib/subjects";
import { closeGap, fileUnder, headerOf, insertAfter, moveSection, moveTargets, rechain, sectionOf, splitAtHeadings } from "../lib/doc-sections";

const { document } = new JSDOM("<!doctype html><body></body>").window;

const box = (id: string, at: number, extra: Partial<BoxItem> = {}): BoxItem => ({ id, kind: "box", html: "", at, ...extra });
const order = (board: Board) =>
  documentOrder(live(board).filter((i): i is BoxItem => i.kind === "box").map((b) => ({ id: b.id, at: b.at, label: b.label, sub: b.sub, after: b.after, before: b.before })), board);

test("filing a block under a header draws one line to it and takes away lines to other headers", () => {
  let board: Board = {};
  for (const b of [box("A", 1, { label: true }), box("B", 2, { label: true }), box("t", 3)]) board = put(board, b);
  board = fileUnder(board, "t", "A", 10);
  assert.equal(sectionOf(board, "t"), "A");
  board = fileUnder(board, "t", "B", 11);
  assert.equal(sectionOf(board, "t"), "B");
  assert.equal(live(board).filter((i) => i.kind === "link").length, 1);
  board = fileUnder(board, "t", null, 12);
  assert.equal(sectionOf(board, "t"), null);
});

test("a header written in after a block reads with its own writing under it", () => {
  let board: Board = {};
  board = put(board, box("intro", 1));
  board = put(board, box("H", 2, { label: true, after: "intro" }));
  board = put(board, box("body", 3, { after: "H" }));
  board = fileUnder(board, "body", "H", 4);
  board = put(board, box("more", 5));
  board = fileUnder(board, "more", "H", 6);
  assert.deepEqual(order(board), ["intro", "H", "body", "more"]);
});

test("a block put in after another goes straight below it, before what was there", () => {
  let board: Board = {};
  board = put(board, box("a", 1));
  board = put(board, box("c", 2, { after: "a" }));
  board = put(board, box("b", 3, { after: "a" }));
  board = insertAfter(board, "b", "a", 4);
  assert.deepEqual(order(board), ["a", "b", "c"]);
});

test("a text box's writing cut at its headings", () => {
  const split = splitAtHeadings("<p>Intro</p><h3>First</h3><p>One</p><p>Two</p><h3>Second</h3>", document);
  assert.deepEqual(split, { before: "<p>Intro</p>", pieces: [{ heading: "First" }, { html: "<p>One</p><p>Two</p>" }, { heading: "Second" }] });
  assert.equal(splitAtHeadings("<p>No headings</p>", document), null);
});

test("a subheader is filed under a header, its writing under it, and reads nested in the document", () => {
  let board: Board = {};
  for (const b of [box("H", 1, { label: true }), box("S", 2, { label: true, sub: true }), box("x", 3), box("y", 4), box("H2", 5, { label: true })]) board = put(board, b);
  board = fileUnder(board, "S", "H", 10);
  board = fileUnder(board, "x", "H", 11);
  board = fileUnder(board, "y", "S", 12);
  assert.equal(sectionOf(board, "y"), "S");
  assert.equal(headerOf(board, "y"), "H");
  assert.equal(headerOf(board, "S"), "H");
  // Writing straight under the header first, then the subheader with its own.
  assert.deepEqual(order(board), ["H", "x", "S", "y", "H2"]);
  // A subheader filed under its own writing's section resolves to the header; moved, it keeps its writing.
  board = fileUnder(board, "S", "H2", 13);
  assert.equal(headerOf(board, "S"), "H2");
  assert.equal(sectionOf(board, "y"), "S");
  assert.deepEqual(order(board), ["H", "x", "H2", "S", "y"]);
  // A header is never filed under anything.
  board = fileUnder(board, "H", "H2", 14);
  assert.equal(headerOf(board, "H"), "H");
});

test("an <h4> splits off as a subheading", () => {
  const split = splitAtHeadings("<p>Intro</p><h3>Top</h3><p>a</p><h4>Inner</h4><p>b</p>", document)!;
  assert.deepEqual(split.pieces, [{ heading: "Top" }, { html: "<p>a</p>" }, { heading: "Inner", sub: true }, { html: "<p>b</p>" }]);
});

test("a block put in above the first reads at the top, and what is written after it follows it", () => {
  let board: Board = {};
  for (const b of [box("H", 1, { label: true }), box("x", 2), box("top", 3, { before: "H" }), box("top2", 4, { after: "top" }), box("higher", 5, { before: "top" })]) board = put(board, b);
  board = fileUnder(board, "x", "H", 10);
  assert.deepEqual(order(board), ["higher", "top", "top2", "H", "x"]);
  // The block it read above gone: it still reads first.
  board = { ...board, H: { ...board.H, deleted: true } as BoxItem };
  assert.deepEqual(order(board).slice(0, 3), ["higher", "top", "top2"]);
});

test("a header put in above the first block takes the writing below it and reads first, with all of it", () => {
  let board: Board = {};
  for (const b of [box("a", 1), box("b", 2), box("H2", 3, { label: true }), box("c", 4), box("H", 5, { label: true, before: "a" })]) board = put(board, b);
  board = fileUnder(board, "c", "H2", 10);
  board = fileUnder(board, "a", "H", 11);
  board = fileUnder(board, "b", "H", 12);
  assert.deepEqual(order(board), ["H", "a", "b", "H2", "c"]);
  // A subheader put in there the same way.
  let sub: Board = {};
  for (const b of [box("a", 1), box("S", 2, { label: true, sub: true, before: "a" })]) sub = put(sub, b);
  sub = fileUnder(sub, "a", "S", 10);
  assert.deepEqual(order(sub), ["S", "a"]);
});

test("nothing is left out of the document, whatever its blocks say about each other", () => {
  let board: Board = {};
  // A block reading before one that reads after it: neither placed the ordinary way.
  for (const b of [box("x", 1, { before: "y" }), box("y", 2, { after: "x" }), box("z", 3)]) board = put(board, b);
  assert.deepEqual([...order(board)].sort(), ["x", "y", "z"]);
});

/** A document written top to bottom: each block after the one before it, filed under the header above it. */
function written(blocks: [string, Partial<BoxItem>?][]): Board {
  let board: Board = {};
  let prev: string | undefined;
  let header: string | null = null;
  let section: string | null = null;
  blocks.forEach(([id, extra = {}], i) => {
    board = put(board, box(id, i + 1, { ...extra, ...(prev ? { after: prev } : {}) }), i + 1);
    if (extra.label && !extra.sub) header = section = id;
    else if (extra.label) {
      board = fileUnder(board, id, header, 100 + i);
      section = id;
    } else board = fileUnder(board, id, section, 100 + i);
    prev = id;
  });
  return board;
}

test("a header moves with its writing and its subheaders, and nothing else changes section", () => {
  const board = written([["H1", { label: true }], ["a"], ["S1", { label: true, sub: true }], ["s"], ["H2", { label: true }], ["b"]]);
  const now = order(board);
  assert.deepEqual(now, ["H1", "a", "S1", "s", "H2", "b"]);
  const up = moveSection(board, now, "H2", "H1", 500)!;
  assert.deepEqual(order(up), ["H2", "b", "H1", "a", "S1", "s"]);
  assert.equal(sectionOf(up, "b"), "H2");
  assert.equal(sectionOf(up, "s"), "S1");
  assert.equal(headerOf(up, "S1"), "H1");
  const down = moveSection(board, now, "H1", null, 500)!;
  assert.deepEqual(order(down), ["H2", "b", "H1", "a", "S1", "s"]);
  // Put back where it was: nothing to do.
  assert.equal(moveSection(board, now, "H2", null, 500), null);
});

test("a subheader moves to another header's section and is filed under it", () => {
  const board = written([["H1", { label: true }], ["a"], ["S1", { label: true, sub: true }], ["s"], ["H2", { label: true }], ["b"]]);
  const now = order(board);
  assert.deepEqual(moveTargets(board, now, "S1"), ["H2", null]);
  assert.deepEqual(moveTargets(board, now, "H2"), ["H1", null]);
  const moved = moveSection(board, now, "S1", null, 500)!;
  assert.deepEqual(order(moved), ["H1", "a", "H2", "b", "S1", "s"]);
  assert.equal(headerOf(moved, "S1"), "H2");
  assert.equal(sectionOf(moved, "s"), "S1");
});

test("a header moved to the very top takes the writing that read under no header", () => {
  const board = written([["intro"], ["H1", { label: true }], ["a"], ["H2", { label: true }], ["b"]]);
  const now = order(board);
  assert.deepEqual(moveTargets(board, now, "H2"), ["intro", "H1", null]);
  const moved = moveSection(board, now, "H2", "intro", 500)!;
  assert.deepEqual(order(moved), ["H2", "b", "intro", "H1", "a"]);
  assert.equal(sectionOf(moved, "intro"), "H2");
});

test("sections laid out on the whiteboard, not written in order, move the same way", () => {
  let board: Board = {};
  for (const b of [box("H1", 1, { label: true }), box("H2", 2, { label: true }), box("a", 3), box("b", 4), box("c", 5)]) board = put(board, b, b.at);
  board = fileUnder(board, "a", "H1", 10);
  board = fileUnder(board, "b", "H2", 11);
  board = fileUnder(board, "c", "H2", 12);
  const now = order(board);
  assert.deepEqual(now, ["H1", "a", "H2", "b", "c"]);
  const moved = moveSection(board, now, "H2", "H1", 500)!;
  assert.deepEqual(order(moved), ["H2", "b", "c", "H1", "a"]);
});

test("a story's place is written without moving it in the feed", () => {
  let board: Board = {};
  board = put(board, box("a", 1));
  board = put(board, { id: "story:x.com/s", kind: "story", link: "https://x.com/s", title: "S", at: 7 } as BoardItem, 7);
  const next = rechain(board, ["a", "x.com/s"], 500);
  const story = next["story:x.com/s"] as StoryItem;
  assert.equal(story.after, "a");
  assert.equal(story.since, 7);
  assert.equal((next.a as BoxItem).after, undefined);
  // Only what changed is written.
  assert.equal(rechain(next, ["a", "x.com/s"], 600), next);
});

test("a block taken out of the document leaves what read after it where it was", () => {
  // Written out of order: b was put in after a later, and c after b.
  let board: Board = {};
  for (const b of [box("a", 1), box("c", 5, { after: "b" }), box("b", 3, { after: "a" }), box("z", 4)]) board = put(board, b, b.at);
  assert.deepEqual(order(board), ["a", "b", "c", "z"]);
  assert.deepEqual(order({ ...board, b: { ...board.b, deleted: true } as BoxItem }), ["a", "z", "c"]);
  const gone = new Set(["b"]);
  let next = closeGap(board, gone, 10);
  next = { ...next, b: { ...next.b, deleted: true } as BoxItem };
  assert.equal((next.c as BoxItem).after, "a");
  assert.deepEqual(order(next), ["a", "c", "z"]);
  // The first block taken: its follower takes its place, above what it read before.
  let top: Board = {};
  for (const b of [box("x", 1), box("t", 5, { before: "x" }), box("u", 6, { after: "t" })]) top = put(top, b, b.at);
  assert.deepEqual(order(top), ["t", "u", "x"]);
  let left = closeGap(top, new Set(["t"]), 10);
  left = { ...left, t: { ...left.t, deleted: true } as BoxItem };
  assert.deepEqual(order(left), ["u", "x"]);
});
