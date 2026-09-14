import { NextResponse } from "next/server";
import { fetchText, looksLikeFeed, parseFeed } from "@/lib/feed";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * TEMPORARY. A measuring instrument, not a feature: what does a given site
 * actually expose to us? Removed in the same change that consumes its
 * findings — it is here so the collection design is built on what publishers
 * really serve rather than on what they are assumed to.
 */

type Probe = { what: string; ok: boolean; note: string; n?: number };

async function head(url: string): Promise<Probe> {
  try {
    const { body, finalUrl } = await fetchText(url, 9000);
    return { what: url, ok: true, note: `${body.length}b ${finalUrl}`, n: body.length };
  } catch (error) {
    return { what: url, ok: false, note: error instanceof Error ? error.message : "failed" };
  }
}

function countTag(xml: string, tag: string) {
  return (xml.match(new RegExp(`<${tag}[\\s>]`, "gi")) ?? []).length;
}

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const site = params.get("site");
  if (!site) return NextResponse.json({ error: "Missing ?site" }, { status: 400 });
  const origin = new URL(site).origin;

  const out: Record<string, unknown> = { site, origin };

  // 1. robots.txt — the canonical index of a site's sitemaps.
  const sitemapsFromRobots: string[] = [];
  try {
    const { body } = await fetchText(`${origin}/robots.txt`, 8000);
    for (const line of body.split("\n")) {
      const match = line.match(/^\s*sitemap:\s*(\S+)/i);
      if (match) sitemapsFromRobots.push(match[1]);
    }
    out.robots = { ok: true, sitemaps: sitemapsFromRobots };
  } catch (error) {
    out.robots = { ok: false, why: error instanceof Error ? error.message : "failed" };
  }

  // 2. Conventional news-sitemap paths, plus anything robots pointed at whose
  //    name suggests news.
  const newsCandidates = [
    ...sitemapsFromRobots.filter((u) => /news/i.test(u)),
    `${origin}/sitemap-news.xml`,
    `${origin}/news-sitemap.xml`,
    `${origin}/sitemap/news.xml`,
    `${origin}/sitemaps/news.xml`,
    `${origin}/arc/outboundfeeds/news-sitemap/`,
  ];
  const news: Record<string, unknown>[] = [];
  for (const candidate of [...new Set(newsCandidates)].slice(0, 6)) {
    try {
      const { body } = await fetchText(candidate, 9000);
      const urls = countTag(body, "url");
      const newsTags = countTag(body, "news:news");
      const index = countTag(body, "sitemap");
      news.push({
        url: candidate,
        ok: true,
        urls,
        newsTags,
        isIndex: index > 0 && urls === 0,
        firstLoc: body.match(/<loc>([^<]+)<\/loc>/i)?.[1],
      });
    } catch (error) {
      news.push({ url: candidate, ok: false, why: error instanceof Error ? error.message : "x" });
    }
  }
  out.newsSitemaps = news;

  // 3. The listing page itself: declared feeds, JSON-LD, embedded state.
  try {
    const { body, finalUrl } = await fetchText(site, 12000);
    const declared = (body.match(/<link\b[^>]*>/gi) ?? []).filter(
      (tag) =>
        /rel=["']?[^"'>]*alternate/i.test(tag) &&
        /type=["']?application\/(rss|atom)\+xml/i.test(tag),
    );
    const ld = body.match(/<script[^>]+type=["']application\/ld\+json["'][^>]*>/gi) ?? [];
    const ldTypes = [...body.matchAll(/"@type"\s*:\s*"([^"]+)"/g)].map((m) => m[1]);
    out.page = {
      ok: true,
      finalUrl,
      bytes: body.length,
      declaredFeeds: declared.length,
      declaredHrefs: declared
        .map((t) => t.match(/href=["']([^"']+)["']/i)?.[1])
        .filter(Boolean)
        .slice(0, 12),
      jsonLdBlocks: ld.length,
      jsonLdTypes: [...new Set(ldTypes)].slice(0, 20),
      nextData: /__NEXT_DATA__/.test(body),
      anchors: (body.match(/<a\b/gi) ?? []).length,
    };
  } catch (error) {
    out.page = { ok: false, why: error instanceof Error ? error.message : "failed" };
  }

  // 4. If a feed URL was supplied, how deep is its window?
  const feedUrl = params.get("feed");
  if (feedUrl) {
    try {
      const { body, finalUrl } = await fetchText(feedUrl, 12000);
      if (!looksLikeFeed(body)) {
        out.feed = { ok: false, why: "not a feed", bytes: body.length };
      } else {
        const { articles } = parseFeed(body, finalUrl);
        const times = articles
          .map((a) => Date.parse(a.publishedAt ?? ""))
          .filter((t) => Number.isFinite(t))
          .sort((a, b) => b - a);
        out.feed = {
          ok: true,
          items: articles.length,
          newestAgeHours: times.length ? (Date.now() - times[0]) / 3600000 : null,
          spanHours: times.length > 1 ? (times[0] - times[times.length - 1]) / 3600000 : 0,
          withImage: articles.filter((a) => a.image).length,
          withSummary: articles.filter((a) => a.summary).length,
        };
      }
    } catch (error) {
      out.feed = { ok: false, why: error instanceof Error ? error.message : "failed" };
    }
  }

  return NextResponse.json(out);
}
