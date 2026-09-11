import test from "node:test";
import assert from "node:assert/strict";
import { sweepJobs, sliceCount, sliceInterval } from "../lib/sweep";

/**
 * Sweeping is driven by traffic — a couple of slices per request — so the
 * budget is real and spending it evenly was the wrong call. A front page
 * changes several times an hour and is where a story is first visible; a
 * section timeline that has gone an hour unread has gained a few items in
 * order.
 */

test("front pages lead the sweep, then communities, then section timelines", () => {
  const jobs = sweepJobs();
  const kindOf = (job: (typeof jobs)[number]) =>
    job.kind === "subreddit" ? "reddit" : job.outlet.front ? "front" : "section";

  const order = jobs.map(kindOf);
  const firstReddit = order.indexOf("reddit");
  const firstSection = order.indexOf("section");

  assert.equal(order[0], "front");
  assert.ok(firstReddit > 0 && firstSection > firstReddit, order.join(","));
  // Each group is contiguous, which is what lets a slice have one deadline.
  assert.equal(order.lastIndexOf("front"), firstReddit - 1);
  assert.equal(order.lastIndexOf("reddit"), firstSection - 1);
});

test("a slice's deadline follows what is in it", () => {
  const minutes = Array.from({ length: sliceCount() }, (_, slice) =>
    sliceInterval(slice) / 60_000,
  );

  assert.equal(minutes[0], 15, "front pages are due four times an hour");
  assert.ok(minutes.includes(30), "Reddit's top-of-day does not turn over in 15 minutes");
  assert.ok(minutes.includes(45), "section timelines can wait");
  // Deadlines only ever get longer down the list, which is what makes the
  // fast budget go to the slices worth it.
  assert.deepEqual([...minutes].sort((a, b) => a - b), minutes);
});

test("every panel source lands in exactly one slice", () => {
  const jobs = sweepJobs();
  const ids = jobs.map((job) => (job.kind === "subreddit" ? `r/${job.entry.name}` : job.outlet.id));
  assert.equal(new Set(ids).size, ids.length, "no source is swept twice");
  assert.ok(sliceCount() * 8 >= jobs.length, "and none falls off the end");
});
