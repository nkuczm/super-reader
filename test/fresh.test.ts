import test from "node:test";
import assert from "node:assert/strict";
import { arrivals, noteArrivals, seenBefore } from "../lib/fresh";
import { webLink } from "../lib/subjects";
import { canonicalUrl } from "../lib/url";

const story = (link: string, sourceId = "s1", alsoIn?: string[]) => ({ link, sourceId, ...(alsoIn ? { alsoIn } : {}) });

test("a story a refresh brings to a source already followed is new", () => {
  const held = [story("https://example.com/a")];
  const fetched = [story("https://example.com/a"), story("https://example.com/b")];
  assert.deepEqual(arrivals(fetched, held, canonicalUrl), [canonicalUrl("https://example.com/b")]);
});

test("the same story under a tracking tag is not new", () => {
  const held = [story("https://example.com/a")];
  const fetched = [story("https://example.com/a?utm_source=rss")];
  assert.deepEqual(arrivals(fetched, held, canonicalUrl), []);
});

test("a source's first fill, or a device's, lights nothing up", () => {
  // A source just added: its whole backlog arrives at once.
  const held = [story("https://example.com/a", "s1")];
  const fetched = [story("https://other.org/x", "s2"), story("https://other.org/y", "s2")];
  assert.deepEqual(arrivals(fetched, held, canonicalUrl), []);
  // A device with nothing held yet.
  assert.deepEqual(arrivals([story("https://example.com/a")], [], canonicalUrl), []);
});

test("a story filed under a new source but also delivered by a followed one is new", () => {
  const held = [story("https://example.com/a", "s1")];
  const fetched = [story("https://example.com/b", "s2", ["s1"])];
  assert.deepEqual(arrivals(fetched, held, canonicalUrl), [canonicalUrl("https://example.com/b")]);
});

test("the note keeps when each came in, and lets go of what left the list", () => {
  const first = noteArrivals({}, ["a", "b"], new Set(["a", "b"]), 100);
  assert.deepEqual(first, { a: 100, b: 100 });
  // A later refresh: b has left the window, c came in, a keeps its time.
  const second = noteArrivals(first, ["a", "c", "gone"], new Set(["a", "c"]), 200);
  assert.deepEqual(second, { a: 100, c: 200 });
});

test("coming back after being away lets go of what the last visit brought", () => {
  const fresh = { a: 100, b: 200, c: 300 };
  assert.deepEqual(seenBefore(fresh, 200), { c: 300 });
  assert.deepEqual(seenBefore(fresh, 50), fresh);
});

test("a pasted link is kept as itself, not escaped for HTML", () => {
  assert.equal(webLink("https://example.com/a?x=1&y=2"), "https://example.com/a?x=1&y=2");
  assert.equal(webLink("  https://example.com/a  "), "https://example.com/a");
  assert.equal(webLink("example.com/a-story"), "https://example.com/a-story");
  assert.equal(webLink("javascript:alert(1)"), null);
  assert.equal(webLink("not a link"), null);
  assert.equal(webLink("notes"), null);
  assert.equal(webLink(""), null);
});
