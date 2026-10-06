import test from "node:test";
import assert from "node:assert/strict";
import { formatBytes, savedUsage, sizeOf, subjectUsage } from "../lib/storage";

test("each subject is sized with its board, pictures counted, last edit found", () => {
  const notes = [{ id: "a", name: "Firm", entries: [], at: 10 }, { id: "b", name: "", entries: [], at: 5 }] as never;
  const boards = { a: { x: { id: "x", kind: "box", html: "hi", image: "data:image/png;base64,AAAA", at: 99 }, gone: { id: "gone", kind: "box", html: "", at: 500, deleted: true } } } as never;
  const [a, b] = subjectUsage(notes, boards);
  assert.equal(a.items, 1);
  assert.equal(a.images, "data:image/png;base64,AAAA".length);
  assert.equal(a.edited, 99, "a deleted item does not count as an edit");
  assert.ok(a.bytes > b.bytes);
  assert.equal(b.name, "Untitled");
});

test("saved articles count their offline copies", () => {
  const saved = [{ link: "https://x.test/a?utm_source=y", title: "A", savedAt: 1 }, { link: "https://x.test/b", title: "B", savedAt: 1 }] as never;
  const u = savedUsage(saved, new Map([["https://x.test/a", 5000], ["https://x.test/other", 300]]));
  assert.equal(u.count, 2);
  assert.equal(u.withCopy, 1);
  assert.equal(u.copies, 5000);
  assert.equal(u.offlineTotal, 5300);
  assert.equal(u.list, sizeOf(saved));
});

test("sizes read plainly", () => {
  assert.equal(formatBytes(512), "512 B");
  assert.equal(formatBytes(2048), "2.0 KB");
  assert.equal(formatBytes(5 * 1024 * 1024), "5.0 MB");
});
