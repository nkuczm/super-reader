import { NextResponse } from "next/server";
import { fetchText } from "@/lib/feed";

// TEMPORARY measurement probe (docs/COLLECTION.md §5): fixed addresses only, removed in the same session.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

export async function GET() {
  const { body } = await fetchText("https://www.techmeme.com/river", 15000);
  const permalinks = [...body.matchAll(/techmeme\.com\/(\d{6})\/p(\d+)/g)].map((m) => `${m[1]}/p${m[2]}`);
  const days = [...new Set(permalinks.map((p) => p.slice(0, 6)))];
  const first = body.search(/Intel|Volvo/);
  const tables = (body.match(/<TABLE/gi) ?? []).length;
  const classes = new Map<string, number>();
  for (const m of body.matchAll(/class="?([a-z0-9_-]+)/gi)) classes.set(m[1], (classes.get(m[1]) ?? 0) + 1);
  const dayHeads = [...body.matchAll(/((?:Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday),? [A-Z][a-z]+ \d{1,2}, \d{4})/g)].map((m) => m[1]);
  return NextResponse.json({
    size: body.length,
    permalinks: permalinks.length,
    uniquePermalinks: new Set(permalinks).size,
    days,
    dayHeads: [...new Set(dayHeads)],
    tables,
    classes: [...classes].sort((a, b) => b[1] - a[1]).slice(0, 25),
    around: body.slice(Math.max(0, first - 1500), first + 2500),
    later: body.slice(Math.floor(body.length * 0.6), Math.floor(body.length * 0.6) + 2000),
  }, { headers: { "cache-control": "no-store" } });
}
