import { NextResponse } from "next/server";
import { fetchText, parseFeed, faviconFor } from "@/lib/feed";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Refresh one known feed URL. Accepts ?url= repeated for a batch. */
export async function GET(request: Request) {
  const urls = new URL(request.url).searchParams.getAll("url").filter(Boolean);
  if (urls.length === 0) {
    return NextResponse.json({ error: "Missing ?url" }, { status: 400 });
  }

  const results = await Promise.all(
    urls.map(async (url) => {
      try {
        const { body, finalUrl } = await fetchText(url);
        const { meta, articles } = parseFeed(body, finalUrl);
        return {
          ok: true as const,
          ...meta,
          feedUrl: url,
          favicon: faviconFor(meta.siteUrl),
          articles,
        };
      } catch (error) {
        return {
          feedUrl: url,
          ok: false as const,
          error: error instanceof Error ? error.message : "Fetch failed",
          articles: [],
        };
      }
    }),
  );

  return NextResponse.json({ results });
}
