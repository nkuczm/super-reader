import { NextResponse } from "next/server";
import { fetchText } from "@/lib/feed";

// TEMPORARY measurement probe (docs/COLLECTION.md §5): fixed addresses only, removed in the same session.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

const TARGETS = [
  "https://www.techmeme.com/feed.xml",
  "https://www.techmeme.com/river",
  "https://www.techmeme.com/robots.txt",
  "https://www.techmeme.com/sitemap.xml",
  "https://www.techmeme.com/",
];

export async function GET() {
  const out = await Promise.all(TARGETS.map(async (url) => {
    try {
      const { body: text, finalUrl } = await fetchText(url, 15000);
      const pubDates = [...text.matchAll(/<pubDate>([^<]+)<\/pubDate>/g)].map((m) => m[1]);
      const items = (text.match(/<item>/g) ?? []).length;
      return {
        url,
        finalUrl,
        size: text.length,
        items,
        newest: pubDates[0],
        oldest: pubDates[pubDates.length - 1],
        firstItem: text.slice(text.indexOf("<item>"), text.indexOf("<item>") + 1500),
        ourh: (text.match(/class="?ourh/g) ?? []).length,
        dateMarks: [...text.matchAll(/(\d{1,2}:\d{2}\s?[AP]M[^<]{0,40})/g)].slice(0, 3).map((m) => m[1]),
        head: url.endsWith("feed.xml") ? undefined : text.slice(0, 1200),
        riverSample: url.endsWith("river") ? text.slice(Math.max(0, text.search(/ourh|<table|class="?rv/) - 200), Math.max(0, text.search(/ourh|<table|class="?rv/)) + 2500) : undefined,
        riverTail: url.endsWith("river") ? text.slice(-2500) : undefined,
      };
    } catch (error) {
      return { url, error: error instanceof Error ? error.message : String(error) };
    }
  }));
  return NextResponse.json(out, { headers: { "cache-control": "no-store" } });
}
