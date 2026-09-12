import test from "node:test";
import assert from "node:assert/strict";
import {
  mergeSaved,
  differsFrom,
  slimForSync,
  REMOVAL_TTL_MS,
  MAX_SAVED,
} from "../lib/saved";
import { MAX_PAYLOAD_BYTES } from "../lib/sync";
import type { SavedArticle, SavedState } from "../lib/saved";

const NOW = Date.UTC(2026, 8, 11, 12, 0, 0);
const ago = (h: number) => NOW - h * 3_600_000;

function saved(link: string, at: number, extra: Partial<SavedArticle> = {}): SavedArticle {
  return { id: link, title: `Story ${link}`, link, savedAt: at, ...extra };
}
const state = (s: SavedArticle[], r: SavedState["removals"] = []): SavedState => ({
  saved: s,
  removals: r,
});

test("keeps what both devices saved", () => {
  // The failure this exists to prevent: whole-list replacement meant the
  // phone saving something deleted what the desktop saved that morning.
  const desktop = state([saved("https://a.example/1", ago(6))]);
  const phone = state([saved("https://b.example/2", ago(1))]);
  const merged = mergeSaved(desktop, phone, NOW);
  assert.deepEqual(
    merged.saved.map((a) => a.link),
    ["https://b.example/2", "https://a.example/1"],
    "newest first, and nothing dropped",
  );
});

test("one article, however its link was dressed up", () => {
  const merged = mergeSaved(
    state([saved("https://wsj.com/story?mod=rss_worldnews", ago(5))]),
    state([saved("https://www.wsj.com/story", ago(2), { title: "Newer copy" })]),
    NOW,
  );
  assert.equal(merged.saved.length, 1);
  assert.equal(merged.saved[0].title, "Newer copy", "the newer record wins");
});

test("un-saving survives a device that still has the article", () => {
  const phone = state([], [{ link: "https://a.example/1", at: ago(1) }]);
  const desktop = state([saved("https://a.example/1", ago(6))]);
  const merged = mergeSaved(phone, desktop, NOW);
  assert.deepEqual(merged.saved, [], "the removal is newer, so it wins");
  assert.equal(merged.removals.length, 1, "and it keeps travelling");
});

test("saving it again brings it back", () => {
  const merged = mergeSaved(
    state([saved("https://a.example/1", ago(1))]),
    state([], [{ link: "https://a.example/1", at: ago(4) }]),
    NOW,
  );
  assert.deepEqual(merged.saved.map((a) => a.link), ["https://a.example/1"]);
  assert.deepEqual(
    merged.removals,
    [],
    "the stale tombstone is dropped, or it would suppress the article again",
  );
});

test("merging is order-independent", () => {
  const a = state([saved("https://a.example/1", ago(3)), saved("https://a.example/2", ago(9))]);
  const b = state([saved("https://a.example/2", ago(2))], [{ link: "https://a.example/1", at: ago(1) }]);
  const one = mergeSaved(a, b, NOW);
  const two = mergeSaved(b, a, NOW);
  assert.deepEqual(one.saved.map((x) => x.link), two.saved.map((x) => x.link));
  assert.deepEqual(one.removals, two.removals);
  // The removal is the most recent thing to happen to /1; /2's newer copy stays.
  assert.deepEqual(one.saved.map((x) => x.link), ["https://a.example/2"]);
});

test("forgets tombstones once every device must have seen them", () => {
  const old = { link: "https://a.example/1", at: NOW - REMOVAL_TTL_MS - 1000 };
  const merged = mergeSaved(state([], [old]), state([]), NOW);
  assert.deepEqual(merged.removals, []);
});

test("stays inside what a synced document can carry", () => {
  const many = Array.from({ length: MAX_SAVED + 120 }, (_, i) =>
    saved(`https://a.example/${i}`, ago(i)),
  );
  const merged = mergeSaved(state(many), state([]), NOW);
  assert.equal(merged.saved.length, MAX_SAVED);
  // The cap drops the oldest, not the newest.
  assert.equal(merged.saved[0].link, "https://a.example/0");
});

