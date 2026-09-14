import { NextResponse } from "next/server";
import { fetchText, parseFeed, looksLikeFeed, faviconFor } from "@/lib/feed";
import { scrapePage } from "@/lib/scrape";
import { enrichArticles } from "@/lib/enrich";
import { xHandleFrom, fetchXFeed } from "@/lib/x";
import { sortNewestFirst } from "@/lib/sort";
import { parseApiSourceUrl, fetchApiSource } from "@/lib/apis";
import { decodeKeysHeader, KEYS_HEADER } from "@/lib/vault";
import { parseBundle, mergeBundled, PER_MEMBER } from "@/lib/bundle";
import { canonicalUrl } from "@/lib/url";
import { augment } from "@/lib/harvest";
import { looksLikeSitemap, parseSitemap } from "@/lib/sitemap";
import { keepArticles } from "@/lib/authentic";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// Feed fetches plus gap-filling for several sources take a moment.
export const maxDuration = 60;

/**
 * How many items to take from one source.
 *
 * Raised from 40 to 100 once sources could carry several feeds, then to 250
 * once they could also carry a news sitemap: the Guardian's lists over 400
 * stories from the last two days, and a cap of 100 was throwing three
 * quarters of a caught day away after the work of catching it. Matched to
 * KEEP_PER_SOURCE in lib/window.ts, which is what the reader will hold
 * anyway — a lower number here just loses stories on the way.
 */
const MAX_PER_SOURCE = 250;

/**
 * A news sitemap, read as though it were a feed.
 *
 * A sitemap has no channel title or description of its own, so the source is
 * named after the site it belongs to and the reader sees no difference. The
 * entries are judged before they are returned: a sitemap that is not a news
 * sitemap lists every page a site has, contact forms included.
 */
function readSitemapAsSource(body: string, finalUrl: string) {
  const parsed = parseSitemap(body, finalUrl);
  if (parsed.kind !== "urls" || parsed.articles.length === 0) {
    throw new Error("That sitemap lists no articles");
  }
  const origin = new URL(finalUrl).origin;
  const { kept } = keepArticles(parsed.articles, { origin, from: "sitemap" });
  if (kept.length === 0) throw new Error("That sitemap lists no articles");
  return {
    meta: {
      feedUrl: finalUrl,
      siteUrl: origin,
      title: new URL(origin).hostname.replace(/^www\./, ""),
      description: undefined as string | undefined,
      favicon: "",
    },
    articles: kept,
  };
}

/** The site root a sitemap would live at, or nothing if this is not a site. */
function originOf(siteUrl: string | undefined) {
  if (!siteUrl) return undefined;
  try {
    return new URL(siteUrl).origin;
  } catch {
    return undefined;
  }
}

/** Refresh one known feed URL. Accepts ?url= repeated for a batch. */
export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const urls = params.getAll("url").filter(Boolean);
  /**
   * Sources the caller says follow a whole publisher, and may therefore also
   * collect from that publisher's news sitemap.
   *
   * Opt-in rather than inferred. It was briefly inferred from the paths a
   * feed's own stories shared, which works until a publisher files every
   * story under an opaque path: the BBC puts all of them at
   * /news/articles/<id>, so a technology feed looks exactly like a site-wide
   * one and its source filled up with football. Guessing wrong in that
   * direction is worse than collecting less, so it is no longer guessed.
   */
  const whole = new Set(params.getAll("whole"));
  // Used for this request only — never logged, never stored.
  const keys = decodeKeysHeader(request.headers.get(KEYS_HEADER));
  if (urls.length === 0) {
    return NextResponse.json({ error: "Missing ?url" }, { status: 400 });
  }

  /** One feed, read and parsed. The unit a source is built out of. */
  async function readFeed(url: string, cap: number) {
    const { body, finalUrl } = await fetchText(url);
    // A source may be a real feed, a news sitemap, or a page to be scraped;
    // the body tells us. Sitemaps matter here because some publishers — CNN
    // among them — declare no RSS at all, so the sitemap is the only
    // structured route they offer and has to be followable as a source.
    // Sitemap first: looksLikeFeed accepts anything opening with an XML
    // declaration, so a sitemap passes it and parses as an empty feed.
    const { meta, articles } = looksLikeSitemap(body)
      ? readSitemapAsSource(body, finalUrl)
      : looksLikeFeed(body)
        ? parseFeed(body, finalUrl)
        : scrapePage(body, finalUrl);
    // A big archive feed can carry hundreds of entries; only the recent ones
    // are ever read, and the cap bounds both payload and enrichment.
    return { meta, articles: sortNewestFirst(articles).slice(0, cap) };
  }

  const results = await Promise.all(
    urls.map(async (url) => {
      try {
        const members = parseBundle(url);
        if (members) {
          /**
           * A publisher with no feed of its own whole output — see
           * lib/bundle.ts. Every section is read, and a section that fails
           * costs its own stories and no others: half a paper beats an error
           * where the rest of it would have been.
           */
          const parts = await Promise.all(
            members.map(async (member) => {
              try {
                return await readFeed(member, PER_MEMBER);
              } catch {
                return null;
              }
            }),
          );
          const alive = parts.filter((part) => part !== null);
          if (alive.length === 0) throw new Error("No feed in this source could be read");

          const merged = mergeBundled(
            [sortNewestFirst(alive.flatMap((part) => part.articles))],
            canonicalUrl,
          );
          const meta = alive[0].meta;
          const ready = await enrichArticles(merged, {
            siteDescription: meta.description,
          });
          // A bundle names a publisher's sections explicitly, so it is
          // whole-publisher by construction.
          const full = await augment(ready, {
            origin: originOf(meta.siteUrl),
            limit: MAX_PER_SOURCE,
          });
          return {
            ok: true as const,
            ...meta,
            feedUrl: url,
            favicon: faviconFor(meta.siteUrl),
            articles: full.articles,
            coverage: full.coverage,
          };
        }

        if (parseApiSourceUrl(url)) {
          const { meta, articles } = await fetchApiSource(url, MAX_PER_SOURCE, keys);
          return { ok: true as const, ...meta, feedUrl: url, articles };
        }

        const handle = xHandleFrom(url);
        if (handle) {
          const { meta, articles } = await fetchXFeed(handle);
          return { ok: true as const, ...meta, feedUrl: url, articles };
        }

        const { meta, articles: recent } = await readFeed(url, MAX_PER_SOURCE);
        const ready = await enrichArticles(recent, {
          siteDescription: meta.description,
        });
        /**
         * A feed is one route into a publisher, not the whole of what they
         * filed. Everything their news sitemap carries is merged in here, so
         * a source collects what was published rather than what its feed
         * happened to still be holding.
         */
        const full = whole.has(url)
          ? await augment(ready, { origin: originOf(meta.siteUrl), limit: MAX_PER_SOURCE })
          : { articles: ready, coverage: undefined };
        return {
          ok: true as const,
          ...meta,
          feedUrl: url,
          favicon: faviconFor(meta.siteUrl),
          articles: full.articles,
          coverage: full.coverage,
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
