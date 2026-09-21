import test from "node:test";
import assert from "node:assert/strict";
import { sortNewestFirst, timeOf } from "../lib/sort";

/**
 * "Newest" means newest *published*, whatever order a list arrives in.
 *
 * The case this exists for: the offline store hands its articles back in the
 * order they were downloaded, because that is how they were written. The
 * top-up fetches whatever it can reach when it can reach it, so that order
 * has nothing to do with when anything was filed — On this device was showing
 * the newest story last.
 */
test("sorts by publication date, not by the order it was handed", () => {
  const asDownloaded = [
    { id: "middle", publishedAt: "2026-09-10T09:00:00Z" },
    { id: "undated" },
    { id: "oldest", publishedAt: "2026-09-01T09:00:00Z" },
    { id: "newest", publishedAt: "2026-09-20T09:00:00Z" },
  ];

  assert.deepEqual(
    sortNewestFirst(asDownloaded).map((a) => a.id),
    ["newest", "middle", "oldest", "undated"],
    "and an undated article sorts last rather than anywhere",
  );
});

test("articles sharing a date keep the order they came in", () => {
  // Stability is what lets the underlying order still mean something: two
  // stories filed at the same minute stay as the source had them, and every
  // undated article keeps its place among the others.
  const same = "2026-09-10T09:00:00Z";
  const list = [
    { id: "a", publishedAt: same },
    { id: "b", publishedAt: same },
    { id: "c", publishedAt: same },
  ];
  assert.deepEqual(sortNewestFirst(list).map((a) => a.id), ["a", "b", "c"]);
});

test("a date that cannot be read is treated as no date at all", () => {
  assert.equal(timeOf({ publishedAt: "last Tuesday" }), Number.NEGATIVE_INFINITY);
  assert.equal(timeOf({}), Number.NEGATIVE_INFINITY);
  assert.equal(timeOf({ publishedAt: "2026-09-10T09:00:00Z" }), Date.UTC(2026, 8, 10, 9));
});
