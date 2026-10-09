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

test("synced HTML keeps a quote link by id, a web link as a plain link, and nothing else", () => {
  // A quote never takes an href; a writer's own link is kept only as a web
  // address that opens apart from the app.
  assert.equal(
    sanitizeRichText('<a data-quote="q1" href="javascript:x">“hi”</a><a href="https://evil">x</a><a href="data:text/html,1">y</a>'),
    '<a data-quote="q1">“hi”</a><a href="https://evil/" target="_blank" rel="noopener noreferrer">x</a>y',
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

test("a LinkedIn link is tidied, and anything else refused", async () => {
  const { cleanLinkedIn } = await import("../lib/subjects");
  assert.equal(cleanLinkedIn("linkedin.com/in/ann-lee/"), "https://www.linkedin.com/in/ann-lee");
  assert.equal(cleanLinkedIn("https://uk.linkedin.com/in/ann"), "https://www.linkedin.com/in/ann");
  assert.equal(cleanLinkedIn("https://evil.example/linkedin.com/in/x"), null);
  assert.equal(cleanLinkedIn("javascript:alert(1)"), null);
});

test("a writer's links survive sanitising, script addresses do not", async () => {
  const { sanitizeRichText } = await import("../lib/subjects");
  assert.equal(
    sanitizeRichText('<p><a href="https://example.com/a?b=1&amp;c=2" onclick="x()">site</a></p>'),
    '<p><a href="https://example.com/a?b=1&amp;c=2" target="_blank" rel="noopener noreferrer">site</a></p>',
  );
  assert.equal(sanitizeRichText('<a href="javascript:alert(1)">x</a>'), "x");
  assert.equal(sanitizeRichText('<a data-quote="q1" href="https://e.com">q</a>'), '<a data-quote="q1">q</a>');
});

test("Highlight on a highlighted passage takes it off; elsewhere it marks", async () => {
  const { toggleHighlight, highlightsFor } = await import("../lib/highlights");
  let h = toggleHighlight({}, "https://a.example/s", "quick brown fox", 1);
  assert.equal(highlightsFor(h, "https://a.example/s").length, 1);
  // Selecting part of it, or the passage around it, removes it.
  h = toggleHighlight(h, "https://a.example/s?utm_source=x", "brown", 2);
  assert.equal(highlightsFor(h, "https://a.example/s").length, 0);
  h = toggleHighlight(h, "https://a.example/s", "lazy dog", 3);
  assert.equal(highlightsFor(h, "https://a.example/s").length, 1);
});

test("an embedded picture keeps the width it was sized to, and nothing else", async () => {
  const { sanitizeRichText } = await import("../lib/subjects");
  assert.equal(
    sanitizeRichText('<p><img data-embed="box1" data-w="320" src="data:image/png;base64,AAAA" style="width:320px" onerror="x()"></p>'),
    '<p><img data-embed="box1" data-w="320"></p>',
  );
  assert.equal(sanitizeRichText('<img data-embed="box1" data-w="99999">'), '<img data-embed="box1">');
});

test("sanitizeRichText keeps a checklist and its ticks, nothing else", async () => {
  const { sanitizeRichText } = await import("../lib/subjects");
  assert.equal(
    sanitizeRichText(`<ul data-check="" onclick="x"><li data-checked="true" style="a">done</li><li data-checked="false">todo</li></ul>`),
    `<ul data-check=""><li data-checked="true">done</li><li>todo</li></ul>`,
  );
});

test("youtubeThumbnail reads the video id from every link shape", async () => {
  const { youtubeThumbnail } = await import("../lib/subjects");
  const t = "https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg";
  assert.equal(youtubeThumbnail("https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=30s"), t);
  assert.equal(youtubeThumbnail("https://youtu.be/dQw4w9WgXcQ?si=x"), t);
  assert.equal(youtubeThumbnail("https://m.youtube.com/shorts/dQw4w9WgXcQ"), t);
  assert.equal(youtubeThumbnail("https://www.youtube.com/embed/dQw4w9WgXcQ"), t);
  assert.equal(youtubeThumbnail("https://www.youtube.com/channel/UC123"), null);
  assert.equal(youtubeThumbnail("https://example.com/watch?v=dQw4w9WgXcQ"), null);
});

test("documentOrder puts each section's linked blocks under its header", async () => {
  const { documentOrder } = await import("../lib/subjects");
  const board = {
    p1: { id: "p1", kind: "pos", target: "b", x: 0, y: 300, w: 300, at: 1 },
    p2: { id: "p2", kind: "pos", target: "a", x: 0, y: 100, w: 300, at: 1 },
    l1: { id: "l1", kind: "link", from: "H", to: "a", at: 1 },
    l2: { id: "l2", kind: "link", from: "b", to: "H", at: 1 },
  } as never;
  const order = documentOrder(
    [{ id: "a", at: 1 }, { id: "b", at: 2 }, { id: "x", at: 3 }, { id: "H", at: 4, label: true }],
    board,
  );
  assert.deepEqual(order, ["x", "H", "a", "b"]);
});

test("text pasted from Google Docs keeps its bold, not a highlight", async () => {
  const { sanitizeRichText } = await import("../lib/subjects");
  const docs = '<meta charset="utf-8"><b style="font-weight:normal;" id="docs-internal-guid-1"><p dir="ltr"><span style="font-size:11pt;background-color:transparent;font-weight:700;">Name</span><span style="background-color:transparent;font-weight:400;"> plain</span><span style="background-color:#ffff00;"> lit</span></p></b>';
  assert.equal(sanitizeRichText(docs), "<p><b>Name</b> plain<mark> lit</mark></p>");
});

test("transcript comments collect as bullets on one linked card beside it", async () => {
  const { addTranscriptNote, live } = await import("../lib/subjects");
  const start = { "pos:t1": { id: "pos:t1", kind: "pos", target: "t1", x: 100, y: 50, w: 400, at: 1 } } as never;
  const one = addTranscriptNote(start, "t1", "<i>“hello”</i> — first", "n1", 2);
  const two = addTranscriptNote(one, "t1", "<i>“bye”</i> — second", "n2", 3);
  const notes = live(two).filter((i) => i.kind === "box");
  assert.equal(notes.length, 1);
  assert.equal((notes[0] as { html: string }).html, "<ul><li><i>“hello”</i> — first</li><li><i>“bye”</i> — second</li></ul>");
  assert.ok(live(two).some((i) => i.kind === "link"));
  assert.deepEqual([(two as Record<string, { x: number }>)["pos:n1"].x], [560]);
});

test("documentOrder puts a story pasted into a block right below it", async () => {
  const { documentOrder } = await import("../lib/subjects");
  const order = documentOrder(
    [
      { id: "a", at: 1 },
      { id: "b", at: 2 },
      { id: "c", at: 3 },
      { id: "s1", at: 4, after: "a" },
      { id: "s2", at: 5, after: "a" },
      { id: "s3", at: 6, after: "s1" },
      // Its block is gone (another tab, deleted): it reads where it was added.
      { id: "lost", at: 7, after: "gone" },
      // A loop has no way in: both read where they were added.
      { id: "x", at: 8, after: "y" },
      { id: "y", at: 9, after: "x" },
    ],
    {},
  );
  assert.deepEqual(order, ["a", "s1", "s3", "s2", "b", "c", "lost", "x", "y"]);
});

test("a story added from a pasted link remembers the block it was pasted into", () => {
  const board = addStory({}, { link: "https://example.com/a-story", title: "A story", after: "box1" }, 10);
  const [card] = cardsOf({ id: "n", name: "n", entries: [], at: 0 } as never, board);
  assert.equal(card.after, "box1");
});

test("madeAt reads a block's making time from its id, not its last edit", async () => {
  const { madeAt, newItemId } = await import("../lib/subjects");
  const before = Date.now();
  const id = newItemId("box");
  assert.ok(Math.abs(madeAt({ id, at: before + 60_000 }) - before) < 1000);
  // Ids without a time in them keep their own `at`.
  assert.equal(madeAt({ id: "b1", at: 42 }), 42);
});

test("a story put back after deletion keeps its place in the document", () => {
  const board = put({}, { id: "story:https://e.com/x", kind: "story", link: "https://e.com/x", title: "X", since: 5, at: 900 } as never, 900);
  const [card] = cardsOf({ id: "n", name: "n", entries: [], at: 0 } as never, board);
  assert.equal(card.at, 5);
});

test("lettered and numbered lists keep their kind and where they count from", () => {
  assert.equal(sanitizeRichText('<ol type="a"><li>x</li></ol>'), '<ol type="a"><li>x</li></ol>');
  assert.equal(sanitizeRichText('<ol type="A" start="3"><li>x</li></ol>'), '<ol type="A" start="3"><li>x</li></ol>');
  assert.equal(sanitizeRichText('<ol start="4" onclick="x"><li>x</li></ol>'), '<ol start="4"><li>x</li></ol>');
  assert.equal(sanitizeRichText('<ol type="i"><li>x</li></ol>'), "<ol><li>x</li></ol>");
});

test("an outlet's own name replaces the address a pasted story was first named by", async () => {
  const { cardInfoId } = await import("../lib/subjects");
  let board = addStory({}, { link: "https://citypaper.example/a", title: "A", source: "citypaper.example" }, 1);
  board = put(board, { id: cardInfoId("https://citypaper.example/a"), kind: "cardinfo", card: "https://citypaper.example/a", source: "City Paper", at: 2 } as never, 2);
  assert.equal(cardsOf({ id: "n", name: "n", entries: [], at: 0 } as never, board)[0].source, "City Paper");
  // A real outlet name stays.
  let named = addStory({}, { link: "https://x.example/b", title: "B", source: "The Times" }, 1);
  named = put(named, { id: cardInfoId("https://x.example/b"), kind: "cardinfo", card: "https://x.example/b", source: "x.example", at: 2 } as never, 2);
  assert.equal(cardsOf({ id: "n", name: "n", entries: [], at: 0 } as never, named)[0].source, "The Times");
});

test("a story set into writing as a card survives sanitising, and is found there", async () => {
  const { inlineCardLinks } = await import("../lib/cite");
  const html = sanitizeRichText('<ul><li><a data-cite="card" href="https://e.com/a?utm_source=x" title="A story" contenteditable="false" data-by="E · Jo" onclick="x">A story</a></li></ul>');
  assert.equal(html, '<ul><li><a data-cite="card" href="https://e.com/a?utm_source=x" title="A story" contenteditable="false" target="_blank" rel="noopener noreferrer">A story</a></li></ul>');
  assert.deepEqual(inlineCardLinks(html), ["https://e.com/a"]);
});

test("a list typed as 1) or A) keeps its parenthesis", () => {
  assert.equal(sanitizeRichText('<ol data-mark="paren"><li>x</li></ol>'), '<ol data-mark="paren" data-kind="1"><li>x</li></ol>');
  assert.equal(sanitizeRichText('<ol type="A" start="2" data-mark="paren" data-kind="A"><li>x</li></ol>'), '<ol type="A" start="2" data-mark="paren" data-kind="A"><li>x</li></ol>');
  // What the screen works out for itself is not saved.
  assert.equal(sanitizeRichText('<ol data-kind="a"><li data-b="" data-hl="">x</li></ol>'), "<ol><li>x</li></ol>");
});
