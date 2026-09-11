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
          const found = articlesFromSitemap(entries, { limit: MAX_PER_SOURCE }).map(
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
            articles: await enrichArticles(found, { max: 20 }),
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
