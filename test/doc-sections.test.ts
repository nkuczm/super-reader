import test from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { documentOrder, live, put, type Board, type BoxItem } from "../lib/subjects";
import { fileUnder, headerOf, insertAfter, sectionOf, splitAtHeadings } from "../lib/doc-sections";

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
