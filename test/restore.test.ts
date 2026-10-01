import test from "node:test";
import assert from "node:assert/strict";
import { mergeDocs, type SubjectsDoc } from "../lib/accounts";
import { restoreSubject } from "../lib/restore";

const T = Date.now() - 60_000;

const quote = (id: string, at: number) => ({ id, kind: "quote", text: id, link: "https://a.example/x", title: "x", at }) as never;

{
  const version: SubjectsDoc = {
    notes: [{ id: "s", name: "Old", at: T + 1, entries: [quote("q1", T + 1), quote("q2", T + 2)] }],
    noteRemovals: [],
    boards: { s: { b1: { id: "b1", kind: "box", html: "<p>old</p>", at: T + 1 } } },
  };
  const current: SubjectsDoc = {
    notes: [
      { id: "s", name: "New", at: T + 1, updatedAt: T + 50, entries: [quote("q1", T + 1), quote("q3", T + 40)] },
      { id: "t", name: "Other", at: T + 2, entries: [] },
    ],
    noteRemovals: [{ id: "q2", at: T + 30 }],
    boards: { s: { b2: { id: "b2", kind: "box", html: "<p>new</p>", at: T + 45 } } },
  };

  test("puts the subject back and wins against a device still holding the newer copy", () => {
    const restored = restoreSubject(current, version, "s", T + 100)!;
    const merged = mergeDocs(current, restored);
    const s = merged.notes.find((n) => n.id === "s")!;
    assert.equal(s.name, "Old");
    assert.deepEqual(s.entries.map((e) => e.id), ["q1", "q2"]);
    assert.equal(merged.boards.s.b2.deleted, true);
    assert.ok(!merged.boards.s.b1.deleted);
    assert.ok(merged.notes.some((n) => n.id === "t"));
  });

  test("returns null for a subject the version does not hold", () => {
    assert.equal(restoreSubject(current, version, "t"), null);
  });
}
