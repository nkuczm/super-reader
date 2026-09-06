import test from "node:test";
import assert from "node:assert/strict";
import {
  currentSlot,
  downloadForOffline,
  type DownloadProgress,
} from "../lib/offline";

/**
 * The download slots are 07:00 and 16:00 America/New_York, which is five or
 * four hours behind UTC depending on the season — the easy thing to get wrong.
 */
test("picks the morning slot between 7am and 4pm ET", () => {
  // 12:00 UTC in January = 07:00 EST.
  assert.equal(currentSlot(new Date("2026-01-15T12:00:00Z")), "2026-01-15-am");
  // 20:59 UTC = 15:59 EST, still the morning slot.
  assert.equal(currentSlot(new Date("2026-01-15T20:59:00Z")), "2026-01-15-am");
});

test("picks the afternoon slot from 4pm ET", () => {
  // 21:00 UTC in January = 16:00 EST.
  assert.equal(currentSlot(new Date("2026-01-15T21:00:00Z")), "2026-01-15-pm");
  assert.equal(currentSlot(new Date("2026-01-16T02:00:00Z")), "2026-01-15-pm");
});

test("before 7am ET still counts as yesterday afternoon's download", () => {
  // 11:00 UTC in January = 06:00 EST, before the morning slot.
  assert.equal(currentSlot(new Date("2026-01-15T11:00:00Z")), "2026-01-14-pm");
});

test("follows daylight saving rather than a fixed offset", () => {
  // 11:00 UTC in July = 07:00 EDT: the morning slot has arrived.
  assert.equal(currentSlot(new Date("2026-07-15T11:00:00Z")), "2026-07-15-am");
  // The same clock time in January is 06:00 EST: it has not.
  assert.equal(currentSlot(new Date("2026-01-15T11:00:00Z")), "2026-01-14-pm");
  // 20:00 UTC in July = 16:00 EDT.
  assert.equal(currentSlot(new Date("2026-07-15T20:00:00Z")), "2026-07-15-pm");
});

test("a new slot means a download is due", () => {
  const morning = currentSlot(new Date("2026-07-15T11:00:00Z"));
  const afternoon = currentSlot(new Date("2026-07-15T20:00:00Z"));
  const nextMorning = currentSlot(new Date("2026-07-16T11:00:00Z"));

  assert.notEqual(morning, afternoon, "7am and 4pm are separate downloads");
  assert.notEqual(afternoon, nextMorning, "the next day is a separate download");
  assert.equal(
    currentSlot(new Date("2026-07-15T12:30:00Z")),
    morning,
    "a second visit inside the same slot does not re-download",
  );
});

/**
 * Progress drives the bar across the top of the screen, so what matters is
 * that it moves once per article and finishes exactly at the total — a bar
 * that stops at 38 of 40 looks like a failure even when nothing failed.
 *
 * IndexedDB does not exist in Node; every store call swallows that and the
 * download still runs, which is the same path a browser in private mode takes.
 */
async function withStubbedFetch<T>(
  handler: (url: string) => { ok: boolean; delay?: number },
  work: () => Promise<T>,
): Promise<T> {
  const real = globalThis.fetch;
  globalThis.fetch = (async (input: any) => {
    const { ok, delay = 0 } = handler(String(input));
    if (delay) await new Promise((resolve) => setTimeout(resolve, delay));
    return {
      ok,
      status: ok ? 200 : 500,
      json: async () => ({ url: String(input), title: "T", html: "<p>x</p>" }),
    } as any;
  }) as typeof fetch;
  try {
    return await work();
  } finally {
    globalThis.fetch = real;
  }
}

test("download progress moves one article at a time and ends at the total", async () => {
  const targets = Array.from({ length: 7 }, (_, i) => ({
    url: `https://example.com/${i}`,
  }));
  const seen: DownloadProgress[] = [];

  const result = await withStubbedFetch(
    () => ({ ok: true }),
    () => downloadForOffline(targets, (progress) => seen.push(progress)),
  );

  assert.equal(result.saved, 7);
  assert.equal(seen.length, 7, "one update per article, not per batch");
  assert.deepEqual(
    seen.map((p) => p.done),
    [1, 2, 3, 4, 5, 6, 7],
    "progress only ever moves forwards",
  );
  assert.ok(seen.every((p) => p.total === 7), "the total is stable throughout");
});

test("articles that fail still advance the bar", async () => {
  const targets = [
    { url: "https://example.com/ok" },
    { url: "https://example.com/blocked" },
    { url: "https://example.com/also-ok" },
  ];
  const seen: DownloadProgress[] = [];

  const result = await withStubbedFetch(
    (url) => ({ ok: !url.includes("blocked") }),
    () => downloadForOffline(targets, (progress) => seen.push(progress)),
  );

  assert.equal(result.saved, 2);
  assert.equal(result.failed, 1);
  assert.equal(
    seen.at(-1)?.done,
    3,
    "a failed article is still one fewer to wait for",
  );
});

test("a repeated article is counted once, so the bar cannot overshoot", async () => {
  const targets = [
    { url: "https://example.com/a" },
    { url: "https://example.com/a" },
    { url: "https://example.com/b" },
  ];
  const seen: DownloadProgress[] = [];

  await withStubbedFetch(
    () => ({ ok: true }),
    () => downloadForOffline(targets, (progress) => seen.push(progress)),
  );

  assert.equal(seen.at(-1)?.total, 2, "the duplicate never counted towards the total");
  assert.equal(seen.at(-1)?.done, 2);
  assert.ok(seen.every((p) => p.done <= p.total));
});
