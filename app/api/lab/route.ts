// TEMPORARY measurement probe (docs/COLLECTION.md §5) — removed before merge.
import { NextResponse } from "next/server";
import { fetchText, looksLikeFeed, parseFeed } from "@/lib/feed";
import { fetchApiSource } from "@/lib/apis";
import { OUTLETS } from "@/lib/outlets";
import { CANDIDATES } from "./candidates";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

async function pool<T, R>(items: T[], size: number, run: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(size, items.length) }, async () => {
      while (next < items.length) {
        const i = next++;
        out[i] = await run(items[i]);
      }
    }),
  );
  return out;
}

function summary(articles: { title?: string; publishedAt?: string; link?: string }[]) {
  const dates = articles.map((a) => (a.publishedAt ? Date.parse(a.publishedAt) : NaN)).filter(Number.isFinite);
  const newest = dates.length ? Math.max(...dates) : 0;
  const oldest = dates.length ? Math.min(...dates) : 0;
  const now = Date.now();
  return {
    items: articles.length,
    dated: dates.length,
    newestDays: newest ? Math.round(((now - newest) / 86400000) * 10) / 10 : null,
    oldestDays: oldest ? Math.round(((now - oldest) / 86400000) * 10) / 10 : null,
    last7: dates.filter((d) => now - d < 7 * 86400000).length,
    sample: articles.slice(0, 2).map((a) => `${a.title?.slice(0, 90)} | ${a.link?.slice(0, 90)}`),
  };
}

async function probeFeed(url: string) {
  const t = Date.now();
  try {
    const { body, finalUrl } = await fetchText(url, 12000);
    if (!looksLikeFeed(body)) return { url, ok: false, ms: Date.now() - t, error: "not a feed", head: body.slice(0, 160).replace(/\s+/g, " ") };
    const { articles } = parseFeed(body, finalUrl);
    return { url, ok: articles.length > 0, ms: Date.now() - t, ...summary(articles) };
  } catch (error) {
    return { url, ok: false, ms: Date.now() - t, error: error instanceof Error ? error.message : String(error) };
  }
}

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const what = params.get("do");
  const from = Number(params.get("from") ?? 0);
  const to = Number(params.get("to") ?? from + 25);
  const picked = CANDIDATES.slice(from, to);

  if (what === "feeds") {
    const jobs = picked.flatMap((c) => (c.feeds ?? []).map((url) => ({ id: c.id, url })));
    const results = await pool(jobs, 8, async (job) => ({ id: job.id, ...(await probeFeed(job.url)) }));
    return NextResponse.json({ total: CANDIDATES.length, results });
  }

  if (what === "outletfeeds") {
    // Alternatives for directory entries: ?u=<url>&u=<url>
    const urls = params.getAll("u");
    const results = await pool(urls, 8, probeFeed);
    return NextResponse.json({ results });
  }

  if (what === "issn") {
    const jobs = picked.filter((c) => c.issn?.length);
    const results = await pool(jobs, 2, async (c) => {
      const issn = c.issn![0];
      try {
        const res = await fetch(`https://api.crossref.org/journals/${issn}`, { headers: { accept: "application/json", "user-agent": "super-reader/1.0 (directory audit)" } });
        if (!res.ok) return { id: c.id, issn, status: res.status };
        const m = (await res.json()).message;
        const years = Object.fromEntries((m?.breakdowns?.["dois-by-issued-year"] ?? []).filter(([y]: [number]) => y >= 2025));
        return { id: c.id, issn, want: c.name, title: m?.title, publisher: m?.publisher, issns: m?.ISSN, years };
      } catch (error) {
        return { id: c.id, issn, error: String(error) };
      }
    });
    return NextResponse.json({ total: CANDIDATES.length, results });
  }

  if (what === "api") {
    const urls = params.getAll("u").length ? params.getAll("u") : picked.flatMap((c) => c.api ?? []);
    const results = await pool(urls, 1, async (url) => {
      const t = Date.now();
      try {
        const { meta, articles } = await fetchApiSource(url, 20);
        return { url, ok: articles.length > 0, ms: Date.now() - t, title: meta.title, authors: articles.slice(0, 2).map((a) => a.author), ...summary(articles) };
      } catch (error) {
        return { url, ok: false, ms: Date.now() - t, error: error instanceof Error ? error.message : String(error) };
      }
    });
    return NextResponse.json({ results });
  }

  if (what === "journals") {
    // The journal route as a reader would get it, for directory entries or candidates by ISSN.
    const issns = params.getAll("issn");
    const results = await pool(issns, 1, async (issn) => {
      const t = Date.now();
      try {
        const { articles } = await fetchApiSource(`api:journal?issn=${issn}`, 20);
        return { issn, ok: articles.length > 0, ms: Date.now() - t, venue: articles[0]?.author?.split(" · ").pop(), ...summary(articles) };
      } catch (error) {
        return { issn, ok: false, ms: Date.now() - t, error: error instanceof Error ? error.message : String(error) };
      }
    });
    return NextResponse.json({ results });
  }

  if (what === "raw") {
    const url = params.get("u") ?? "";
    const host = new URL(url).hostname;
    if (!["api.osf.io", "api.openalex.org", "api.crossref.org", "export.arxiv.org"].includes(host)) return NextResponse.json({ error: "host" }, { status: 400 });
    const t = Date.now();
    const res = await fetch(url, { headers: { accept: "application/json" } });
    const text = await res.text();
    return NextResponse.json({ status: res.status, ms: Date.now() - t, headers: Object.fromEntries(res.headers.entries()), body: text.slice(0, Number(params.get("n") ?? 3000)) });
  }

  if (what === "directory") {
    return NextResponse.json({ outlets: OUTLETS.length, candidates: CANDIDATES.length });
  }
  return NextResponse.json({ error: "do=feeds|issn|api|journals|raw|outletfeeds" }, { status: 400 });
}
