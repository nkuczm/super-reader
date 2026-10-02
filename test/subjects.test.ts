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

test("a card's quotes are bullets in its document, linked by id, never re-added once there", async () => {
  const { composeCardDoc, quoteIdsIn, withoutQuotes } = await import("../lib/subjects");
  const quotes = [{ id: "q1", text: "one " }, { id: "q2", text: "two" }];
  const fresh = composeCardDoc("<p>my thought</p>", quotes);
  assert.equal(fresh, '<ul><li><a data-quote="q1">“one”</a></li><li><a data-quote="q2">“two”</a></li></ul><p>my thought</p>');

  // Edited words stay edited; a new quote joins the same list.
  const edited = fresh.replace("“one”", "“one, shortened”");
  const next = composeCardDoc(edited, [...quotes, { id: "q3", text: "three" }]);
  assert.match(next, /one, shortened/);
  assert.match(next, /<li><a data-quote="q3">“three”<\/a><\/li><\/ul><p>my thought/);
  assert.deepEqual([...quoteIdsIn(next)], ["q1", "q2", "q3"]);
  assert.equal(withoutQuotes(next), "<ul></ul><p>my thought</p>");
});

test("synced HTML keeps a quote link by id and drops any real href", () => {
  assert.equal(
    sanitizeRichText('<a data-quote="q1" href="javascript:x">“hi”</a><a href="https://evil">x</a>'),
    '<a data-quote="q1">“hi”</a>x',
  );
});

test("addQuoteNote nests the note under its quote, and joins a second note to it", async () => {
  const { addQuoteNote, cardsOf, composeCardDoc } = await import("../lib/subjects");
  const q = (id: string, text: string) =>
    ({ id, kind: "quote", text, link: "https://a.example/s", articleTitle: "S", at: 1 }) as never;
  const note = { id: "n", name: "N", at: 1, entries: [q("q1", "First"), q("q2", "Second")] };
  let board = addQuoteNote(note, {}, "q1", "<ul><li>why it matters<ul><li>deeper</li></ul></li></ul>", 5);
  board = addQuoteNote(note, board, "q1", "<ul><li>another</li></ul>", 6);
  board = addQuoteNote(note, board, "q2", "<ul><li><br></li></ul>", 7);
  const card = cardsOf(note, board)[0];
  const doc = composeCardDoc(card.note, card.quotes);
  assert.equal(
    doc,
    '<ul><li><a data-quote="q1">“First”</a><ul><li>why it matters<ul><li>deeper</li></ul></li><li>another</li></ul></li><li><a data-quote="q2">“Second”</a></li></ul>',
  );
});

test("contacts from a run keep what the reader did with them", async () => {
  const { applySynthesis, contactsOf, contactId, put, bylineOf } = await import("../lib/subjects");
  const input = { subject: "S", cards: [{ id: "https://a.example/s", title: "S", quotes: [], note: "" }], boxes: [], known: [] };
  const found = (name: string, extra = {}) => ({ name, role: "Mayor", why: "Signed it", refs: ["https://a.example/s", "bogus"], origin: "story" as const, ...extra });
  let board = applySynthesis({}, input, { insights: [], suggestions: [], contacts: [found("Jane Doe"), found("Sam Roe", { origin: "suggested" })] }, 1);
  const jane = board[contactId("Jane Doe")];
  assert.ok(jane && jane.kind === "contact");
  assert.deepEqual(jane.refs, ["https://a.example/s"]);
  board = put(board, { ...jane, phone: "555 0100", state: "kept" }, 2);
  const sam = board[contactId("Sam Roe")];
  assert.ok(sam && sam.kind === "contact");
  board = put(board, { ...sam, state: "dismissed" }, 2);
  board = applySynthesis(board, input, { insights: [], suggestions: [], contacts: [found("Jane Doe", { email: "jane@city.gov" }), found("Sam Roe")] }, 3);
  const after = contactsOf(board);
  assert.deepEqual(after.map((c) => c.name), ["Jane Doe"]);
  assert.equal(after[0].phone, "555 0100");
  assert.equal(after[0].email, "jane@city.gov");
  assert.equal(after[0].emailFrom, "story");
  assert.equal(bylineOf({ publishedAt: "2026-09-30T12:00:00Z", author: "Ann Lee", source: "Wire" }), "Sep 30, 2026 · Ann Lee · Wire");
  assert.equal(bylineOf({ author: "Wire", source: "Wire" }), "Wire");
});

