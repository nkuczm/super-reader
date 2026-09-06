import { NextResponse } from "next/server";
import { fetchText } from "@/lib/feed";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// TEMPORARY: inspect what a page actually returns, to work out how to resolve
// Google News wrapper links. Removed once the resolver is written.
export async function GET(request: Request) {
  const url = new URL(request.url).searchParams.get("url");
  if (!url) return NextResponse.json({ error: "Missing ?url" }, { status: 400 });

  const { body, finalUrl } = await fetchText(url);
  const externals = [
    ...new Set(
      [...body.matchAll(/https?:\/\/[^\s"'<>\\]+/g)]
        .map((m) => m[0])
        .filter((u) => !/google\.com|gstatic|googleapis|schema\.org|w3\.org/i.test(u)),
    ),
  ].slice(0, 15);

  return NextResponse.json({
    finalUrl,
    bytes: body.length,
    canonical: body.match(/<link[^>]+rel=["']canonical["'][^>]*>/i)?.[0] ?? null,
    metaRefresh: body.match(/<meta[^>]+http-equiv=["']refresh["'][^>]*>/i)?.[0] ?? null,
    firstAnchor: body.match(/<a\b[^>]*href=["']([^"']+)["']/i)?.[0] ?? null,
    externals,
    head: body.slice(0, 1200),
  });
}
