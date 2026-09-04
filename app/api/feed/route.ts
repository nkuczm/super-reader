import { NextResponse } from "next/server";
import { fetchText, parseFeed, looksLikeFeed, faviconFor } from "@/lib/feed";
import { scrapePage } from "@/lib/scrape";
import { enrichArticles } from "@/lib/enrich";
import { xHandleFrom, fetchXFeed } from "@/lib/x";
import { sortNewestFirst } from "@/lib/sort";

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
        const handle = xHandleFrom(url);
        if (handle) {
          const { meta, articles } = await fetchXFeed(handle);
          return { ok: true as const, ...meta, feedUrl: url, articles };
        }

        const { body, finalUrl } = await fetchText(url);
        // A source may be a real feed or a scraped page; the body tells us.
        const isFeed = looksLikeFeed(body);
        const { meta, articles } = isFeed
          ? parseFeed(body, finalUrl)
          : scrapePage(body, finalUrl);
        // Scraped pages need their summaries filled in; real feeds carry them.
        const ready = sortNewestFirst(
          isFeed
            ? articles
            : await enrichArticles(articles, {
                siteDescription: meta.description,
              }),
        );
        return {
          ok: true as const,
          ...meta,
          feedUrl: url,
          favicon: faviconFor(meta.siteUrl),
          articles: ready,
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
