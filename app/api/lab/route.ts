import { NextResponse } from "next/server";

/**
 * TEMPORARY measurement probe — deleted before this branch is merged.
 *
 * docs/COLLECTION.md §5: the build sandbox cannot reach the internet, so the
 * only way to learn what a publisher actually serves this app is to ask from
 * a deployment.
 *
 * This one uses raw fetch rather than lib/feed's fetchText, because the thing
 * being measured is the refusal itself: fetchText throws on a bad status and
 * the status, the headers and the body are exactly what says whether a 429 is
 * a burst limit that will lapse or a door that is shut.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Only the sites this question is about. */
const ALLOWED = [
  /(^|\.)piratewires\.com$/,
  /(^|\.)piratewires\.substack\.com$/,
  /^news\.google\.com$/,
  /^www\.bing\.com$/,
];

const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

async function look(url: string, extra?: Record<string, string>) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 20000);
  try {
    const res = await fetch(url, {
      headers: { "user-agent": UA, accept: "*/*", "accept-language": "en-US,en;q=0.9", ...extra },
      redirect: "follow",
      signal: controller.signal,
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
      retryAfter: res.headers.get("retry-after"),
      cfRay: res.headers.get("cf-ray"),
      contentType: res.headers.get("content-type"),
      isFeed,
      isSitemap,
      items: isFeed ? (body.match(/<(item|entry)[\s>]/gi) ?? []).length : undefined,
      locs: isSitemap ? (body.match(/<loc>/g) ?? []).length : undefined,
      declaredFeeds: [
        ...new Set(
          [...body.matchAll(/<link[^>]+type="application\/(?:rss|atom)\+xml"[^>]*>/gi)].map((m) =>
            m[0].slice(0, 200),
          ),
        ),
      ],
      sitemapsInRobots: [...body.matchAll(/Sitemap:\s*(\S+)/gi)].map((m) => m[1]),
      hasNextData: /__NEXT_DATA__/.test(body),
      hasRsc: /self\.__next_f\.push/.test(body),
      jsonLdTypes: [...new Set([...body.matchAll(/"@type"\s*:\s*"([^"]+)"/g)].map((m) => m[1]))].slice(0, 20),
      articleLinks: [
        ...new Set(
          [...body.matchAll(/(?:href|url)="?(https?:\/\/[^"'\s]*piratewires\.com\/p\/[a-z0-9-]+|\/p\/[a-z0-9-]+)/gi)].map(
            (m) => m[1],
          ),
        ),
      ].slice(0, 10),
      title: body.match(/<title[^>]*>([^<]{0,140})/i)?.[1] ?? null,
      head: body.slice(0, 500),
    };
  } catch (error) {
    return { url, error: error instanceof Error ? error.message : String(error) };
  } finally {
    clearTimeout(timer);
  }
}

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const asked = params.get("url");
  if (!asked) return NextResponse.json({ error: "pass ?url=" }, { status: 400 });

  let target: URL;
  try {
    target = new URL(asked);
  } catch {
    return NextResponse.json({ error: "bad url" }, { status: 400 });
  }
  if (!ALLOWED.some((re) => re.test(target.hostname))) {
    return NextResponse.json({ error: "host not in this probe's list" }, { status: 400 });
  }

  const extra: Record<string, string> = {};
  if (params.get("as") === "bot") {
    extra["user-agent"] = "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)";
  }
  return NextResponse.json(await look(target.toString(), extra));
}