test("knows when a merge has something the other side needs", () => {
  const theirs = state([saved("https://a.example/1", ago(5))]);
  const same = mergeSaved(theirs, theirs, NOW);
  assert.equal(differsFrom(same, theirs), false);

  const withMine = mergeSaved(state([saved("https://a.example/2", ago(1))]), theirs, NOW);
  assert.equal(differsFrom(withMine, theirs), true);

  // A removal they have not seen still has to travel.
  const withRemoval = mergeSaved(
    state([], [{ link: "https://a.example/1", at: ago(1) }]),
    theirs,
    NOW,
  );
  assert.equal(differsFrom(withRemoval, theirs), true);
});

test("a full payload still fits in what the sync route accepts", () => {
  // A payload over the ceiling is refused outright, which stops feeds and
  // read-marks syncing too — not just bookmarks. So the test is the whole
  // document at its worst, not the bookmark list alone.
  const many = Array.from({ length: 900 }, (_, i) => ({
    id: `id-${i}`,
    title: `A reasonably long headline about the day's events, number ${i}`,
    link: `https://example.com/section/some-slug-for-story-${i}`,
    savedAt: ago(i),
    summary: "x".repeat(1200),
    image: `https://images.example.com/${i}.jpg`,
    sourceTitle: "The Wall Street Journal",
    favicon: "https://www.google.com/s2/favicons?domain=wsj.com&sz=64",
    html: "y".repeat(5000),
  })) as unknown as SavedArticle[];

  const wire = slimForSync(many);
  assert.equal(wire.length, MAX_SAVED, "capped at what can be carried");
  assert.equal((wire[0] as { html?: string }).html, undefined, "bodies are not synced");
  assert.equal(wire[0].summary?.length, 200, "summaries are trimmed");
  // Everything needed to show the entry and open it survives.
  assert.equal(wire[0].title, many[0].title);
  assert.equal(wire[0].link, many[0].link);

  const payload = {
    feeds: Array.from({ length: 40 }, (_, i) => ({
      id: `f${i}`,
      name: `Feed ${i}`,
      sources: [{ id: `s${i}`, feedUrl: `https://example.com/feed/${i}`, title: `Source ${i}` }],
    })),
    // The route keeps the most recent 3,000 read-marks.
    read: Array.from({ length: 3000 }, (_, i) => `https://example.com/read/story-${i}`),
    saved: wire,
    savedRemovals: Array.from({ length: 400 }, (_, i) => ({
      link: `https://example.com/removed/${i}`,
      at: ago(i),
    })),
    updatedAt: NOW,
  };
  const bytes = JSON.stringify(payload).length;
  assert.ok(
    bytes < MAX_PAYLOAD_BYTES,
    `${bytes} bytes exceeds the ${MAX_PAYLOAD_BYTES} the route accepts`,
  );
});

test("a day-precision date survives the trip to another device", () => {
  // Otherwise the other device shows "8:00 PM" under a Federal Register
  // notice — a time its source never gave. See lib/dates.ts.
  const notice: SavedArticle = {
    id: "fr1",
    title: "Rule on emissions",
    link: "https://www.federalregister.gov/documents/2026/0001",
    publishedAt: "2026-01-05T13:45:00.000Z",
    datePrecision: "day",
    savedAt: NOW,
  };
  const [wire] = slimForSync([notice]);
  assert.equal(wire.publishedAt, "2026-01-05T13:45:00.000Z");
  assert.equal(wire.datePrecision, "day");

  // And an ordinary article is not given one it never had.
  const ordinary: SavedArticle = { ...notice, datePrecision: undefined };
  assert.equal("datePrecision" in slimForSync([ordinary])[0], false);
});

test("a trimmed copy cannot shorten the fuller local one", () => {
  const full = saved("https://a.example/1", ago(3), { summary: "F".repeat(600) });
  const [wire] = slimForSync([full]);
  const merged = mergeSaved(state([full]), state([wire]), NOW);
  assert.equal(merged.saved[0].summary?.length, 600);
});
