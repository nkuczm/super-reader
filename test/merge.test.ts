import test from "node:test";
import assert from "node:assert/strict";
import { mergeBySource } from "../lib/merge";

/**
 * The list is assembled from one request per source now, so the answers
 * arrive in whatever order the network delivers them. None of that may reach
 * the reader: what the list looks like has to depend on the sources and the
 * articles, and on nothing else.
 */

const article = (link: string, publishedAt?: string) => ({ link, publishedAt });

const A = [
  article("https://a.test/one", "2026-09-12T10:00:00Z"),
  article("https://a.test/two", "2026-09-12T08:00:00Z"),
];
const B = [article("https://b.test/one", "2026-09-12T09:00:00Z")];

test("articles from every source, newest first", () => {
  const merged = mergeBySource(["a", "b"], new Map([["a", A], ["b", B]]));
  assert.deepEqual(merged.map((m) => m.link), [
    "https://a.test/one",
    "https://b.test/one",
    "https://a.test/two",
  ]);
});

test("a source that has not answered yet is simply absent", () => {
  // This is the whole point of painting as they arrive: the list is valid at
  // every step, not only once the slowest feed is in.
  const merged = mergeBySource(["a", "b"], new Map([["b", B]]));
  assert.deepEqual(merged.map((m) => m.link), ["https://b.test/one"]);
});

test("one article, once, however its link was dressed up", () => {
  const merged = mergeBySource(
    ["a", "b"],
    new Map([
      ["a", [article("https://paper.test/story", "2026-09-12T10:00:00Z")]],
      ["b", [article("https://www.paper.test/story?utm_source=rss", "2026-09-12T10:00:00Z")]],
    ]),
  );
  assert.equal(merged.length, 1, "the same story from two of a paper's feeds");
});

test("which copy survives is the sidebar's order, not the network's", () => {
  // The reason this is worth a test: merging in arrival order would file a
  // story under whichever feed answered first and move it somewhere else on
  // the next refresh, for no reason the reader could see.
  const duplicated = new Map([
    ["a", [article("https://paper.test/story", "2026-09-12T10:00:00Z")]],
    ["b", [article("https://paper.test/story?ref=twitter", "2026-09-12T10:00:00Z")]],
  ]);

  // Same map, filled in either order — a Map iterates by insertion, so this
  // is exactly the difference a race would make.
  const reversed = new Map([...duplicated].reverse());

  for (const [label, map] of [["a first", duplicated], ["b first", reversed]] as const) {
    const merged = mergeBySource(["a", "b"], map);
    assert.equal(merged.length, 1, label);
    assert.equal(merged[0].link, "https://paper.test/story", `${label}: source order decides`);
  }
});

test("the merge is the same whichever order the sources answered in", () => {
  const full = new Map([["a", A], ["b", B]]);
  const other = new Map([["b", B], ["a", A]]);
  assert.deepEqual(
    mergeBySource(["a", "b"], full).map((m) => m.link),
    mergeBySource(["a", "b"], other).map((m) => m.link),
  );
});

test("a source no longer followed is left out, even if it answered", () => {
  // Its request was already in flight when it was removed.
  const merged = mergeBySource(["a"], new Map([["a", A], ["gone", B]]));
  assert.deepEqual(merged.map((m) => m.link), [
    "https://a.test/one",
    "https://a.test/two",
  ]);
});

test("undated articles keep the order their source gave them", () => {
  const merged = mergeBySource(
    ["a"],
    new Map([["a", [article("https://a.test/x"), article("https://a.test/y")]]]),
  );
  assert.deepEqual(merged.map((m) => m.link), ["https://a.test/x", "https://a.test/y"]);
});

test("nothing at all is an empty list, not a crash", () => {
  assert.deepEqual(mergeBySource([], new Map()), []);
  assert.deepEqual(mergeBySource(["a"], new Map()), []);
});
