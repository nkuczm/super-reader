import test from "node:test";
import assert from "node:assert/strict";
import {
  addStory,
  applySynthesis,
  cardsOf,
  mergeBoards,
  migrateNoteWriting,
  put,
  remove,
  sanitizeRichText,
  shouldAutoRun,
  signatureOf,
  slimBoardsForSync,
  synthesisInput,
  metaOf,
  type Board,
} from "../lib/subjects";
import type { Note } from "../lib/notes";

const note: Note = {
  id: "n1",
  name: "AI-created government",
  at: 1,
  entries: [
    { id: "q1", kind: "quote", text: "Labs agreed to write their own rules.", link: "https://a.com/story?utm_source=x", articleTitle: "Labs self-regulate", at: 10 },
    { id: "t1", kind: "text", text: "Compare with finance", at: 11 },
    { id: "q2", kind: "quote", text: "A board of five.", link: "https://a.com/story", articleTitle: "Labs self-regulate", at: 12 },
    { id: "q3", kind: "quote", text: "The board can veto launches.", link: "https://b.com/board", articleTitle: "Board structure", at: 13 },
  ],
};

test("one card per story, quotes gathered under it, tracking tags ignored", () => {
  const cards = cardsOf(note, {});
  assert.equal(cards.length, 2);
  assert.deepEqual(cards[0].quotes.map((q) => q.id), ["q1", "q2"]);
  assert.equal(cards[1].title, "Board structure");
});

test("a story added without a quote is a card, and adding it twice is one", () => {
  let board = addStory({}, { link: "https://c.com/x", title: "Third" }, 100);
  board = addStory(board, { link: "https://c.com/x", title: "Third" }, 200);
  const cards = cardsOf(note, board);
  assert.equal(cards.length, 3);
  assert.equal(cards[2].title, "Third");
});

test("boards merge item by item, the newer change winning, deletions included", () => {
  const base: Board = put({}, { id: "box1", kind: "box", html: "<p>a</p>", at: 0 }, 100);
  const phone = put(base, { id: "box1", kind: "box", html: "<p>phone</p>", at: 0 }, 300);
  const laptop = put(base, { id: "pos:box1", kind: "pos", target: "box1", x: 5, y: 6, w: 280, at: 0 }, 200);
  const merged = mergeBoards({ n1: phone }, { n1: laptop }, 400);
  assert.equal((merged.n1.box1 as { html: string }).html, "<p>phone</p>");
  assert.ok(merged.n1["pos:box1"]);

  const deleted = remove(phone, "box1", 500);
  const again = mergeBoards({ n1: laptop }, { n1: deleted }, 600);
  assert.equal(again.n1.box1.deleted, true);
});

test("old notes' writing comes onto the board once", () => {
  const once = migrateNoteWriting(note, {}, 100);
  const twice = migrateNoteWriting(note, once, 200);
  const boxes = Object.values(twice).filter((i) => i.kind === "box");
  assert.equal(boxes.length, 1);
  assert.match((boxes[0] as { html: string }).html, /Compare with finance/);
});

test("a run replaces the last run's insights and keeps decided suggestions decided", () => {
  const input = synthesisInput(note, {});
  let board = applySynthesis({}, input, {
    insights: [{ type: "connection", text: "Both lean on boards.", refs: [input.cards[0].id, input.cards[1].id, "made-up"] }],
    suggestions: [{ link: "https://d.com/new", title: "New", why: "fills a gap" }],
  }, 100);
  const first = Object.values(board).filter((i) => i.kind === "insight" && !i.deleted);
  assert.equal(first.length, 1);
  assert.equal((first[0] as { refs: string[] }).refs.length, 2, "an invented ref is dropped");

  const suggestion = Object.values(board).find((i) => i.kind === "suggest")!;
  board = put(board, { ...suggestion, state: "dismissed" } as typeof suggestion, 150);
  board = applySynthesis(board, synthesisInput(note, board), {
    insights: [{ type: "question", text: "Who audits?", refs: [] }],
    suggestions: [{ link: "https://d.com/new", title: "New", why: "again" }],
  }, 200);
  const live = Object.values(board).filter((i) => i.kind === "insight" && !i.deleted);
  assert.equal(live.length, 1);
  assert.equal((Object.values(board).find((i) => i.kind === "suggest") as { state: string }).state, "dismissed");
  assert.equal(metaOf(board).sig, signatureOf(synthesisInput(note, board)));
});

test("automatic runs need two stories, new material, and a gap", () => {
  const input = synthesisInput(note, {});
  assert.equal(shouldAutoRun(input, metaOf({}), 0), true);
  const ran = { ...metaOf({}), sig: signatureOf(input), ranAt: 0 };
  assert.equal(shouldAutoRun(input, ran, 10 ** 9), false, "nothing new");
  const one = synthesisInput({ ...note, entries: note.entries.slice(0, 1) }, {});
  assert.equal(shouldAutoRun(one, metaOf({}), 0), false);
});

test("synced HTML is cut down to formatting, never script", () => {
  const dirty = '<p onclick="x()">Hi <b>there</b><script>alert(1)</script><img src=x onerror=y> <span style="background-color: rgb(253, 230, 138);">lit</span><a href="javascript:x">link</a></p>';
  const clean = sanitizeRichText(dirty);
  assert.equal(clean, "<p>Hi <b>there</b> <mark>lit</mark>link</p>");
  assert.equal(sanitizeRichText("<ul><li>one<li>two</ul>"), "<ul><li>one<li>two</li></li></ul>");
});

test("the wire copy drops the AI's work first when over budget", () => {
  const board: Board = {};
  let b = put(board, { id: "box", kind: "box", html: "x".repeat(50), at: 0 }, 1);
  b = put(b, { id: "insight:1", kind: "insight", type: "question", text: "y".repeat(500), refs: [], run: "r", at: 0 }, 1);
  const slim = slimBoardsForSync({ n1: b }, 300);
  assert.ok(slim.n1.box);
  assert.equal(slim.n1["insight:1"], undefined);
});
