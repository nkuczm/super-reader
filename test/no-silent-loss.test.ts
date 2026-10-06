import test from "node:test";
import assert from "node:assert/strict";
import { mergeNotes, slimNotesForSync, MAX_NOTES } from "../lib/notes";
import { mergeDocs } from "../lib/accounts";
import { mergeManual, slimManualForSync, type ManualStories } from "../lib/manual";
import { mergeHighlights, slimHighlightsForSync, type Highlights } from "../lib/highlights";
import { pruneBoards } from "../lib/subjects";
import { unionRead, unionTeams } from "../lib/store";
import { fitForSync, mergeSyncDocs, MAX_PAYLOAD_BYTES } from "../lib/sync-doc";

/*
 * Every merge here used to cut its result to what the synced document could
 * carry, and the cut fell on the person's own data: the sixty-first subject
 * took the oldest away, on the server as well, since the account's copy is
 * rebuilt with the same merge. Merges now keep everything; only the copy
 * sent over the wire is cut.
 */

const NOW = Date.now();
const note = (i: number, entries = 0) => ({
  id: `n${i}`,
  name: `Subject ${i}`,
  at: NOW - 100_000 + i,
  updatedAt: NOW - 100_000 + i,
  entries: Array.from({ length: entries }, (_, j) => ({ id: `n${i}e${j}`, kind: "text" as const, text: `line ${j}`, at: NOW - 50_000 + j })),
});

test("a merge keeps every subject, however many", () => {
  const notes = Array.from({ length: MAX_NOTES + 25 }, (_, i) => note(i));
  const merged = mergeNotes({ notes, removals: [] }, { notes: [], removals: [] }, NOW);
  assert.equal(merged.notes.length, MAX_NOTES + 25);
  // The account's copy is rebuilt with mergeDocs: the same holds there.
  const doc = mergeDocs({ notes, noteRemovals: [], boards: {} }, { notes: [], noteRemovals: [], boards: {} }, NOW);
  assert.equal(doc.notes.length, MAX_NOTES + 25);
  // Only the wire copy is cut.
  assert.equal(slimNotesForSync(merged.notes).length, MAX_NOTES);
});

test("a merge keeps every entry in a subject", () => {
  const merged = mergeNotes({ notes: [note(1, 650)] as never, removals: [] }, { notes: [], removals: [] }, NOW);
  assert.equal(merged.notes[0].entries.length, 650);
});

test("pasted stories and highlights are all kept; the wire copy is the newest", () => {
  const stories: ManualStories = Object.fromEntries(
    Array.from({ length: 700 }, (_, i) => [`https://a.example/${i}`, { link: `https://a.example/${i}`, title: `S${i}`, at: NOW - i }]),
  );
  assert.equal(Object.keys(mergeManual(stories, {}, NOW)).length, 700);
  const wire = slimManualForSync(stories);
  assert.ok(Object.keys(wire).length < 700);
  assert.ok(wire["https://a.example/0"], "the newest travels");

  const highlights: Highlights = Object.fromEntries(
    Array.from({ length: 2600 }, (_, i) => [`h${i}`, { id: `h${i}`, link: "https://a.example/x", text: "t".repeat(200), at: NOW - i }]),
  );
  assert.equal(Object.keys(mergeHighlights(highlights, {}, NOW)).length, 2600);
  const slim = slimHighlightsForSync(highlights);
  assert.ok(JSON.stringify(slim).length < 170 * 1024);
  assert.ok(slim.h0, "the newest travels");
});

test("a board is let go only when its subject was deleted, not when it simply has not arrived", () => {
  const boards = { a: {}, b: {} };
  assert.deepEqual(Object.keys(pruneBoards(boards, new Set(["b"]))), ["a"]);
  assert.deepEqual(Object.keys(pruneBoards(boards, new Set())), ["a", "b"]);
});

test("joining a code keeps the teams and read marks this device had", () => {
  assert.deepEqual(
    unionTeams([{ code: "T1", name: "Desk" }], [{ code: "T2", name: "Mine" }, { code: "T1", name: "Desk" }]).map((t) => t.code),
    ["T1", "T2"],
  );
  assert.deepEqual(unionRead(["a", "b"], ["b", "c"]), ["a", "b", "c"]);
  assert.equal(unionRead(Array.from({ length: 3000 }, (_, i) => `x${i}`), ["new"]).at(-1), "new");
});

test("the server's merge stays inside what it accepts, whatever two devices bring", () => {
  const big = (prefix: string) =>
    Array.from({ length: 900 }, (_, i) => ({ id: `${prefix}${i}`, title: "T", link: `https://${prefix}.example/${i}`, savedAt: NOW - i, summary: "s".repeat(1000) }));
  const merged = mergeSyncDocs({ feeds: [], saved: big("a") }, { feeds: [], saved: big("b") }, NOW);
  assert.ok((merged.saved ?? []).length <= 400);
  assert.ok(JSON.stringify(merged).length < MAX_PAYLOAD_BYTES);
});

test("an extraordinary copy is cut to fit rather than refused", () => {
  const body = {
    feeds: [],
    read: Array.from({ length: 3000 }, (_, i) => `https://example.com/${"x".repeat(1100)}/${i}`),
  };
  assert.ok(JSON.stringify(body).length > MAX_PAYLOAD_BYTES * 0.9);
  const fitted = fitForSync(body);
  assert.ok(JSON.stringify(fitted).length < MAX_PAYLOAD_BYTES * 0.9);
  assert.equal(fitted.read?.at(-1), body.read.at(-1), "the most recent read marks stay");
});
