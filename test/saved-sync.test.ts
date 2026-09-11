import test from "node:test";
import assert from "node:assert/strict";
import { mergeSaved, type SavedArticle, type SavedTombstone } from "../lib/store";

/**
 * Saved articles did not sync at all: `saved` was never in the payload, so
 * bookmarks stayed on the device that made them.
 *
 * Adding them raised the question the rest of the document answers with "most
 * recent change wins", which is right for a feed list — edited rarely, and
 * deliberately — and wrong for bookmarks. They are added a few at a time, on
 * whichever device is to hand, often while the other one is asleep. A
 * whole-document replace loses one side's, which is the bug people would hit
 * next. So Saved merges, and these are the cases that has to get right.
 */

const HOUR = 3_600_000;
const NOW = Date.UTC(2026, 8, 11, 12, 0, 0);

function article(link: string, savedAt: number): SavedArticle {
  return { id: link, title: `Story at ${link}`, link, savedAt };
}

test("a bookmark made on each device survives on both", () => {
  const phone = [article("https://a.test/one", NOW - 3 * HOUR)];
  const laptop = [article("https://b.test/two", NOW - 1 * HOUR)];

  const merged = mergeSaved(phone, laptop, [], [], NOW);

  assert.deepEqual(
    merged.saved.map((a) => a.link),
    ["https://b.test/two", "https://a.test/one"],
    "both kept, newest save first",
  );
});

test("the same article saved on two devices is one entry", () => {
  const phone = [article("https://a.test/one", NOW - 3 * HOUR)];
  // Same story, arriving through a feed that adds tracking parameters.
  const laptop = [article("https://a.test/one?utm_source=rss", NOW - 1 * HOUR)];

  const merged = mergeSaved(phone, laptop, [], [], NOW);

  assert.equal(merged.saved.length, 1);
  assert.equal(
    merged.saved[0].savedAt,
    NOW - 3 * HOUR,
    "kept at its earliest save, so the list does not reorder itself",
  );
});

test("removing a bookmark removes it everywhere, instead of coming back", () => {
  // The union is what keeps bookmarks safe, and it is also what would undo a
  // removal: the other device still has the article. The tombstone is how the
  // removal travels.
  const phone: SavedArticle[] = [];
  const phoneRemoved: SavedTombstone[] = [
    { link: "https://a.test/one", at: NOW - 1 * HOUR },
  ];
  const laptop = [article("https://a.test/one", NOW - 5 * HOUR)];

  const merged = mergeSaved(phone, laptop, phoneRemoved, [], NOW);

  assert.deepEqual(merged.saved, []);
  assert.equal(merged.unsaved.length, 1, "and the removal keeps travelling");
});

test("saving something again after removing it wins", () => {
  const removed: SavedTombstone[] = [
    { link: "https://a.test/one", at: NOW - 5 * HOUR },
  ];
  const resaved = [article("https://a.test/one", NOW - 1 * HOUR)];

  const merged = mergeSaved(resaved, [], removed, [], NOW);

  assert.equal(merged.saved.length, 1, "the later action is the one that counts");
});

test("a removal on one device does not undo a later save on the other", () => {
  const phoneRemoved: SavedTombstone[] = [
    { link: "https://a.test/one", at: NOW - 4 * HOUR },
  ];
  const laptop = [article("https://a.test/one", NOW - 2 * HOUR)];

  const merged = mergeSaved([], laptop, phoneRemoved, [], NOW);

  assert.deepEqual(merged.saved.map((a) => a.link), ["https://a.test/one"]);
});

test("tombstones are dropped once they can no longer matter", () => {
  const old: SavedTombstone[] = [
    { link: "https://a.test/ancient", at: NOW - 200 * 24 * HOUR },
    { link: "https://a.test/recent", at: NOW - 2 * 24 * HOUR },
  ];

  const merged = mergeSaved([], [], old, [], NOW);

  assert.deepEqual(
    merged.unsaved.map((t) => t.link),
    ["https://a.test/recent"],
    "a note about a removal 200 days ago has reached every device by now",
  );
});

test("merging is the same whichever device does it", () => {
  const phone = [article("https://a.test/one", NOW - 3 * HOUR)];
  const laptop = [article("https://b.test/two", NOW - 1 * HOUR)];
  const phoneRemoved: SavedTombstone[] = [{ link: "https://c.test/three", at: NOW - 2 * HOUR }];
  const laptopHas = [...laptop, article("https://c.test/three", NOW - 6 * HOUR)];

  const fromPhone = mergeSaved(phone, laptopHas, phoneRemoved, [], NOW);
  const fromLaptop = mergeSaved(laptopHas, phone, [], phoneRemoved, NOW);

  assert.deepEqual(
    fromPhone.saved.map((a) => a.link).sort(),
    fromLaptop.saved.map((a) => a.link).sort(),
    "both devices settle on the same list",
  );
  assert.ok(!fromPhone.saved.some((a) => a.link === "https://c.test/three"));
});

test("rubbish in a synced list does not take the good entries with it", () => {
  const theirs = [
    article("https://a.test/one", NOW - HOUR),
    { title: "no link at all" } as unknown as SavedArticle,
    null as unknown as SavedArticle,
  ];

  const merged = mergeSaved([], theirs, [], [{ at: 1 } as SavedTombstone], NOW);

  assert.deepEqual(merged.saved.map((a) => a.link), ["https://a.test/one"]);
});
