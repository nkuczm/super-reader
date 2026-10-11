import { NextResponse } from "next/server";
import { fetchText, looksLikeFeed, parseFeed } from "@/lib/feed";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/*
 * TEMPORARY measurement probe (see docs/COLLECTION.md §5): a fixed list of
 * candidate research feeds and APIs, read from the deployment because the
 * build sandbox cannot reach the internet. It takes no URL from the request.
 * Removed again before this branch is merged.
 */
const CANDIDATES: [string, string][] = [
  ["oa-one", "https://api.openalex.org/works?filter=primary_location.source.issn:0031-8094,to_publication_date:2026-10-11&sort=publication_date:desc&per-page=3"],
  ["oa-doi", "https://api.openalex.org/works/doi:10.1038/nature14539"],
  ["biorxiv-range-neuro", "https://api.biorxiv.org/details/biorxiv/2026-10-07/2026-10-11/0?category=neuroscience"],
  ["biorxiv-range-neuro-2", "https://api.biorxiv.org/details/biorxiv/2026-10-07/2026-10-11/100?category=neuroscience"],
  ["medrxiv-range", "https://api.biorxiv.org/details/medrxiv/2026-10-07/2026-10-11/0?category=neurology"],
  ["s2-search", "https://api.semanticscholar.org/graph/v1/paper/search?query=predictive+coding&fields=title,publicationDate,venue,externalIds&limit=5&sort=publicationDate:desc"],
  ["s2-bulk", "https://api.semanticscholar.org/graph/v1/paper/search/bulk?query=predictive+coding&fields=title,publicationDate,venue&sort=publicationDate:desc"],
  ["crossref-journal-pq", "https://api.crossref.org/journals/0031-8094/works?sort=published&order=desc&rows=3&filter=until-pub-date:2026-10-11"],
  ["crossref-journal-ergo", "https://api.crossref.org/journals/2330-4014/works?sort=published&order=desc&rows=3&filter=until-pub-date:2026-10-11"],
  ["crossref-journal-philsci", "https://api.crossref.org/journals/0031-8248/works?sort=published&order=desc&rows=3&filter=until-pub-date:2026-10-11"],
];

const meta = (html: string, name: string) =>
  [...html.matchAll(new RegExp(`<meta[^>]+(?:name|property)=["']${name}["'][^>]*content=["']([^"']+)`, "gi"))].map((m) => m[1]).slice(0, 3);

async function probe(id: string, url: string) {
  const started = Date.now();
  try {
    if (url.includes("api.crossref.org") || url.includes("api.openalex.org") || url.includes("api.biorxiv.org") || url.includes("semanticscholar")) {
      const res = await fetch(url, { headers: { accept: "application/json" }, signal: AbortSignal.timeout(15000) });
      const body = await res.json().catch(() => null);
      const items = body?.message?.items ?? body?.results ?? body?.collection ?? body?.data;
      if (res.status !== 200) return { id, status: res.status, body: JSON.stringify(body).slice(0, 900), headers: Object.fromEntries([...res.headers].filter(([k]) => /rate|retry|limit/i.test(k))) };
      return {
        id, status: res.status, ms: Date.now() - started,
        keys: body ? Object.keys(body).slice(0, 8) : null,
        items: Array.isArray(items) ? items.length : undefined,
        sample: Array.isArray(items)
          ? items.slice(0, 3).map((i: any) => ({
              title: String(Array.isArray(i.title) ? i.title[0] : i.display_name ?? i.title ?? "").slice(0, 90),
              date: i.published?.["date-parts"]?.[0] ?? i.publication_date ?? i.date ?? i.publicationDate,
              version: i.version,
              link: i.URL ?? i.doi ?? i.primary_location?.landing_page_url,
              source: i["container-title"]?.[0] ?? i.primary_location?.source?.display_name ?? i.category,
              abstract: Boolean(i.abstract || i.abstract_inverted_index),
            }))
          : undefined,
        work: body?.message?.ISSN ? { issn: body.message.ISSN, container: body.message["container-title"], type: body.message.type } : undefined,
        named: body?.display_name, idOf: body?.id, issnL: body?.issn_l, works: body?.works_count,
        source: body?.primary_location?.source ? { id: body.primary_location.source.id, name: body.primary_location.source.display_name, issnL: body.primary_location.source.issn_l } : undefined,
        crossItem: body?.message?.items?.[0] ? { issn: body.message.items[0].ISSN, container: body.message.items[0]["container-title"] } : undefined,
        messages: body?.messages?.[0],
        last: Array.isArray(items) && items.length ? { date: items[items.length - 1].date, title: String(items[items.length - 1].title ?? "").slice(0, 60) } : undefined,
        total: body?.total ?? body?.meta?.count ?? body?.message?.["total-results"],
      };
    }
    const { body, finalUrl } = await fetchText(url, 15000);
    if (looksLikeFeed(body)) {
      const { meta: m, articles } = parseFeed(body, finalUrl);
      const dates = articles.map((a) => Date.parse(a.publishedAt ?? "")).filter(Number.isFinite).sort((a, b) => b - a);
      const arxivCat = body.match(/<arxiv:primary_category[^>]*term="([^"]+)"/)?.[1];
      return {
        id, ok: true, ms: Date.now() - started, finalUrl: finalUrl !== url ? finalUrl : undefined,
        title: m.title, items: articles.length,
        newest: dates[0] ? new Date(dates[0]).toISOString() : null,
        spanHours: dates.length > 1 ? Math.round((dates[0] - dates[dates.length - 1]) / 3.6e6) : null,
        undated: articles.length - dates.length,
        sample: articles.slice(0, 2).map((a) => ({ title: a.title.slice(0, 90), link: a.link, summary: (a.summary ?? "").length })),
        arxivCat,
      };
    }
    return {
      id, ok: false, html: true, ms: Date.now() - started, bytes: body.length, finalUrl: finalUrl !== url ? finalUrl : undefined,
      title: body.match(/<title[^>]*>([^<]{0,120})/i)?.[1]?.trim(),
      doi: meta(body, "citation_doi"), issn: meta(body, "citation_issn"), journal: meta(body, "citation_journal_title"),
      alternates: [...body.matchAll(/<link[^>]+type=["']application\/(?:rss|atom)\+xml["'][^>]*>/gi)].map((m) => m[0].match(/href=["']([^"']+)/)?.[1]).slice(0, 4),
      arxivCat: body.match(/primary-subject[^>]*>([^<]+)/)?.[1]?.trim(),
    };
  } catch (error) {
    return { id, ok: false, ms: Date.now() - started, error: error instanceof Error ? error.message : String(error) };
  }
}

export async function GET(request: Request) {
  const part = Number(new URL(request.url).searchParams.get("part") ?? 0);
  const size = 30;
  const mine = CANDIDATES.slice(part * size, part * size + size);
  const results = [];
  for (let i = 0; i < mine.length; i += 5) results.push(...(await Promise.all(mine.slice(i, i + 5).map(([id, url]) => probe(id, url)))));
  return NextResponse.json({ part, parts: Math.ceil(CANDIDATES.length / size), results });
}
