import { NextResponse } from "next/server";
import { fetchText } from "@/lib/feed";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** TEMPORARY: is a URL reachable from here, and what does it hold? */
export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const url = params.get("url")!;
  const len = Number(params.get("len") ?? 1200);
  const grep = params.get("grep");
  try {
    const { body, finalUrl } = await fetchText(url, 20000);
    return NextResponse.json({
      finalUrl,
      length: body.length,
      // Newest dates present, to tell fresh from frozen.
      dates: [...new Set([...body.matchAll(/\b20\d\d-\d\d-\d\d/g)].map((m) => m[0]))]
        .sort()
        .slice(-4),
      matches: grep
        ? [...body.matchAll(new RegExp(grep, "gi"))].slice(0, 6).map((m) => m[0].slice(0, 200))
        : undefined,
      head: body.slice(0, len),
    });
  } catch (error) {
    return NextResponse.json({
      error: error instanceof Error ? error.message : "failed",
    });
  }
}