test("quotes stay top-level bullets, even when added after a note under the last quote", async () => {
  const { composeCardDoc } = await import("../lib/subjects");
  const q = (id: string) => ({ id, text: id });
  const noted = '<ul><li><a data-quote="a">“a”</a><ul><li>my note</li></ul></li></ul>';
  assert.equal(
    composeCardDoc(noted, [q("a"), q("b")]),
    '<ul><li><a data-quote="a">“a”</a><ul><li>my note</li></ul></li><li><a data-quote="b">“b”</a></li></ul>',
  );
  // Already nested by the old behaviour: lifted back out, notes kept with their quote.
  const broken =
    '<ul><li><a data-quote="a">“a”</a><ul><li>BUNKER</li><li><a data-quote="b">“b”</a></li><li><a data-quote="c">“c”</a><ul><li>tf?</li></ul></li></ul></li></ul>';
  assert.equal(
    composeCardDoc(broken, [q("a"), q("b"), q("c")]),
    '<ul><li><a data-quote="a">“a”</a><ul><li>BUNKER</li></ul></li><li><a data-quote="b">“b”</a></li><li><a data-quote="c">“c”</a><ul><li>tf?</li></ul></li></ul>',
  );
});

test("a bot-check page is not an article, and a story's address gives a fallback title", async () => {
  const { isChallengePage } = await import("../lib/article");
  const { titleFromUrl } = await import("../lib/manual");
  assert.ok(isChallengePage("Client Challenge", "A required part of this site couldn’t load."));
  assert.ok(isChallengePage("Just a moment...", ""));
  assert.ok(isChallengePage("", "Please verify you are a human to continue."));
  assert.ok(!isChallengePage("Will Zuckerberg redeem himself?", "x".repeat(4000) + " verify you are human"));
  assert.equal(
    titleFromUrl("https://www.sfgate.com/hawaii/article/Will-Facebook-Mark-Zuckerberg-Kauai-redeem-himself-16841643.php"),
    "Will Facebook Mark Zuckerberg Kauai redeem himself",
  );
  assert.equal(titleFromUrl("https://example.com/"), null);
});

test("the notes under a quote come back as lines for the article's margin", async () => {
  const { quoteNotesFor, put, cardNoteId } = await import("../lib/subjects");
  const now = Date.now();
  const note = { id: "n", name: "N", at: now, entries: [{ id: "q1", kind: "quote", text: "First", link: "https://a.example/s", articleTitle: "S", at: now }] } as never;
  const board = put({}, {
    id: cardNoteId("https://a.example/s"), kind: "cardnote", card: "https://a.example/s",
    html: '<ul><li><a data-quote="q1">“First”</a><ul><li>Why &amp; how<ul><li>deeper</li></ul></li></ul></li></ul>', at: now,
  });
  assert.deepEqual(quoteNotesFor(note, board, "q1"), ["Why & how", "  deeper"]);
});

test("a story's byline gives its authors as contacts, outlets and desks aside", async () => {
  const { authorsOf } = await import("../lib/subjects");
  const found = authorsOf([
    { id: "a", author: "By Ann Lee and Sam Roe", source: "Wire" },
    { id: "b", author: "Ann Lee", source: "Wire" },
    { id: "c", author: "Reuters Staff", source: "Reuters" },
    { id: "d", author: "Wire", source: "Wire" },
  ]);
  assert.deepEqual(found, [{ name: "Ann Lee", refs: ["a", "b"] }, { name: "Sam Roe", refs: ["a"] }]);
});
