import test from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import {
  CARET_SPACE,
  END_SLOT,
  flowOf,
  foldFlow,
  foldIntoNote,
  readFlow,
  slotsOf,
} from "../lib/note-flow";
import type { NoteComment, NoteEntry, NoteQuote } from "../lib/notes";

const NOW = 1_800_000_000_000;

function quote(id: string, text = "what it said", at = NOW - 10_000): NoteQuote {
  return {
    id,
    kind: "quote",
    text,
    link: `https://example.com/${id}`,
    articleTitle: "A story",
    at,
  };
}

function line(id: string, text: string, at = NOW - 10_000): NoteComment {
  return { id, kind: "text", text, at };
}

/** The page as the editor would build it, in a DOM the reader could type in. */
function surfaceFor(entries: NoteEntry[]) {
  const dom = new JSDOM("<body><div id='flow'></div></body>");
  const doc = dom.window.document;
  const el = doc.getElementById("flow")!;
  for (const piece of flowOf(entries)) {
    if (piece.kind === "text") {
      const span = doc.createElement("span");
      span.textContent = piece.text || CARET_SPACE;
      el.append(span);
    } else {
      const chip = doc.createElement("span");
      chip.setAttribute("data-quote-id", piece.quote.id);
      chip.setAttribute("contenteditable", "false");
      const mark = doc.createElement("mark");
      mark.textContent = piece.quote.text;
      chip.append(mark);
      el.append(chip);
    }
  }
  return { doc, el };
}

/* ---------- laying the page out ---------- */

test("the writing and the quotes come out in the order they were written", () => {
  const entries = [
    line("t1", "Before it."),
    quote("q1"),
    line("t2", "After it."),
    quote("q2"),
  ];
  assert.deepEqual(
    flowOf(entries).map((piece) =>
      piece.kind === "text" ? `text:${piece.text}` : `quote:${piece.quote.id}`,
    ),
    ["text:Before it.", "quote:q1", "text:After it.", "quote:q2", "text:"],
  );
});

test("there is always a place to write before the first quote and after the last", () => {
  const pieces = flowOf([quote("q1")]);
  assert.deepEqual(pieces.map((p) => p.kind), ["text", "quote", "text"]);
  assert.equal(pieces.length, 3);
});

test("an empty note is one empty run of writing", () => {
  assert.deepEqual(flowOf([]), [{ kind: "text", text: "" }]);
});

test("lines from an older note, when each was its own entry, read as one run", () => {
  const slots = slotsOf([line("t1", "First"), line("t2", "Second"), quote("q1")]);
  assert.equal(slots.get("q1")?.text, "First\nSecond");
  // No single entry to keep faith with, so the next edit starts a fresh one.
  assert.equal(slots.get("q1")?.original, null);
});

/* ---------- reading the page back ---------- */

test("reads the quotes and the writing between them out of the page", () => {
  const { el } = surfaceFor([line("t1", "Before it."), quote("q1"), line("t2", "After.")]);
  assert.deepEqual(readFlow(el), {
    quoteIds: ["q1"],
    runs: ["Before it.", "After."],
  });
});

test("the caret's standing space is not part of what was written", () => {
  const { el } = surfaceFor([quote("q1"), quote("q2")]);
  const { runs } = readFlow(el);
  assert.deepEqual(runs, ["", "", ""]);
  assert.ok(!runs.join("").includes(CARET_SPACE));
});

test("a line break the browser drew as an element is still a line break", () => {
  const dom = new JSDOM("<body><div id='f'>one<br>two</div></body>");
  const el = dom.window.document.getElementById("f")!;
  assert.deepEqual(readFlow(el).runs, ["one\ntwo"]);
});

test("a quote the browser wrapped in something is still a quote", () => {
  // Some editing gestures leave the writing inside a block of the browser's
  // own making; a quote in there must not read as ordinary text.
  const dom = new JSDOM(
    `<body><div id='f'><div>before <span data-quote-id="q1"><mark>said</mark></span> after</div></div></body>`,
  );
  const el = dom.window.document.getElementById("f")!;
  assert.deepEqual(readFlow(el), { quoteIds: ["q1"], runs: ["before ", " after"] });
});

/* ---------- folding it back into the note ---------- */

test("opening a note and reading it straight back changes nothing at all", () => {
  const entries = [line("t1", "Before it."), quote("q1"), line("t2", "After it.")];
  const { el } = surfaceFor(entries);
  const { quoteIds, runs } = readFlow(el);

  const folded = foldFlow(entries, quoteIds, runs, NOW);
  assert.deepEqual(folded, entries);
  // The very same objects: nothing to stamp, nothing to sync.
  assert.equal(folded[0], entries[0]);
  assert.equal(folded[1], entries[1]);
  assert.equal(folded[2], entries[2]);
});

