/**
 * Techmeme's River: every headline Techmeme posts, newest first, five days
 * of it on one page — where its feed holds only the latest fifteen.
 *
 * Measured from a preview deployment, 15 Oct 2026 (docs/COLLECTION.md §2):
 * feed.xml held 15 items spanning 09:30 to 14:10 that day, under five
 * hours; /river held 214, back to the 10th. A reader who looked in twice a
 * day saw a fraction of what Techmeme filed, and a source added that
 * afternoon showed fifteen stories. No sitemap (404); robots.txt allows the
 * River.
 *
 * Each River row carries the same permalink the feed uses as an item's
 * link (`pml="261015p44"` is `/261015/p44#a261015p44`), so a story the feed
 * and the River both list is one story, and what the device already holds
 * from the feed is not listed twice. Its title is written the way the feed
 * writes it, "Headline (Author/Outlet)".
 */

import { decodeEntities } from "./feed";
import type { Article } from "./types";

export const TECHMEME_RIVER = "https://www.techmeme.com/river";

/** Techmeme's own feed: the source the River is read alongside. */
export function isTechmemeFeed(feedUrl: string): boolean {
  try {
    const url = new URL(feedUrl);
    return /^(www\.)?techmeme\.com$/i.test(url.hostname) && url.pathname === "/feed.xml";
  } catch {
    return false;
  }
}

const MONTHS = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];

let newYork: Intl.DateTimeFormat | undefined;

/** How far New York is from UTC at a moment, in ms: Techmeme's clock, summer time and all. */
function newYorkOffset(utcMs: number): number {
  newYork ??= new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York", hourCycle: "h23", year: "numeric", month: "numeric", day: "numeric", hour: "numeric", minute: "numeric",
  });
  const parts = newYork.formatToParts(new Date(utcMs));
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value);
  return Date.UTC(get("year"), get("month") - 1, get("day"), get("hour") % 24, get("minute")) - utcMs;
}

/** A New York wall-clock time as an instant. */
export function fromNewYork(year: number, month: number, day: number, hour: number, minute: number): Date {
  const wall = Date.UTC(year, month, day, hour, minute);
  const guess = wall - newYorkOffset(wall);
  return new Date(wall - newYorkOffset(guess));
}

const text = (html: string) => decodeEntities(html.replace(/<[^>]+>/g, "")).replace(/\s+/g, " ").trim();

/** The River's rows as articles, newest first, under the feed's own links and titles. */
export function riverArticles(html: string): Article[] {
  const articles: Article[] = [];
  let date: [number, number, number] | null = null;
  for (const match of html.matchAll(/<H2>([^<]+)<\/H2>|<tr class="?ritem"?>([\s\S]*?)<\/tr>/gi)) {
    if (match[1] !== undefined) {
      const day = match[1].trim().match(/^([A-Za-z]+) (\d{1,2}), (\d{4})$/);
      const month = day ? MONTHS.indexOf(day[1].toLowerCase()) : -1;
      date = day && month >= 0 ? [Number(day[3]), month, Number(day[2])] : null;
      continue;
    }
    const row = match[2];
    const time = row.match(/<td>\s*(\d{1,2}):(\d{2})\s*([AP]M)/i);
    const pml = row.match(/pml="(\d{6})p(\d+)"/);
    const cite = row.match(/<cite>([\s\S]*?)<\/cite>/i);
    const headline = row.match(/<\/cite>[\s\S]*?<a [^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/i);
    if (!date || !time || !pml || !headline) continue;
    const title = text(headline[2]);
    if (!title) continue;
    const hour = (Number(time[1]) % 12) + (time[3].toUpperCase() === "PM" ? 12 : 0);
    const link = `https://www.techmeme.com/${pml[1]}/p${pml[2]}#a${pml[1]}p${pml[2]}`;
    // "Andrew J. Hawkins / The Verge:" is written "(Andrew J. Hawkins/The Verge)" in the feed.
    const byline = cite ? text(cite[1]).replace(/:$/, "").replace(/\s*\/\s*/g, "/") : "";
    articles.push({
      id: link,
      link,
      title: byline ? `${title} (${byline})` : title,
      publishedAt: fromNewYork(date[0], date[1], date[2], hour, Number(time[2])).toISOString(),
    });
  }
  return articles;
}
