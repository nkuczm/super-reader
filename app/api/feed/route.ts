import { NextResponse } from "next/server";
import { fetchText, parseFeed, looksLikeFeed, faviconFor } from "@/lib/feed";
import { scrapePage } from "@/lib/scrape";
import { enrichArticles } from "@/lib/enrich";
import { xHandleFrom, fetchXFeed } from "@/lib/x";
import { sortNewestFirst } from "@/lib/sort";
import { parseApiSourceUrl, fetchApiSource } from "@/lib/apis";
import { decodeKeysHeader, KEYS_HEADER } from "@/lib/vault";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// Feed fetches plus gap-filling for several sources take a moment.
export const maxDuration = 60;

const MAX_PER_SOURCE = 40;

/**
 * How long a source may spend filling in missing images and summaries.
 *
 * Sources run in parallel, so this is close to what it adds to a refresh.
 * Before there was a budget, gap-filling ran three sequential waves of page
 * fetches at a nine-second timeout each — a refresh waited on the slowest
 * source's slowest page, which is where the half-minute went. What is not
 * filled in inside the budget keeps whatever its feed gave it, and is cached
 * once it is looked up, so a source settles over a couple of refreshes rather
 * than holding the whole list up on the first.
 */
const ENRICH_BUDGET_MS = 4000;

/** Refresh one known feed URL. Accepts ?url= repeated for a batch. */
export async function GET(request: Request) {
  const urls = new URL(request.url).searchParams.getAll("url").filter(Boolean);
  // Used for this request only — never logged, never stored.
  const keys = decodeKeysHeader(request.headers.get(KEYS_HEADER));
  if (urls.length === 0) {
    return NextResponse.json({ error: "Missing ?url" }, { status: 400 });
  }

  const results = await Promise.all(
    urls.map(async (url) => {
      try {
        if (parseApiSourceUrl(url)) {
          const { meta, articles } = await fetchApiSource(url, MAX_PER_SOURCE, keys);
          return { ok: true as const, ...meta, feedUrl: url, articles };
        }

        const handle = xHandleFrom(url);
        if (handle) {
          const { meta, articles } = await fetchXFeed(handle);
          return { ok: true as const, ...meta, feedUrl: url, articles };
        }

        const { body, finalUrl } = await fetchText(url);
        // A source may be a real feed or a scraped page; the body tells us.
        const { meta, articles } = looksLikeFeed(body)
          ? parseFeed(body, finalUrl)
          : scrapePage(body, finalUrl);

        // A big archive feed can carry hundreds of entries; only the recent
        // ones are ever read, and the cap bounds both payload and enrichment.
        const recent = sortNewestFirst(articles).slice(0, MAX_PER_SOURCE);
        const ready = await enrichArticles(recent, {
          siteDescription: meta.description,
          budgetMs: ENRICH_BUDGET_MS,
        });
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