test("typing in a run edits that line rather than replacing it", () => {
  const entries = [quote("q1"), line("t1", "A thought")];
  const folded = foldFlow(entries, ["q1"], ["", "A thought, revised"], NOW);

  assert.deepEqual(folded.map((e) => e.id), ["q1", "t1"]);
  assert.equal((folded[1] as NoteComment).text, "A thought, revised");
  assert.equal((folded[1] as NoteComment).at, entries[1].at, "kept its own age");
  assert.equal((folded[1] as NoteComment).editedAt, NOW);
});

test("writing in front of a quote is kept in front of it", () => {
  const entries = [quote("q1")];
  const folded = foldFlow(entries, ["q1"], ["As the court put it: ", ""], NOW);
  assert.deepEqual(
    folded.map((e) => (e.kind === "quote" ? "quote" : e.text)),
    ["As the court put it: ", "quote"],
  );
});

test("writing between two quotes belongs to neither of them", () => {
  const entries = [quote("q1"), quote("q2")];
  const folded = foldFlow(entries, ["q1", "q2"], ["", " and then ", ""], NOW);
  assert.deepEqual(
    folded.map((e) => (e.kind === "quote" ? e.id : e.text)),
    ["q1", " and then ", "q2"],
  );
});

test("emptying a run takes the line out of the note", () => {
  const entries = [line("t1", "A thought"), quote("q1")];
  const folded = foldFlow(entries, ["q1"], ["   ", ""], NOW);
  assert.deepEqual(folded.map((e) => e.id), ["q1"]);
});

test("a quote taken out of the page is gone, and the writing closes over it", () => {
  const entries = [line("t1", "before "), quote("q1"), line("t2", "after")];
  // The chip removed; the two runs either side of it are now one.
  const folded = foldFlow(entries, [], ["before after"], NOW);

  assert.deepEqual(folded.map((e) => e.kind), ["text"]);
  assert.equal((folded[0] as NoteComment).text, "before after");
  // The quote's id is not in the result, so the note knows to bury it.
  assert.ok(!folded.some((entry) => entry.id === "q1"));
});

test("a quote is never rewritten by editing around it", () => {
  const entries = [quote("q1", "what the article said")];
  // Whatever the page claims the quote now says, the note keeps the original.
  const folded = foldFlow(entries, ["q1"], ["", ""], NOW);
  assert.equal((folded[0] as NoteQuote).text, "what the article said");
  assert.equal(folded[0], entries[0]);
});

test("a quote the note has never heard of is not invented", () => {
  const folded = foldFlow([quote("q1")], ["q1", "unknown"], ["", "", ""], NOW);
  assert.deepEqual(folded.map((e) => e.id), ["q1"]);
});

test("lines from an older note collapse into one on the first edit", () => {
  const entries = [line("t1", "First"), line("t2", "Second"), quote("q1")];
  const { el } = surfaceFor(entries);
  const { quoteIds, runs } = readFlow(el);
  assert.deepEqual(runs, ["First\nSecond", ""]);

  // Untouched, they fold back to one line — a one-time tidying, not churn:
  // reading them again gives the same single entry.
  const once = foldFlow(entries, quoteIds, runs, NOW);
  assert.deepEqual(once.map((e) => (e.kind === "quote" ? "quote" : e.text)), [
    "First\nSecond",
    "quote",
  ]);
  const twice = foldFlow(once, quoteIds, runs, NOW + 1000);
  assert.deepEqual(twice, once);
});

test("the slot after the last quote is where a note with no quotes lives", () => {
  const slots = slotsOf([line("t1", "Just a thought")]);
  assert.equal(slots.get(END_SLOT)?.text, "Just a thought");
  assert.equal(slots.get(END_SLOT)?.original?.id, "t1");
});

/* ---------- what arrived while the page was open ---------- */

test("a quote that arrived from another device survives the next keystroke", () => {
  const opened = [line("t1", "A thought"), quote("q1")];
  const known = new Set(opened.map((e) => e.id));
  // The page still shows what it opened with; the note has since gained one.
  const noteNow = [...opened, quote("q2")];

  const folded = foldFlow(opened, ["q1"], ["A thought, revised", ""], NOW);
  const merged = foldIntoNote(noteNow, folded, known);

  assert.deepEqual(merged.map((e) => e.id), ["t1", "q1", "q2"]);
  assert.equal((merged[0] as NoteComment).text, "A thought, revised");
});

test("a quote the page was holding and let go of is still deleted", () => {
  const opened = [line("t1", "before "), quote("q1"), line("t2", "after")];
  const known = new Set(opened.map((e) => e.id));

  const folded = foldFlow(opened, [], ["before after"], NOW);
  const merged = foldIntoNote(opened, folded, known);

  assert.ok(!merged.some((entry) => entry.id === "q1"));
  assert.deepEqual(merged.map((e) => e.kind), ["text"]);
});
