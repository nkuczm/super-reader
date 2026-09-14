import test from "node:test";
import assert from "node:assert/strict";
import { KEEP_DAYS, mergeWindow, stamp, type Held } from "../lib/window";
import { canonicalUrl } from "../lib/url";

const NOW = Date.parse("2026-09-14T00:00:00Z");
const DAY = 24 * 60 * 60 * 1000;

function article(
  id: string,
  { source = "s1", daysAgo = 0, link = `https://example.com/${id}`, seenAt = NOW }: {
    source?: string;
    daysAgo?: number;
    link?: string;
    seenAt?: number;
  } = {},
): Held & { title: string } {
  return {
    id,
    title: id,
    link,
    sourceId: source,
    publishedAt: new Date(NOW - daysAgo * DAY).toISOString(),
    seenAt,
  };
}

const opts = (extra: Partial<Parameters<typeof mergeWindow>[2]> = {}) => ({
  sources: new Set(["s1", "s2"]),
  canonical: canonicalUrl,
  now: NOW,
  ...extra,
});

test("what a feed has dropped is still held", () => {
  // Read on Monday, read again on Thursday: the feed has moved on, but the
  // Monday stories are what the reader would otherwise never have seen.
  const monday = [article("mon-1", { daysAgo: 3 }), article("mon-2", { daysAgo: 3 })];
  const thursday = [article("thu-1"), article("thu-2")];

  const merged = mergeWindow(thursday, monday, opts());
  assert.deepEqual(
    merged.map((a) => a.id).sort(),
    ["mon-1", "mon-2", "thu-1", "thu-2"],
  );
});

test("a story still in the feed is not held twice", () => {
  const held = [article("a", { daysAgo: 1 })];
  const fetched = [article("a", { daysAgo: 1 }), article("b")];
  assert.deepEqual(mergeWindow(fetched, held, opts()).map((a) => a.id), ["b", "a"]);
});

test("the same story under a tracking tag is the same story", () => {
  const held = [article("a", { link: "https://www.wsj.com/world/x-1234?mod=rss_worldnews" })];
  const fetched = [article("a2", { link: "https://www.wsj.com/world/x-1234?mod=rss_markets" })];
  const merged = mergeWindow(fetched, held, opts());
  assert.equal(merged.length, 1);
  // The fetched copy wins: it is the publisher's current version.
  assert.equal(merged[0].id, "a2");
});

test("a story keeps the day it first turned up here", () => {
  const firstSeen = NOW - 2 * DAY;
  const held = [article("a", { daysAgo: 1, seenAt: firstSeen })];
  const merged = mergeWindow([article("a", { daysAgo: 1 })], held, opts());
  assert.equal(merged[0].seenAt, firstSeen);
});

test("anything older than the window is let go", () => {
  const old = [article("ancient", { daysAgo: KEEP_DAYS + 1 })];
  const merged = mergeWindow([article("new")], old, opts());
  assert.deepEqual(merged.map((a) => a.id), ["new"]);
});

test("a source no longer followed takes its stories with it", () => {
  const held = [article("kept", { source: "s1" }), article("gone", { source: "removed" })];
  const merged = mergeWindow([], held, opts());
  assert.deepEqual(merged.map((a) => a.id), ["kept"]);
});

test("a busy desk cannot crowd out a quiet one", () => {
  // The reason the cap is per source: markets files hourly, opinion weekly.
  const markets = Array.from({ length: 10 }, (_, i) =>
    article(`m${i}`, { source: "s1", daysAgo: i / 24 }),
  );
  const opinion = [article("column", { source: "s2", daysAgo: 5 })];

  const merged = mergeWindow(markets, opinion, opts({ perSource: 3 }));
  assert.equal(merged.filter((a) => a.sourceId === "s1").length, 3);
  assert.deepEqual(
    merged.filter((a) => a.sourceId === "s2").map((a) => a.id),
    ["column"],
    "the weekly column survives a busy day on the markets desk",
  );
});

test("the newest are the ones kept when a source is over its cap", () => {
  const held = Array.from({ length: 5 }, (_, i) => article(`old${i}`, { daysAgo: 5 + i }));
  const fetched = [article("newest")];
  const merged = mergeWindow(fetched, held, opts({ perSource: 2 }));
  assert.deepEqual(merged.map((a) => a.id), ["newest", "old0"]);
});

test("an item with no date is kept rather than treated as ancient", () => {
  const undated = { id: "u", title: "u", link: "https://example.com/u", sourceId: "s1" };
  const merged = mergeWindow([undated as Held], [], opts());
  assert.deepEqual(merged.map((a) => a.id), ["u"]);
  assert.equal(merged[0].seenAt, NOW, "it is stamped with the day it arrived");
});

test("an undated item ages out on the day it arrived", () => {
  const stale = {
    id: "u",
    title: "u",
    link: "https://example.com/u",
    sourceId: "s1",
    seenAt: NOW - (KEEP_DAYS + 1) * DAY,
  };
  assert.deepEqual(mergeWindow([], [stale as Held], opts()), []);
});

test("stamping leaves an arrival date alone if it already has one", () => {
  const earlier = NOW - DAY;
  const stamped = stamp([article("a", { seenAt: earlier })], NOW);
  assert.equal(stamped[0].seenAt, earlier);
});
