import test from "node:test";
import assert from "node:assert/strict";
import {
  newSince,
  markFrom,
  acknowledge,
  mergeMarks,
  pruneMarks,
  alertsFor,
} from "../lib/alerts";

const NOW = Date.UTC(2026, 8, 14, 12, 0, 0);
const ago = (m: number) => new Date(NOW - m * 60_000).toISOString();
const post = (id: string, minutes: number) => ({ id, publishedAt: ago(minutes) });

test("turning notifications on does not announce the backlog", () => {
  // The feed already holds forty posts. None of them is news.
  const articles = Array.from({ length: 40 }, (_, i) => post(`p${i}`, i * 10));
  assert.deepEqual(newSince(articles, undefined), []);
  assert.deepEqual(newSince(articles, { at: 0 }), []);
});

test("reports only what arrived after the mark", () => {
  const articles = [post("new2", 1), post("new1", 5), post("seen", 30), post("old", 90)];
  const mark = { at: Date.parse(ago(30)), id: "seen" };
  assert.deepEqual(
    newSince(articles, mark).map((a) => a.id),
    ["new2", "new1"],
  );
});

test("the marked post is never new again, even at the same second", () => {
  const mark = markFrom([post("a", 10)]);
  assert.deepEqual(newSince([post("a", 10)], mark), []);
});

test("acknowledging clears everything currently there", () => {
  const articles = [post("b", 1), post("a", 10)];
  const marks = acknowledge({}, "s1", articles);
  assert.deepEqual(newSince(articles, marks.s1), []);
  // And a post that arrives afterwards is still caught.
  const later = [post("c", 0), ...articles];
  assert.deepEqual(newSince(later, marks.s1).map((a) => a.id), ["c"]);
});

test("a mark never moves backwards", () => {
  // A stale fetch — an offline snapshot, say — must not un-see posts.
  const fresh = acknowledge({}, "s1", [post("new", 1)]);
  const afterStale = acknowledge(fresh, "s1", [post("old", 600)]);
  assert.equal(afterStale.s1.at, fresh.s1.at);
});

test("a feed with no dates never raises an alert", () => {
  // Without dates there is no way to tell a new post from an old one, and a
  // guess would produce false alarms rather than useful ones.
  const undated = [{ id: "x" }, { id: "y" }];
  const mark = markFrom(undated, NOW);
  assert.equal(mark.at, NOW);
  assert.deepEqual(newSince(undated, mark), []);
});

test("merging marks takes the later of each, in either order", () => {
  const desktop = { s1: { at: 500, id: "a" }, s2: { at: 100, id: "b" } };
  const phone = { s1: { at: 200, id: "z" }, s3: { at: 900, id: "c" } };
  const one = mergeMarks(desktop, phone);
  const two = mergeMarks(phone, desktop);
  assert.deepEqual(one, two);
  // Reading on the desktop clears the phone's badge, not the other way round.
  assert.equal(one.s1.at, 500);
  assert.equal(one.s3.at, 900);
});

test("forgets marks for sources that are gone", () => {
  const marks = { keep: { at: 1 }, gone: { at: 2 } };
  assert.deepEqual(pruneMarks(marks, ["keep"]), { keep: { at: 1 } });
});

test("lists the sources with unread posts, busiest first", () => {
  const bySource = new Map([
    ["quiet", [post("q2", 1), post("q1", 40)]],
    ["loud", [post("l3", 2), post("l2", 3), post("l1", 4), post("l0", 50)]],
    ["silent", [post("s1", 200)]],
  ]);
  const marks = {
    quiet: { at: Date.parse(ago(40)), id: "q1" },
    loud: { at: Date.parse(ago(50)), id: "l0" },
    silent: { at: Date.parse(ago(200)), id: "s1" },
  };
  const alerts = alertsFor(
    [{ id: "quiet" }, { id: "loud" }, { id: "silent" }, { id: "unwatched" }],
    bySource,
    marks,
  );
  assert.deepEqual(
    alerts.map((a) => [a.sourceId, a.articles.length]),
    [["loud", 3], ["quiet", 1]],
  );
  // Newest first inside an entry.
  assert.deepEqual(alerts[0].articles.map((a) => a.id), ["l3", "l2", "l1"]);
});

test("an unwatched source raises nothing however busy it is", () => {
  const bySource = new Map([["busy", [post("a", 1), post("b", 2)]]]);
  assert.deepEqual(alertsFor([], bySource, { busy: { at: 1 } }), []);
});
