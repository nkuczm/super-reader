import test from "node:test";
import assert from "node:assert/strict";
import {
  addEntry,
  cleanQuoteText,
  editComment,
  quotedLinks,
  releasableSaves,
  removeEntry,
  renameNote,
  type Note,
} from "../lib/notes";
import type { SavedArticle } from "../lib/saved";

function note(id: string, name = "Reading"): Note {
  return { id, name, entries: [], at: 1 };
}

function quote(id: string, link: string) {
  return {
    id,
    kind: "quote" as const,
    text: "What it said",
    link,
    articleTitle: "A story",
    at: 1,
  };
}

function saved(link: string, viaNote?: boolean): SavedArticle {
  return { id: link, title: "A story", link, savedAt: 1, ...(viaNote ? { viaNote } : {}) };
}

test("a selection keeps its paragraphs and loses the layout's line breaks", () => {
  const text = cleanQuoteText(
    "The court held\nthat the rule stands.\n\n  It said so   twice.  \n",
  );
  assert.equal(text, "The court held that the rule stands.\n\nIt said so twice.");
});

test("an oversized selection is cut rather than stored whole", () => {
  assert.equal(cleanQuoteText("x".repeat(9000)).length, 4000);
});

test("quotes are added to the named note, in the order they arrive", () => {
  let notes = [note("n1"), note("n2", "Work")];
  notes = addEntry(notes, "n2", quote("q1", "https://example.com/a"));
  notes = addEntry(notes, "n2", quote("q2", "https://example.com/b"));

  assert.equal(notes[0].entries.length, 0);
  assert.deepEqual(
    notes[1].entries.map((e) => e.id),
    ["q1", "q2"],
  );
});

test("your own lines can be rewritten; a quote cannot", () => {
  let notes = [note("n1")];
  notes = addEntry(notes, "n1", quote("q1", "https://example.com/a"));
  notes = addEntry(notes, "n1", { id: "t1", kind: "text", text: "Ask about this", at: 2 });

  notes = editComment(notes, "n1", "t1", "Asked; answered");
  assert.equal((notes[0].entries[1] as { text: string }).text, "Asked; answered");

  // Aimed at a quote, the same edit changes nothing.
  notes = editComment(notes, "n1", "q1", "Something the article never said");
  assert.equal((notes[0].entries[0] as { text: string }).text, "What it said");
});

test("a note is renamed, and an empty name is refused", () => {
  const notes = [note("n1")];
  assert.equal(renameNote(notes, "n1", "  Court watch ")[0].name, "Court watch");
  assert.equal(renameNote(notes, "n1", "   ")[0].name, "Reading");
});

test("quotedLinks covers every note, not just one", () => {
  let notes = [note("n1"), note("n2")];
  notes = addEntry(notes, "n1", quote("q1", "https://example.com/a"));
  notes = addEntry(notes, "n2", quote("q2", "https://example.com/b"));
  assert.deepEqual([...quotedLinks(notes)].sort(), [
    "https://example.com/a",
    "https://example.com/b",
  ]);
});

test("deleting the last quote of an article releases the save it caused", () => {
  let notes = [note("n1")];
  notes = addEntry(notes, "n1", quote("q1", "https://example.com/a"));
  const library = [saved("https://example.com/a", true)];

  assert.deepEqual(releasableSaves(library, notes), []);

  notes = removeEntry(notes, "n1", "q1");
  assert.deepEqual(releasableSaves(library, notes), ["https://example.com/a"]);
});

test("an article the reader saved themselves is never released", () => {
  const notes = [note("n1")];
  // Saved with the Save button, then quoted, then the quote deleted.
  const library = [saved("https://example.com/a")];
  assert.deepEqual(releasableSaves(library, notes), []);
});

test("an article another note still quotes is kept", () => {
  let notes = [note("n1"), note("n2")];
  notes = addEntry(notes, "n1", quote("q1", "https://example.com/a"));
  notes = addEntry(notes, "n2", quote("q2", "https://example.com/a"));
  const library = [saved("https://example.com/a", true)];

  notes = removeEntry(notes, "n1", "q1");
  assert.deepEqual(releasableSaves(library, notes), []);

  notes = removeEntry(notes, "n2", "q2");
  assert.deepEqual(releasableSaves(library, notes), ["https://example.com/a"]);
});

test("clearing a whole note releases only what it alone held", () => {
  let notes = [note("n1"), note("n2")];
  notes = addEntry(notes, "n1", quote("q1", "https://example.com/a"));
  notes = addEntry(notes, "n1", quote("q2", "https://example.com/b"));
  notes = addEntry(notes, "n2", quote("q3", "https://example.com/b"));
  const library = [
    saved("https://example.com/a", true),
    saved("https://example.com/b", true),
    saved("https://example.com/c", true),
  ];

  const left = notes.filter((n) => n.id !== "n1");
  assert.deepEqual(releasableSaves(library, left).sort(), [
    "https://example.com/a",
    // c was auto-saved but is quoted nowhere at all, so it goes too.
    "https://example.com/c",
  ]);
});
