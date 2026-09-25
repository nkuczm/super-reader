import { NextResponse } from "next/server";
import { fetchText } from "@/lib/feed";

/**
 * TEMPORARY measurement probe — deleted before this branch is merged.
 *
 * docs/COLLECTION.md §5: the build sandbox cannot reach the internet, so the
 * only way to learn what a publisher actually serves this app is to ask from
 * a deployment. Narrow on purpose: piratewires.com and nothing else, so this
 * is never a general-purpose URL fetcher even for the minutes it exists.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const ALLOWED = /(^|\.)piratewires\.com$/;

/** The routes worth asking about, in the order §3 would try them. */
const CANDIDATES = [
  "/robots.txt",
  "/c/technology",
  "/feed",
  "/rss",
  "/rss.xml",
  "/feed.xml",
  "/atom.xml",
  "/index.xml",
  "/c/technology/feed",
  "/c/technology/rss",
  "/sitemap.xml",
  "/sitemap_index.xml",
  "/news-sitemap.xml",
];

function summarise(url: string, body: string) {
  const isFeed = /<(rss|feed|rdf:RDF)[\s>]/i.test(body);
  const isSitemap = /<(urlset|sitemapindex)[\s>]/i.test(body);
  return {
    url,
    bytes: body.length,
    isFeed,
    isSitemap,
    items: isFeed ? (body.match(/<(item|entry)[\s>]/gi) ?? []).length : undefined,
    sitemapUrls: isSitemap ? (body.match(/<loc>/g) ?? []).length : undefined,
    // A feed the page declares for itself beats anything guessed at.
    declared: [
      ...new Set(
        [...body.matchAll(/<link[^>]+type="application\/(?:rss|atom)\+xml"[^>]*>/gi)].map(
          (m) => m[0].slice(0, 220),
        ),
      ),
    ],
    sitemapsInRobots: [...body.matchAll(/Sitemap:\s*(\S+)/gi)].map((m) => m[1]),
    // Is the listing rendered on the server, or is this a shell?
    hasNextData: /__NEXT_DATA__/.test(body),
    hasRscPayload: /self\.__next_f\.push/.test(body),
    jsonLdTypes: [...body.matchAll(/"@type"\s*:\s*"([^"]+)"/g)].map((m) => m[1]).slice(0, 25),
    // Article-shaped links, which is what a scrape would have to work with.
    links: [
      ...new Set(
        [...body.matchAll(/href="(\/p\/[a-z0-9-]+|https:\/\/www\.piratewires\.com\/p\/[a-z0-9-]+)"/gi)]
          .map((m) => m[1]),
      ),
    ].slice(0, 12),
    titleish: body.match(/<title[^>]*>([^<]{0,120})/i)?.[1] ?? null,
    head: body.slice(0, 300),
  };
}

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const one = params.get("url");

  if (one) {
    let target: URL;
    try {
      target = new URL(one);
    } catch {
      return NextResponse.json({ error: "bad url" }, { status: 400 });
    }
    if (!ALLOWED.test(target.hostname)) {
      return NextResponse.json({ error: "this probe only reads piratewires.com" }, { status: 400 });
    }
    try {
      const { body, finalUrl } = await fetchText(target.toString(), 20000);
      const full = params.get("full") === "1";
      return NextResponse.json({
        ...summarise(finalUrl, body),
        ...(full ? { body: body.slice(0, 20000) } : {}),
      });
    } catch (error) {
      return NextResponse.json({
        url: target.toString(),
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  const results = [];
  for (const path of CANDIDATES) {
    const url = `https://www.piratewires.com${path}`;
    try {
      const { body, finalUrl } = await fetchText(url, 12000);
      results.push(summarise(finalUrl, body));
    } catch (error) {
      results.push({ url, error: error instanceof Error ? error.message : String(error) });
    }
  }
  return NextResponse.json({ results });
}
