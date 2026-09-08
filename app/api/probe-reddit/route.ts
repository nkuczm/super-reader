import { NextResponse } from "next/server";
import { fetchText } from "@/lib/feed";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** TEMPORARY: the raw shape of a subreddit's Atom entries. Remove when done. */
export async function GET(request: Request) {
  const sub = new URL(request.url).searchParams.get("sub") ?? "programming";
  const { body, finalUrl } = await fetchText(
    `https://www.reddit.com/r/${encodeURIComponent(sub)}/.rss`,
    15000,
  );
  const entries = [...body.matchAll(/<entry>([\s\S]*?)<\/entry>/g)]
    .slice(0, 4)
    .map((m) => m[1].slice(0, 1400));
  return NextResponse.json({
    finalUrl,
    length: body.length,
    head: body.slice(0, 700),
    entries,
  });
}
