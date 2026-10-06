import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { delta, emptyBase, isEmpty, remember, withPictures, withRefs, type Writing } from "../lib/subject-sync";

const PNG = "data:image/png;base64," + "B".repeat(4000);
const hash = createHash("sha256").update(PNG).digest("hex");
const doc = (): Writing => ({
  notes: [{ id: "n", name: "N", at: 1, entries: [] }],
  noteRemovals: [],
  boards: { n: { a: { id: "a", kind: "box", html: "<p>a</p>", at: 1 } as never, p: { id: "p", kind: "box", html: "", image: PNG, at: 1 } as never } },
});

test("only what the account does not hold is sent", () => {
  const base = emptyBase();
  const mine = doc();
  assert.equal(delta(mine, base).notes.length, 1);
  remember(base, mine);
  assert.ok(isEmpty(delta(mine, base)));
  mine.boards.n.a = { ...mine.boards.n.a, html: "<p>b</p>", at: 2 } as never;
  const change = delta(mine, base);
  assert.deepEqual(Object.keys(change.boards.n), ["a"]);
  assert.equal(change.notes.length, 0);
});

test("a picture the account holds goes as a reference, hashed as the server hashes it", async () => {
  const { doc: sent, sent: hashes } = await withRefs(doc(), new Set([hash]));
  assert.equal((sent.boards.n.p as { image?: string }).image, `sr-img:${hash}`);
  assert.deepEqual(hashes, [hash]);
  const fresh = await withRefs(doc(), new Set());
  assert.equal((fresh.doc.boards.n.p as { image?: string }).image, PNG);
});

test("a reference coming back is filled from this device's own picture, or fetched, or left out", async () => {
  const remote: Writing = { notes: [], noteRemovals: [], boards: { n: { q: { id: "q", kind: "box", html: "", image: `sr-img:${hash}`, at: 5 } as never } } };
  let asked = 0;
  const local = await withPictures(remote, doc().boards, async () => { asked++; return {}; }, new Set());
  assert.equal((local.boards.n.q as { image?: string }).image, PNG);
  assert.equal(asked, 0, "nothing fetched when the device has it");
  const fetched = await withPictures(remote, {}, async (h) => ({ [h[0]]: PNG }), new Set());
  assert.equal((fetched.boards.n.q as { image?: string }).image, PNG);
  const lost = await withPictures(remote, {}, async () => ({}), new Set());
  assert.equal(lost.boards.n.q, undefined, "never a reference in place of a picture");
});

test("a change too big for one request goes in pieces that together are the whole change", async () => {
  const { splitWriting } = await import("../lib/subject-sync");
  const big = "x".repeat(400_000);
  const doc = {
    notes: Array.from({ length: 12 }, (_, i) => ({ id: `n${i}`, name: `S${i}`, at: i, updatedAt: i, entries: [{ id: `e${i}`, kind: "text" as const, text: big, at: i }] })),
    noteRemovals: [{ id: "gone", at: 1 }],
    boards: { n0: Object.fromEntries(Array.from({ length: 10 }, (_, i) => [`b${i}`, { kind: "box", at: i, html: big }])) },
  } as never;
  const pieces = splitWriting(doc, 3_000_000);
  assert.ok(pieces.length > 1);
  for (const piece of pieces) assert.ok(JSON.stringify(piece).length <= 3_000_000 + 500_000);
  assert.equal(pieces.flatMap((p) => p.notes).length, 12);
  assert.equal(pieces.reduce((n, p) => n + Object.keys(p.boards.n0 ?? {}).length, 0), 10);
  assert.equal(pieces.flatMap((p) => p.noteRemovals).length, 1);
});

test("pictures go ahead in batches, a large one on its own", async () => {
  const { pictureBatches } = await import("../lib/subject-sync");
  const pics = new Map([["a", "d".repeat(1_000_000)], ["b", "d".repeat(1_000_000)], ["c", "d".repeat(3_000_000)], ["d", "d".repeat(10)]]);
  const batches = pictureBatches(pics, 2_500_000);
  assert.deepEqual(batches.map((b) => Object.keys(b)), [["a", "b"], ["c"], ["d"]]);
});

test("a whole copy in parts: every subject lands in one part, and they join back", async () => {
  const { partOf, joinParts } = await import("../lib/subject-sync");
  const doc = {
    notes: Array.from({ length: 40 }, (_, i) => ({ id: `n${i}`, name: `S${i}`, at: i, updatedAt: i, entries: [] })),
    noteRemovals: [{ id: "x", at: 1 }],
    boards: Object.fromEntries(Array.from({ length: 40 }, (_, i) => [`n${i}`, { a: { kind: "box", at: i } }])),
  } as never;
  const parts = [0, 1, 2].map((p) => partOf(doc, p, 3));
  for (const part of parts) for (const note of part.notes) assert.ok(part.boards[note.id], "a subject's board travels with its note");
  const joined = joinParts(parts);
  assert.equal(joined.notes.length, 40);
  assert.equal(Object.keys(joined.boards).length, 40);
  assert.equal(joined.noteRemovals.length, 1);
});
