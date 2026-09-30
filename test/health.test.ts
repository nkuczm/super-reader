import test from "node:test";
import assert from "node:assert/strict";
import { assess, recordRuns, statusIn, type HealthLog } from "../lib/health";

const DAY = 24 * 60 * 60 * 1000;
const NOW = new Date("2026-09-30T12:00:00").getTime();
const following = new Set(["s1"]);

function history(runs: { daysAgo: number; ok?: boolean; fetched: number; held: number; newestDaysAgo?: number; error?: string }[]): HealthLog {
  let log: HealthLog = {};
  for (const run of runs) {
    const at = NOW - run.daysAgo * DAY;
    log = recordRuns(log, {
      s1: {
        at,
        ok: run.ok ?? true,
        fetched: run.fetched,
        held: run.held,
        newest: run.newestDaysAgo === undefined ? at - 3600_000 : NOW - run.newestDaysAgo * DAY,
        error: run.error,
      },
    }, following);
  }
  return log;
}

test("a status code is read out of an error message", () => {
  assert.equal(statusIn("403 Forbidden"), 403);
  assert.equal(statusIn("timed out"), undefined);
});

test("nothing arriving and nothing cached is broken", () => {
  const log = history([{ daysAgo: 0, ok: false, fetched: 0, held: 0, error: "500 Server Error" }]);
  assert.equal(assess(log.s1, NOW).verdict, "broken");
});

test("repeated refusals behind a cache are losing access, not healthy", () => {
  const log = history([
    { daysAgo: 2, fetched: 20, held: 20 },
    { daysAgo: 1, ok: false, fetched: 0, held: 20, error: "403 Forbidden" },
    { daysAgo: 0, ok: false, fetched: 0, held: 20, error: "403 Forbidden" },
  ]);
  const verdict = assess(log.s1, NOW);
  assert.equal(verdict.verdict, "losing-access");
  assert.match(verdict.reason, /403/);
});

test("a feed returning far less than it used to is declining", () => {
  const log = history([
    ...[7, 6, 5, 4, 3, 2, 1].map((daysAgo) => ({ daysAgo, fetched: 30, held: 60 })),
    { daysAgo: 0, fetched: 6, held: 60 },
  ]);
  assert.equal(assess(log.s1, NOW).verdict, "declining");
});

test("a slow publication answering fine is quiet, not broken", () => {
  const log = history([{ daysAgo: 0, fetched: 20, held: 10, newestDaysAgo: 30 }]);
  assert.equal(assess(log.s1, NOW).verdict, "quiet");
});

test("a normal source is healthy, and an unfollowed one is forgotten", () => {
  const log = history([{ daysAgo: 0, fetched: 20, held: 40 }]);
  assert.equal(assess(log.s1, NOW).verdict, "healthy");
  assert.deepEqual(recordRuns(log, {}, new Set()), {});
});
