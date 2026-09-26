import { NextResponse } from "next/server";

/**
 * TEMPORARY measurement probe — deleted before this branch is merged.
 * docs/COLLECTION.md §5. Reads institute.deepmind.com and nothing else, with
 * raw fetch so a refusal shows its status, headers and body.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const ALLOWED = /(^|\.)institute\.deepmind\.com$/;
const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

async function look(url: string) {
  try {
    const res = await fetch(url, {
      headers: { "user-agent": UA, accept: "*/*", "accept-language": "en-US,en;q=0.9" },
      redirect: "follow",
      signal: AbortSignal.timeout(15000),
    });
    const body = await res.text();
    const isFeed = /<(rss|feed|rdf:RDF)[\s>]/i.test(body);
    const isSitemap = /<(urlset|sitemapindex)[\s>]/i.test(body);
    return {
      url,
      status: res.status,
      finalUrl: res.url,
      bytes: body.length,
      server: res.headers.get("server"),
      contentType: res.headers.get("content-type"),
      isFeed,
      items: isFeed ? (body.match(/<(item|entry)[\s>]/gi) ?? []).length : undefined,
      isSitemap,
      locs: isSitemap ? [...body.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]).slice(0, 40) : undefined,
      lastmods: isSitemap ? [...body.matchAll(/<lastmod>([^<]+)<\/lastmod>/g)].map((m) => m[1]).slice(0, 40) : undefined,
      declaredFeeds: [...body.matchAll(/<link[^>]+(?:rss|atom)\+xml[^>]*>/gi)].map((m) => m[0].slice(0, 200)),
      sitemapsInRobots: [...body.matchAll(/Sitemap:\s*(\S+)/gi)].map((m) => m[1]),
      framework: {
        nextData: /__NEXT_DATA__/.test(body),
        rsc: /self\.__next_f\.push/.test(body),
        nuxt: /__NUXT__/.test(body),
        astro: /astro-/.test(body),
      },
      jsonLdTypes: [...new Set([...body.matchAll(/"@type"\s*:\s*"([^"]+)"/g)].map((m) => m[1]))].slice(0, 15),
      // Essay links as the HTML carries them — server-rendered, or not at all.
      essayLinks: [...new Set([...body.matchAll(/href="([^"]*\/essays\/[^"#?]+)"/gi)].map((m) => m[1]))].slice(0, 30),
      // Same, but anywhere in the document (JSON payloads, escaped RSC).
      essayPathsAnywhere: [...new Set([...body.matchAll(/\\?\/essays\/([a-z0-9-]{3,})/gi)].map((m) => m[1]))].slice(0, 30),
      dates: [...new Set([...body.matchAll(/(20\d\d-\d\d-\d\d)|((?:January|February|March|April|May|June|July|August|September|October|November|December) \d{1,2}, 20\d\d)/g)].map((m) => m[0]))].slice(0, 20),
      title: body.match(/<title[^>]*>([^<]{0,140})/i)?.[1] ?? null,
      head: body.slice(0, 400),
    };
  } catch (error) {
    return { url, error: error instanceof Error ? error.message : String(error) };
  }
}

export async function GET(request: Request) {
  const asked = new URL(request.url).searchParams.getAll("url");
  const urls = asked.length ? asked : [
    "https://institute.deepmind.com/essays",
    "https://institute.deepmind.com/robots.txt",
    "https://institute.deepmind.com/sitemap.xml",
    "https://institute.deepmind.com/feed",
    "https://institute.deepmind.com/rss.xml",
    "https://institute.deepmind.com/essays/rss.xml",
    "https://institute.deepmind.com/feed.xml",
  ];
  const results = [];
  for (const u of urls) {
    let target: URL;
    try { target = new URL(u); } catch { continue; }
    if (!ALLOWED.test(target.hostname)) continue;
    results.push(await look(target.toString()));
  }
  return NextResponse.json({ results });
}
