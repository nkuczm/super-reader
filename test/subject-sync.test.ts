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
