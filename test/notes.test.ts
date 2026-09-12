import test from "node:test";
import assert from "node:assert/strict";
import {
  addEntry,
  cleanQuoteText,
  editComment,
  moveEntry,
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

/* ---------- syncing ---------- */

import {
  mergeNotes,
  notesDifferFrom,
  slimNotesForSync,
  idsOf,
  REMOVAL_TTL_MS,
  SYNC_BUDGET_BYTES,
  type NotesState,
} from "../lib/notes";

/** Real-world stamps: tombstones expire against the clock, not against 0. */
const NOW = 1_800_000_000_000;

function state(notes: Note[], removals: { id: string; at: number }[] = []): NotesState {
  return { notes, removals };
}

function withEntries(id: string, name: string, entries: Note["entries"], at = NOW - 10_000): Note {
  return { id, name, entries, at, updatedAt: at };
}

test("a note taken on one device arrives on the other", () => {
  const phone = state([withEntries("n1", "Reading", [quote("q1", "https://e.com/a")])]);
  const desktop = state([]);
  const merged = mergeNotes(phone, desktop);
  assert.deepEqual(merged.notes.map((n) => n.name), ["Reading"]);
});

test("quotes added on both devices between syncs both survive", () => {
  const base = withEntries("n1", "Reading", []);
  const phone = state([{ ...base, entries: [{ ...quote("q1", "https://e.com/a"), at: 10 }] }]);
  const desktop = state([{ ...base, entries: [{ ...quote("q2", "https://e.com/b"), at: 20 }] }]);

  const merged = mergeNotes(phone, desktop);
  assert.deepEqual(merged.notes[0].entries.map((e) => e.id), ["q1", "q2"]);
  // Both orders agree, so the two devices show the same note.
  assert.deepEqual(
    mergeNotes(desktop, phone).notes[0].entries.map((e) => e.id),
    ["q1", "q2"],
  );
});

test("a deleted quote stays deleted rather than coming back", () => {
  const withQuote = withEntries("n1", "Reading", [
    { ...quote("q1", "https://e.com/a"), at: NOW - 9000 },
  ]);
  // The phone deleted it; the desktop has not heard yet.
  const phone = state([{ ...withQuote, entries: [] }], [{ id: "q1", at: NOW - 500 }]);
  const desktop = state([withQuote]);

  assert.deepEqual(mergeNotes(phone, desktop, NOW).notes[0].entries, []);
  assert.deepEqual(mergeNotes(desktop, phone, NOW).notes[0].entries, []);
});

test("a deleted note stays deleted", () => {
  const note = withEntries("n1", "Reading", [quote("q1", "https://e.com/a")]);
  const phone = state([], [...idsOf(note).map((id) => ({ id, at: NOW - 500 }))]);
  const desktop = state([note]);
  assert.deepEqual(mergeNotes(phone, desktop, NOW).notes, []);
  assert.deepEqual(mergeNotes(desktop, phone, NOW).notes, []);
});

test("quoting into a note the other device deleted brings the note back", () => {
  const note = withEntries("n1", "Reading", []);
  const deleted = state([], [{ id: "n1", at: NOW - 2000 }]);
  // The other device renamed it after the deletion was recorded.
  const alive = state([{ ...note, name: "Court watch", updatedAt: NOW - 1000 }]);

  const merged = mergeNotes(alive, deleted, NOW);
  assert.deepEqual(merged.notes.map((n) => n.name), ["Court watch"]);
  // ...and the spent tombstone is dropped, so it cannot delete it again.
  assert.deepEqual(merged.removals, []);
});

test("the newer name wins, and the entries of both are kept either way", () => {
  const phone = state([
    {
      ...withEntries("n1", "Reading", [{ ...quote("q1", "https://e.com/a"), at: NOW - 900 }]),
      updatedAt: NOW - 900,
    },
  ]);
  const desktop = state([
    {
      ...withEntries("n1", "Court watch", [{ ...quote("q2", "https://e.com/b"), at: NOW - 800 }]),
      updatedAt: NOW - 800,
    },
  ]);
  const merged = mergeNotes(phone, desktop, NOW);
  assert.equal(merged.notes[0].name, "Court watch");
  assert.deepEqual(merged.notes[0].entries.map((e) => e.id), ["q1", "q2"]);
});

test("the later edit of a typed line wins", () => {
  const line = (text: string, editedAt?: number) => ({
    id: "t1",
    kind: "text" as const,
    text,
    at: NOW - 5000,
    ...(editedAt ? { editedAt } : {}),
  });
  const phone = state([withEntries("n1", "Reading", [line("First thought")])]);
  const desktop = state([
    withEntries("n1", "Reading", [line("Second thought", NOW - 100)]),
  ]);
  assert.equal(
    (mergeNotes(phone, desktop).notes[0].entries[0] as { text: string }).text,
    "Second thought",
  );
});

test("notes come back in the same order on both devices", () => {
  const a = withEntries("n1", "First", [], NOW - 2000);
  const b = withEntries("n2", "Second", [], NOW - 1000);
  assert.deepEqual(
    mergeNotes(state([b]), state([a])).notes.map((n) => n.name),
    ["First", "Second"],
  );
});

test("tombstones older than the window are forgotten", () => {
  const now = Date.now();
  const merged = mergeNotes(
    state([], [{ id: "gone", at: now - REMOVAL_TTL_MS - 1000 }]),
    state([]),
    now,
  );
  assert.deepEqual(merged.removals, []);
});

test("the synced copy is cut to a budget, newest entries first", () => {
  const long = (id: string, at: number) => ({
    id,
    kind: "quote" as const,
    text: "x".repeat(3000),
    link: "https://e.com/a",
    articleTitle: "A story",
    at,
  });
  const notes = [
    withEntries(
      "n1",
      "Reading",
      Array.from({ length: 200 }, (_, i) => long(`q${i}`, NOW - 200_000 + i * 1000)),
    ),
  ];

  const slim = slimNotesForSync(notes);
  assert.ok(JSON.stringify(slim).length <= SYNC_BUDGET_BYTES);
  // The note itself survives even when its oldest quotes do not.
  assert.equal(slim.length, 1);
  const kept = slim[0].entries.map((e) => Number(e.at));
  assert.ok(kept.length > 0 && kept.length < 200);
  assert.equal(Math.max(...kept), NOW - 200_000 + 199_000, "the newest entry is kept");
  // Still in the order they were added.
  assert.deepEqual([...kept].sort((a, b) => a - b), kept);
});

test("a small set of notes syncs whole", () => {
  const notes = [withEntries("n1", "Reading", [quote("q1", "https://e.com/a")])];
  assert.deepEqual(slimNotesForSync(notes), notes);
});

test("a device owes nothing once the server has what it would send", () => {
  const notes = [withEntries("n1", "Reading", [quote("q1", "https://e.com/a")])];
  const merged = mergeNotes(state(notes), state(notes), NOW);
  assert.equal(
    notesDifferFrom(
      { notes: slimNotesForSync(merged.notes), removals: merged.removals },
      { notes, removals: [] },
    ),
    false,
  );
});

test("a budget-trimmed push does not leave the device owing forever", () => {
  // More material than the wire carries: what is cut must not read as news,
  // or the device stamps and pushes again on every single sync.
  const long = (id: string, at: number) => ({
    id,
    kind: "quote" as const,
    text: "x".repeat(3000),
    link: "https://e.com/a",
    articleTitle: "A story",
    at,
  });
  const held = [
    withEntries(
      "n1",
      "Reading",
      Array.from({ length: 200 }, (_, i) => long(`q${i}`, NOW - 200_000 + i * 1000)),
    ),
  ];
  const sent = slimNotesForSync(held);

  // The server now holds exactly what was sent; this device still holds all.
  const merged = mergeNotes(state(held), state(sent), NOW);
  assert.equal(
    notesDifferFrom(
      { notes: slimNotesForSync(merged.notes), removals: merged.removals },
      { notes: sent, removals: [] },
    ),
    false,
  );
});

test("a device does owe when it holds a quote the server has not seen", () => {
  const mineNotes = [
    withEntries("n1", "Reading", [
      { ...quote("q1", "https://e.com/a"), at: NOW - 900 },
      { ...quote("q2", "https://e.com/b"), at: NOW - 800 },
    ]),
  ];
  const theirNotes = [
    withEntries("n1", "Reading", [{ ...quote("q1", "https://e.com/a"), at: NOW - 900 }]),
  ];
  const merged = mergeNotes(state(mineNotes), state(theirNotes), NOW);
  assert.equal(
    notesDifferFrom(
      { notes: slimNotesForSync(merged.notes), removals: merged.removals },
      { notes: theirNotes, removals: [] },
    ),
    true,
  );
});

test("a quote sent to another note keeps its id, so nothing counts as deleted", () => {
  let notes = [note("n1", "Quotes"), note("n2", "Second")];
  notes = addEntry(notes, "n1", quote("q1", "https://e.com/a"));
  const before = notes.flatMap(idsOf);

  notes = moveEntry(notes, "q1", "n2");
  assert.deepEqual(notes[0].entries, []);
  assert.deepEqual(notes[1].entries.map((e) => e.id), ["q1"]);
  // Same ids on both sides of the move: a move writes no tombstone...
  assert.deepEqual([...notes.flatMap(idsOf)].sort(), [...before].sort());
  // ...and the article the quote holds is still quoted, so it stays saved.
  assert.deepEqual(
    releasableSaves([{ id: "a", title: "A", link: "https://e.com/a", savedAt: 1, viaNote: true }], notes),
    [],
  );
});

test("moving to a note that is not there, or an entry that is not, changes nothing", () => {
  const notes = [note("n1"), note("n2")];
  const withQuote = addEntry(notes, "n1", quote("q1", "https://e.com/a"));
  assert.equal(moveEntry(withQuote, "q1", "nowhere"), withQuote);
  assert.equal(moveEntry(withQuote, "missing", "n2"), withQuote);
});
