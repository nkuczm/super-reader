import test from "node:test";
import assert from "node:assert/strict";
import { sortSubjects, type SubjectRow } from "../lib/subject-order";

const rows: SubjectRow[] = [
  { id: "a", name: "Water rates", pinned: false, created: 100, opened: 900, edited: 300 },
  { id: "b", name: "housing", pinned: true, created: 200, opened: 0, edited: 100 },
  { id: "c", name: "Budget", pinned: false, created: 300, opened: 500, edited: 900 },
  { id: "d", name: "Zoning", pinned: false, created: 400, opened: 0, edited: 200 },
];
const ids = (r: SubjectRow[]) => r.map((x) => x.id).join("");

test("pinned subjects come first, whatever the order", () => {
  for (const by of ["opened", "edited", "created", "name"] as const) {
    for (const dir of ["asc", "desc"] as const) assert.equal(sortSubjects(rows, by, dir)[0].id, "b", `${by} ${dir}`);
  }
});

test("by date created, newest or oldest first", () => {
  assert.equal(ids(sortSubjects(rows, "created", "desc")), "bdca");
  assert.equal(ids(sortSubjects(rows, "created", "asc")), "bacd");
});

test("by last opened, never-opened subjects last either way", () => {
  assert.equal(ids(sortSubjects(rows, "opened", "desc")), "bacd");
  assert.equal(ids(sortSubjects(rows, "opened", "asc")), "bcad");
});

test("by last edited, and by name ignoring case", () => {
  assert.equal(ids(sortSubjects(rows, "edited", "desc")), "bcad");
  assert.equal(ids(sortSubjects(rows, "name", "asc")), "bcad");
  assert.equal(ids(sortSubjects(rows, "name", "desc")), "bdac");
});
