import test from "node:test";
import assert from "node:assert/strict";
import { moveSourceBetweenFeeds } from "../lib/store";
import type { Feed } from "../lib/store";

const source = (id: string, url: string) => ({
  id,
  kind: "feed" as const,
  feedUrl: url,
  siteUrl: "https://example.test",
  title: id,
  favicon: "",
});

const feeds = (): Feed[] => [
  { id: "news", name: "News", sources: [source("a", "https://a.test/rss"), source("b", "https://b.test/rss")] },
  { id: "law", name: "Law", sources: [source("c", "https://c.test/rss")] },
];

test("a dragged source leaves the feed it came from", () => {
  const moved = moveSourceBetweenFeeds(feeds(), "a", "news", "law");
  assert.deepEqual(moved[0].sources.map((s) => s.id), ["b"]);
  assert.deepEqual(moved[1].sources.map((s) => s.id), ["c", "a"]);
});

test("dropping a source on its own feed changes nothing", () => {
  const before = feeds();
  assert.equal(moveSourceBetweenFeeds(before, "a", "news", "news"), before);
});

test("a target that already follows the same URL merges rather than duplicates", () => {
  // Otherwise the same feed would be fetched twice and listed twice.
  const start = feeds();
  start[1].sources.push(source("a-copy", "https://a.test/rss"));

  const moved = moveSourceBetweenFeeds(start, "a", "news", "law");
  assert.deepEqual(moved[0].sources.map((s) => s.id), ["b"], "it still leaves News");
  assert.deepEqual(
    moved[1].sources.map((s) => s.feedUrl),
    ["https://c.test/rss", "https://a.test/rss"],
    "and Law is not left holding it twice",
  );
});

test("a source or feed that is not there is left alone", () => {
  const before = feeds();
  assert.equal(moveSourceBetweenFeeds(before, "nope", "news", "law"), before);
  assert.equal(moveSourceBetweenFeeds(before, "a", "news", "gone"), before);
});

test("the feeds it does not touch are the same objects", () => {
  // React re-renders what changed; rebuilding every feed would redraw the lot.
  const before = feeds();
  before.push({ id: "tech", name: "Tech", sources: [] });
  const moved = moveSourceBetweenFeeds(before, "a", "news", "law");
  assert.equal(moved[2], before[2]);
});
