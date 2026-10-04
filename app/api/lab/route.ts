// TEMPORARY measurement probe — removed in the same session (docs/COLLECTION.md §5).
import { NextResponse } from "next/server";
import { fetchText } from "@/lib/feed";

export async function GET() {
  const url = "https://support.claude.com/en/articles/12738598-adapt-to-new-model-personas-after-deprecations";
  const { body } = await fetchText(url, 10000);
  const start = body.indexOf("Strategies and recommendations");
  const end = body.indexOf("These strategies", start);
  // Structure only: text is replaced by its length, attributes kept for tags and classes.
  const seg = body.slice(Math.max(0, start - 600), end + 50).replace(/>([^<]+)</g, (_, t) => `>[${t.trim().length}]<`);
  return NextResponse.json({ bytes: body.length, start, end, structure: seg.slice(0, 6000) }, { headers: { "cache-control": "no-store" } });
}
