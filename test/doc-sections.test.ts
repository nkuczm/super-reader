import test from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { documentOrder, live, put, type Board, type BoxItem } from "../lib/subjects";
import { fileUnder, insertAfter, sectionOf, splitAtHeadings } from "../lib/doc-sections";

const { document } = new JSDOM("<!doctype html><body></body>").window;

const box = (id: string, at: number, extra: Partial<BoxItem> = {}): BoxItem => ({ id, kind: "box", html: "", at, ...extra });
const order = (board: Board) =>
  documentOrder(live(board).filter((i): i is BoxItem => i.kind === "box").map((b) => ({ id: b.id, at: b.at, label: b.label, after: b.after })), board);

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
