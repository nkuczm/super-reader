import { NextResponse } from "next/server";
import { fetchText, parseFeed, looksLikeFeed, faviconFor } from "@/lib/feed";
import { scrapePage } from "@/lib/scrape";
import { enrichArticles } from "@/lib/enrich";
import { xHandleFrom, fetchXFeed } from "@/lib/x";
import { sortNewestFirst } from "@/lib/sort";
import { parseApiSourceUrl, fetchApiSource } from "@/lib/apis";
import { decodeKeysHeader, KEYS_HEADER } from "@/lib/vault";

export const runtime = "nodejs";
// Deliberately not force-dynamic: that disables CDN caching, and one source's
// articles are the same for everyone who follows it — see the headers below.
// A feed fetch plus gap-filling takes a moment.
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

/**
 * How long the CDN may serve one source's articles.
 *
 * This is the reason the reader asks for one source per request rather than
 * batching them: a batch's URL is unique to whoever assembled it and can
 * never be shared, while `?url=<one feed>` is the same request every reader
 * following that feed makes — so the second one is served from the edge and
 * never reaches a publisher at all.
 *
 * Two minutes fresh, ten more of stale-while-revalidate. Nothing in a feed
 * changes inside two minutes, and past that a reader gets the list instantly
 * while the edge fetches the new one behind them, which is a better answer to
 * a pull-to-refresh than thirty seconds of spinner.
 */
const FRESH_S = 120;
const STALE_S = 600;

/**
 * A response nobody else can be served.
 *
 * Two cases. A batch carries several feeds and its URL is one reader's own
 * set. And a request carrying API keys is answered with data fetched using
 * that reader's credentials, which must never be handed to the next caller —
 * the keys are in a header, and a CDN keyed on the URL would not know.
 */
function privateResponse(body: unknown) {
  return NextResponse.json(body, {
    headers: { "cache-control": "private, no-store" },
  });
}

/** Refresh one known feed URL. Accepts ?url= repeated for a batch. */
export async function GET(request: Request) {
  const urls = new URL(request.url).searchParams.getAll("url").filter(Boolean);
  // Used for this request only — never logged, never stored.
  const keys = decodeKeysHeader(request.headers.get(KEYS_HEADER));
  if (urls.length === 0) {
    return NextResponse.json({ error: "Missing ?url" }, { status: 400 });
  }

  const shareable = urls.length === 1 && Object.keys(keys ?? {}).length === 0;

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

  if (!shareable) return privateResponse({ results });

  // A source that failed is not cached: a publisher having a bad minute would
  // otherwise be remembered as broken for the next ten.
  if (!results[0]?.ok) return privateResponse({ results });

  return NextResponse.json(
    { results },
    {
      headers: {
        // The browser holds it briefly; the edge is what does the real work.
        // Next strips s-maxage from route handlers, so the CDN lifetime has to
        // be stated in the CDN-specific headers, which it leaves alone.
        "cache-control": "public, max-age=30",
        "cdn-cache-control": `public, s-maxage=${FRESH_S}, stale-while-revalidate=${STALE_S}`,
        "vercel-cdn-cache-control": `public, s-maxage=${FRESH_S}, stale-while-revalidate=${STALE_S}`,
      },
    },
  );
}
