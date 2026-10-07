import test from "node:test";
import assert from "node:assert/strict";
import { placeFeed, placeSource, type Feed } from "../lib/store";

const s = (id: string) => ({ id, feedUrl: `https://${id}.example/rss`, title: id }) as Feed["sources"][number];
const feeds = (): Feed[] => [
  { id: "A", name: "A", sources: [s("a1"), s("a2"), s("a3")] },
  { id: "B", name: "B", sources: [s("b1")] },
  { id: "C", name: "C", sources: [] },
];
const ids = (list: Feed[]) => list.map((f) => `${f.id}:${f.sources.map((x) => x.id).join(",")}`);

test("a source moves up and down within its feed", () => {
  assert.deepEqual(ids(placeSource(feeds(), "a3", "A", "A", "a1", false)), ["A:a3,a1,a2", "B:b1", "C:"]);
  assert.deepEqual(ids(placeSource(feeds(), "a1", "A", "A", "a3", true)), ["A:a2,a3,a1", "B:b1", "C:"]);
});

test("a source moves into another feed at the place it was dropped", () => {
  assert.deepEqual(ids(placeSource(feeds(), "a2", "A", "B", "b1", false)), ["A:a1,a3", "B:a2,b1", "C:"]);
  assert.deepEqual(ids(placeSource(feeds(), "a2", "A", "C", null, false)), ["A:a1,a3", "B:b1", "C:a2"]);
});

test("whole feeds move up and down", () => {
  assert.deepEqual(placeFeed(feeds(), "C", "A", false).map((f) => f.id), ["C", "A", "B"]);
  assert.deepEqual(placeFeed(feeds(), "A", "C", true).map((f) => f.id), ["B", "C", "A"]);
  assert.deepEqual(placeFeed(feeds(), "A", "A", true).map((f) => f.id), ["A", "B", "C"]);
});
