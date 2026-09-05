import test from "node:test";
import assert from "node:assert/strict";
import { currentSlot } from "../lib/offline";

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
