import { NextResponse } from "next/server";
import { fetchText, parseFeed, looksLikeFeed, faviconFor } from "@/lib/feed";
import { scrapePage } from "@/lib/scrape";
import {
  looksLikeSitemap,
  parseSitemap,
  articlesFromSitemap,
  titleFromSlug,
} from "@/lib/sitemap";
import { enrichArticles } from "@/lib/enrich";
import { xSourceFrom, fetchXSource } from "@/lib/x";
import { instagramHandleFrom, fetchInstagramFeed } from "@/lib/instagram";
import { sortNewestFirst } from "@/lib/sort";
import { parseApiSourceUrl, fetchApiSource } from "@/lib/apis";
import { decodeKeysHeader, KEYS_HEADER } from "@/lib/vault";
import { fetchRedditFeed, isRedditFeed } from "@/lib/reddit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// Feed fetches plus gap-filling for several sources take a moment.
export const maxDuration = 60;

const MAX_PER_SOURCE = 40;
/** Sources one refresh may fetch. Well past any real sidebar. */
const MAX_SOURCES = 60;
/** How many of them are read at the same time. */
const SOURCE_CONCURRENCY = 8;
/**
 * Gap-filling requests per source. A big refresh cuts its own budget: at
 * fifteen apiece, a full sidebar asks for hundreds of pages that nobody has
 * scrolled to yet, and the ones that matter are at the top of each source.
 */
const enrichBudget = (sources: number) => (sources > 10 ? 6 : 15);
/** Sitemap sources cost one request per item to title; keep the list shorter. */
const SITEMAP_ITEMS = 25;

/** Refresh one known feed URL. Accepts ?url= repeated for a batch. */
export async function GET(request: Request) {
  /**
   * One request, one reader's sources. The cap matters because this route
   * fans out: without it a single call with five hundred `url` parameters is
   * five hundred outbound fetches plus their gap-filling, which is both a way
   * to exhaust this function and a way to use the deployment to hammer
   * someone else. Duplicates are dropped for the same reason.
   */
  const urls = [
    ...new Set(new URL(request.url).searchParams.getAll("url").filter(Boolean)),
  ].slice(0, MAX_SOURCES);
  // Used for this request only — never logged, never stored.
  const keys = decodeKeysHeader(request.headers.get(KEYS_HEADER));
  if (urls.length === 0) {
    return NextResponse.json({ error: "Missing ?url" }, { status: 400 });
  }

  /**
   * Sources are refreshed a few at a time, not all at once.
   *
   * Each one is a fetch plus up to fifteen more to fill in missing summaries
   * and images, so a sidebar of twenty sources fanned out to three hundred
   * concurrent outbound requests from a single function — which is how a
   * refresh turns into timeouts and reset connections rather than a fast
   * refresh. Eight at a time keeps it to roughly fifty in flight, and the
   * sources still overlap, so the wall-clock cost is small.
   */
  const readOne = async (url: string) => {
      try {
        if (parseApiSourceUrl(url)) {
          const { meta, articles } = await fetchApiSource(url, MAX_PER_SOURCE, keys);
          return { ok: true as const, ...meta, feedUrl: url, articles };
        }

        const igHandle = instagramHandleFrom(url);
        if (igHandle) {
          const { meta, articles } = await fetchInstagramFeed(igHandle, MAX_PER_SOURCE);
          return { ok: true as const, ...meta, feedUrl: url, articles };
        }

        const xSource = xSourceFrom(url);
        if (xSource) {
          const { meta, articles } = await fetchXSource(xSource, MAX_PER_SOURCE);
          return { ok: true as const, ...meta, feedUrl: url, articles };
        }

        const { body, finalUrl } = isRedditFeed(url)
          ? await fetchRedditFeed(url)
          : await fetchText(url);

        // A sitemap source refreshes by re-reading the sitemap. It has to be
        // tested before looksLikeFeed, which only asks whether the body opens
        // with XML — and a sitemap does.
        if (looksLikeSitemap(body)) {
          const parsed = parseSitemap(body, finalUrl);
          const entries = parsed.kind === "urlset" ? parsed.entries : [];
          // Fewer than a feed gets. A sitemap entry has no headline of its
          // own, so each one costs a request to read the page's title, and
          // twenty-five properly titled stories beat forty where the last
          // fifteen are URL slugs.
          const found = articlesFromSitemap(entries, { limit: SITEMAP_ITEMS }).map(
            (article) => ({
              ...article,
              title: article.title || titleFromSlug(article.link),
            }),
          );
          const host = new URL(finalUrl).hostname.replace(/^www\./, "");
          return {
            ok: true as const,
            feedUrl: url,
            siteUrl: new URL(finalUrl).origin,
            title: host,
            favicon: faviconFor(finalUrl),
            articles: await enrichArticles(found, { max: SITEMAP_ITEMS }),
          };
        }

        // A source may be a real feed or a scraped page; the body tells us.
        const { meta, articles } = looksLikeFeed(body)
          ? parseFeed(body, finalUrl)
          : scrapePage(body, finalUrl);

        // A big archive feed can carry hundreds of entries; only the recent
        // ones are ever read, and the cap bounds both payload and enrichment.
        const recent = sortNewestFirst(articles).slice(0, MAX_PER_SOURCE);
        const ready = await enrichArticles(recent, {
          siteDescription: meta.description,
          max: enrichBudget(urls.length),
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
  };

  const results: Awaited<ReturnType<typeof readOne>>[] = [];
  for (let i = 0; i < urls.length; i += SOURCE_CONCURRENCY) {
    results.push(
      ...(await Promise.all(urls.slice(i, i + SOURCE_CONCURRENCY).map(readOne))),
    );
  }

  return NextResponse.json({ results });
}
