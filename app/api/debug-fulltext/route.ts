import { NextResponse } from "next/server";
import { fetchText, looksLikeFeed, stripHtml, stripChrome } from "@/lib/feed";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// TEMPORARY: measures whether a feed syndicates full article text or only a
// teaser. Removed once the survey is done.
export async function GET(request: Request) {
  const urls = new URL(request.url).searchParams.getAll("url");
  if (urls.length === 0) {
    return NextResponse.json({ error: "Missing ?url" }, { status: 400 });
  }

  const results = await Promise.all(
    urls.map(async (url) => {
      try {
        const { body } = await fetchText(url, 12000);
        if (!looksLikeFeed(body)) return { url, error: "not a feed" };

        const items = [...body.matchAll(/<(item|entry)[\s\S]*?<\/\1>/gi)]
          .slice(0, 4)
          .map((m) => m[0]);

        const field = (item: string, name: string) =>
          item.match(new RegExp(`<${name}[^>]*>([\\s\\S]*?)</${name}>`, "i"))?.[1] ?? "";

        const lengths = items.map((item) => {
          const encoded = field(item, "content:encoded") || field(item, "content");
          const description = field(item, "description") || field(item, "summary");
          const prose = (html: string) =>
            stripHtml(stripChrome(html), Number.MAX_SAFE_INTEGER).length;
          return { encoded: prose(encoded), description: prose(description) };
        });

        const best = lengths.map((l) => Math.max(l.encoded, l.description));
        const median = best.sort((a, b) => a - b)[Math.floor(best.length / 2)] ?? 0;

        return {
          url,
          items: items.length,
          medianProseChars: median,
          // The threshold fetchFeedItemContent uses to accept a feed copy.
          fullText: median >= 1200,
          perItem: lengths,
        };
      } catch (error) {
        return { url, error: error instanceof Error ? error.message : "failed" };
      }
    }),
  );

  return NextResponse.json({ results });
}
