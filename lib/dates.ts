/**
 * Dates that a source gives as a day, with no time in them.
 *
 * A bare "2026-09-12" parses as midnight UTC, which is eight in the evening
 * the day before in Washington. Every document in a day's Federal Register
 * therefore landed on one identical timestamp, sorted below anything filed
 * after 8pm Eastern yesterday, and read as stale the morning it came out.
 *
 * Guessing a time would only move the lie around. What these sources do have
 * is a publishing convention: the Federal Register is an issue, and the issue
 * goes live at 8:45am Eastern. That is a real release time and it is the one
 * worth recording. Where there is no such convention, midday in the source's
 * own timezone puts the day in the right place without pretending to an hour.
 *
 * Either way the article is marked `datePrecision: "day"`, so the list can
 * show "12 Sep" instead of quoting a clock time the source never gave.
 */

import type { Article } from "./types";

/** The zone a source publishes in. US federal sources all keep Washington time. */
export const EASTERN = "America/New_York";

/**
 * How far `zone` is from UTC at this instant, in minutes. Derived from the
 * runtime's own timezone data rather than a table of offsets, so the
 * daylight-saving changeover needs no maintenance.
 */
function zoneOffsetMinutes(instant: number, zone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: zone,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(new Date(instant));

  const field = (type: string) =>
    Number(parts.find((part) => part.type === type)?.value);

  const wall = Date.UTC(
    field("year"),
    field("month") - 1,
    field("day"),
    // Some ICU builds render midnight as hour 24 under hour12: false.
    field("hour") % 24,
    field("minute"),
    field("second"),
  );
  return (wall - instant) / 60_000;
}

/**
 * The instant at which it is `hour:minute` in `zone` on the given day.
 *
 * The offset has to be read at the answer rather than at the guess, because
 * on a changeover day the two differ by an hour — so it is applied, then
 * re-read and corrected once.
 */
export function instantAt(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  zone: string,
): number {
  const wall = Date.UTC(year, month - 1, day, hour, minute);
  const firstPass = wall - zoneOffsetMinutes(wall, zone) * 60_000;
  return wall - zoneOffsetMinutes(firstPass, zone) * 60_000;
}

/** "2026-09-12" or "20260912" — a day with no time attached. */
function dayParts(value: string) {
  const dashed = value.trim().match(/^(\d{4})-(\d{2})-(\d{2})$/);
  const compact = value.trim().match(/^(\d{4})(\d{2})(\d{2})$/);
  const match = dashed ?? compact;
  if (!match) return null;
  const [year, month, day] = match.slice(1).map(Number);
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  return { year, month, day };
}

export type DayOptions = {
  /** The timezone the source publishes in. */
  zone?: string;
  /** When on that day the source releases, as "HH:MM" in `zone`. */
  at?: string;
  /** Overridable so the tests are not hostage to the clock. */
  now?: number;
};

export type DatedArticle = Pick<Article, "publishedAt" | "datePrecision">;

/**
 * A source's date as an article's timestamp.
 *
 * Values that carry a time of their own are left alone — this is only for the
 * ones that do not. A day-only value is placed at the source's release time,
 * and never in the future: a document listed for today before the issue drops
 * would otherwise outrank everything actually published this morning.
 */
export function datedFrom(
  value: unknown,
  { zone = EASTERN, at = "12:00", now = Date.now() }: DayOptions = {},
): DatedArticle {
  if (typeof value !== "string" || !value.trim()) return {};

  const parts = dayParts(value);
  if (!parts) {
    // Has a time in it already, or is not a date at all.
    const parsed = Date.parse(value);
    return Number.isNaN(parsed)
      ? {}
      : { publishedAt: new Date(parsed).toISOString() };
  }

  const [hour, minute] = at.split(":").map(Number);
  const released = instantAt(
    parts.year,
    parts.month,
    parts.day,
    Number.isFinite(hour) ? hour : 12,
    Number.isFinite(minute) ? minute : 0,
    zone,
  );

  return {
    publishedAt: new Date(Math.min(released, now)).toISOString(),
    datePrecision: "day",
  };
}
