import test from "node:test";
import assert from "node:assert/strict";
import { datedFrom, instantAt, EASTERN } from "../lib/dates";

/**
 * The bug these cover: a source that gives a day and no time used to parse as
 * midnight UTC — eight in the evening the day before in Washington. Every
 * document in a day's Federal Register landed on one identical timestamp, and
 * sorted below anything filed after 8pm Eastern the night before.
 */

/** Well after anything the fixtures date, so the clamp never interferes. */
const LATER = Date.parse("2027-01-01T00:00:00Z");

test("a bare day is placed at the source's release time, not at midnight UTC", () => {
  // The Federal Register's issue goes live at 8:45am Eastern. In September
  // that is EDT, four hours behind UTC.
  const dated = datedFrom("2026-09-12", { at: "08:45", now: LATER });
  assert.equal(dated.publishedAt, "2026-09-12T12:45:00.000Z");
  assert.equal(dated.datePrecision, "day");
});

test("the release time follows daylight saving rather than a fixed offset", () => {
  // January is EST, five hours behind; September is EDT, four.
  const winter = datedFrom("2026-01-15", { at: "08:45", now: LATER });
  const summer = datedFrom("2026-07-15", { at: "08:45", now: LATER });
  assert.equal(winter.publishedAt, "2026-01-15T13:45:00.000Z");
  assert.equal(summer.publishedAt, "2026-07-15T12:45:00.000Z");
});

test("a day lands on that day for a reader anywhere, which midnight did not", () => {
  // The whole point of a midday release time: 00:00Z reads as the previous
  // evening across the Americas. Any sane offset keeps the date intact.
  const dated = datedFrom("2026-09-12", { at: "08:45", now: LATER });
  const at = Date.parse(dated.publishedAt!);
  for (const offsetHours of [-8, -5, 0, 1, 5.5, 9]) {
    const local = new Date(at + offsetHours * 3_600_000);
    assert.equal(
      local.toISOString().slice(0, 10),
      "2026-09-12",
      `still the twelfth at UTC${offsetHours >= 0 ? "+" : ""}${offsetHours}`,
    );
  }
});

test("a day's documents no longer sort below the previous evening", () => {
  const notice = datedFrom("2026-09-12", { at: "08:45", now: LATER });
  // A wire story filed at 9pm Eastern on the 11th — which used to win.
  const lastNight = Date.parse("2026-09-12T01:00:00Z");
  assert.ok(
    Date.parse(notice.publishedAt!) > lastNight,
    "the morning's notice outranks last night",
  );
});

test("the default is midday, for sources with no published release time", () => {
  const dated = datedFrom("2026-09-12", { now: LATER });
  assert.equal(dated.publishedAt, "2026-09-12T16:00:00.000Z");
  assert.equal(dated.datePrecision, "day");
});

test("a value that already carries a time is left exactly as it is", () => {
  const dated = datedFrom("2026-09-12T14:23:45Z", { now: LATER });
  assert.equal(dated.publishedAt, "2026-09-12T14:23:45.000Z");
  assert.equal(
    dated.datePrecision,
    undefined,
    "it is not a day-precision date, so the list should show the time",
  );
});

test("a compact date is a day too", () => {
  // openFDA writes them as 20260912.
  const dated = datedFrom("20260912", { at: "08:45", now: LATER });
  assert.equal(dated.publishedAt, "2026-09-12T12:45:00.000Z");
  assert.equal(dated.datePrecision, "day");
});

test("a release time still to come today is clamped to now", () => {
  // A document listed for today, read before the issue drops, must not
  // outrank everything actually published this morning.
  const early = Date.parse("2026-09-12T11:00:00Z");
  const dated = datedFrom("2026-09-12", { at: "08:45", now: early });
  assert.equal(dated.publishedAt, new Date(early).toISOString());
});

test("nothing usable yields nothing rather than a wrong date", () => {
  assert.deepEqual(datedFrom(undefined), {});
  assert.deepEqual(datedFrom(""), {});
  assert.deepEqual(datedFrom("not a date"), {});
  assert.deepEqual(datedFrom(20260912 as unknown as string), {});
  assert.deepEqual(datedFrom("2026-13-45"), {}, "an impossible day is not a day");
});

test("the offset is read at the answer, so a changeover day is right", () => {
  // 2026's spring forward is 8 March, 2am local. A morning release on that
  // day is already EDT even though the day began EST.
  assert.equal(
    new Date(instantAt(2026, 3, 8, 8, 45, EASTERN)).toISOString(),
    "2026-03-08T12:45:00.000Z",
  );
  // The day before is still EST.
  assert.equal(
    new Date(instantAt(2026, 3, 7, 8, 45, EASTERN)).toISOString(),
    "2026-03-07T13:45:00.000Z",
  );
});

test("midday is unambiguous on both changeover days", () => {
  // Neither the lost hour nor the repeated one touches noon.
  assert.equal(
    new Date(instantAt(2026, 11, 1, 12, 0, EASTERN)).toISOString(),
    "2026-11-01T17:00:00.000Z",
  );
});
