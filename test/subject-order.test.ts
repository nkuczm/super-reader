import test from "node:test";
import assert from "node:assert/strict";
import { lastEdited, recentOf, sortSubjects, type SubjectRow } from "../lib/subject-order";
import { addStory, put, remove, cardInfoId, type Board } from "../lib/subjects";
import type { Note } from "../lib/notes";

const rows: SubjectRow[] = [
  { id: "a", name: "Water rates", pinned: false, created: 100, edited: 300 },
  { id: "b", name: "housing", pinned: true, created: 200, edited: 100 },
  { id: "c", name: "Budget", pinned: false, created: 300, edited: 900 },
  { id: "d", name: "Zoning", pinned: false, created: 400, edited: 200 },
];
const ids = (r: SubjectRow[]) => r.map((x) => x.id).join("");

test("pinned subjects come first, whatever the order", () => {
  for (const by of ["recent", "created", "name"] as const) {
    for (const dir of ["asc", "desc"] as const) assert.equal(sortSubjects(rows, by, dir)[0].id, "b", `${by} ${dir}`);
  }
});

test("by date created, newest or oldest first", () => {
  assert.equal(ids(sortSubjects(rows, "created", "desc")), "bdca");
  assert.equal(ids(sortSubjects(rows, "created", "asc")), "bacd");
});

test("by most recent, both ways round, and by name ignoring case", () => {
  assert.equal(ids(sortSubjects(rows, "recent", "desc")), "bcad");
  assert.equal(ids(sortSubjects(rows, "recent", "asc")), "bdac");
  assert.equal(ids(sortSubjects(rows, "name", "asc")), "bcad");
  assert.equal(ids(sortSubjects(rows, "name", "desc")), "bdac");
});

test("recent is the later of the last edit and the last time it was looked at", () => {
  // Zoning was last written in long ago but looked at just now; Budget was edited before that.
  const looked = rows.map((row) => (row.id === "d" ? { ...row, viewed: 1_000 } : row.id === "a" ? { ...row, viewed: 50 } : row));
  assert.equal(ids(sortSubjects(looked, "recent", "desc")), "bdca");
  assert.equal(recentOf({ edited: 300, viewed: 50 }), 300, "an old look does not pull back a later edit");
  assert.equal(recentOf({ edited: 300 }), 300, "never looked at here: its last edit");
});

const note = (at: number): Note => ({ id: "n", name: "Subject", at, entries: [] }) as unknown as Note;
const story = { link: "https://example.com/a-story", title: "A story" };

test("last edited is what the reader changed, not what the app filled in on opening", () => {
  const board: Board = addStory({}, story, 1_000);
  assert.equal(lastEdited(note(500), board), 1_000);
  // Opening the subject reads the story's date and author off the article;
  // the AI files an insight and a suggestion; the view and the pin change.
  let opened = put(board, { id: cardInfoId("https://example.com/a-story"), kind: "cardinfo", card: "https://example.com/a-story", publishedAt: "2026-10-01", at: 9_000 }, 9_000);
  opened = put(opened, { id: "insight:1", kind: "insight", type: "connection", text: "…", refs: [], run: "r", at: 9_100 }, 9_100);
  opened = put(opened, { id: "suggest:1", kind: "suggest", link: "https://example.com/b", title: "B", why: "", state: "pending", at: 9_200 }, 9_200);
  opened = put(opened, { id: "meta", kind: "meta", view: "board", at: 9_300 }, 9_300);
  opened = put(opened, { id: "pin", kind: "pin", pinned: true, at: 9_400 }, 9_400);
  assert.equal(lastEdited(note(500), opened), 1_000);
  // Acting on a suggestion is the reader's doing.
  const accepted = put(opened, { id: "suggest:1", kind: "suggest", link: "https://example.com/b", title: "B", why: "", state: "dismissed", at: 9_500 }, 9_500);
  assert.equal(lastEdited(note(500), accepted), 9_500);
});

test("writing, renaming and taking something out all count as edits", () => {
  const board: Board = addStory({}, story, 1_000);
  const written = put(board, { id: "box:1", kind: "box", html: "<p>Draft</p>", at: 2_000 }, 2_000);
  assert.equal(lastEdited(note(500), written), 2_000);
  assert.equal(lastEdited({ ...note(500), updatedAt: 3_000 } as Note, written), 3_000);
  assert.equal(lastEdited(note(500), remove(written, "box:1", 4_000)), 4_000);
  const quoted = { ...note(500), entries: [{ id: "q", kind: "text", html: "", at: 1_500, editedAt: 5_000 }] } as unknown as Note;
  assert.equal(lastEdited(quoted, board), 5_000);
});
