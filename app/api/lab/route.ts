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
  ["oa-jneurosci", "https://api.openalex.org/works?filter=primary_location.source.issn:0270-6474,to_publication_date:2026-10-11,type:article|preprint|review&sort=publication_date:desc&per-page=3"],
  ["oa-neuroimage", "https://api.openalex.org/works?filter=primary_location.source.issn:1053-8119,to_publication_date:2026-10-11,type:article|preprint|review&sort=publication_date:desc&per-page=3"],
  ["oa-brain", "https://api.openalex.org/works?filter=primary_location.source.issn:0006-8950,to_publication_date:2026-10-11,type:article|preprint|review&sort=publication_date:desc&per-page=3"],
  ["oa-cercor", "https://api.openalex.org/works?filter=primary_location.source.issn:1047-3211,to_publication_date:2026-10-11,type:article|preprint|review&sort=publication_date:desc&per-page=3"],
  ["oa-mind", "https://api.openalex.org/works?filter=primary_location.source.issn:0026-4423,to_publication_date:2026-10-11,type:article|preprint|review&sort=publication_date:desc&per-page=3"],
  ["oa-philreview", "https://api.openalex.org/works?filter=primary_location.source.issn:0031-8108,to_publication_date:2026-10-11,type:article|preprint|review&sort=publication_date:desc&per-page=3"],
  ["oa-jphil", "https://api.openalex.org/works?filter=primary_location.source.issn:0022-362X,to_publication_date:2026-10-11,type:article|preprint|review&sort=publication_date:desc&per-page=3"],
  ["oa-ethics", "https://api.openalex.org/works?filter=primary_location.source.issn:0014-1704,to_publication_date:2026-10-11,type:article|preprint|review&sort=publication_date:desc&per-page=3"],
  ["oa-philstudies", "https://api.openalex.org/works?filter=primary_location.source.issn:0031-8116,to_publication_date:2026-10-11,type:article|preprint|review&sort=publication_date:desc&per-page=3"],
  ["oa-synthese", "https://api.openalex.org/works?filter=primary_location.source.issn:0039-7857,to_publication_date:2026-10-11,type:article|preprint|review&sort=publication_date:desc&per-page=3"],
  ["oa-erkenntnis", "https://api.openalex.org/works?filter=primary_location.source.issn:0165-0106,to_publication_date:2026-10-11,type:article|preprint|review&sort=publication_date:desc&per-page=3"],
  ["oa-ajp", "https://api.openalex.org/works?filter=primary_location.source.issn:0004-8402,to_publication_date:2026-10-11,type:article|preprint|review&sort=publication_date:desc&per-page=3"],
  ["oa-imprint", "https://api.openalex.org/works?filter=primary_location.source.issn:1533-628X,to_publication_date:2026-10-11,type:article|preprint|review&sort=publication_date:desc&per-page=3"],
  ["oa-ergo", "https://api.openalex.org/works?filter=primary_location.source.issn:2330-4014,to_publication_date:2026-10-11,type:article|preprint|review&sort=publication_date:desc&per-page=3"],
  ["oa-philsci", "https://api.openalex.org/works?filter=primary_location.source.issn:0031-8248,to_publication_date:2026-10-11,type:article|preprint|review&sort=publication_date:desc&per-page=3"],
  ["oa-bjps", "https://api.openalex.org/works?filter=primary_location.source.issn:0007-0882,to_publication_date:2026-10-11,type:article|preprint|review&sort=publication_date:desc&per-page=3"],
  ["oa-pq", "https://api.openalex.org/works?filter=primary_location.source.issn:0031-8094,to_publication_date:2026-10-11,type:article|preprint|review&sort=publication_date:desc&per-page=3"],
  ["oa-psychsci", "https://api.openalex.org/works?filter=primary_location.source.issn:0956-7976,to_publication_date:2026-10-11,type:article|preprint|review&sort=publication_date:desc&per-page=3"],
  ["oa-jocn", "https://api.openalex.org/works?filter=primary_location.source.issn:0898-929X,to_publication_date:2026-10-11,type:article|preprint|review&sort=publication_date:desc&per-page=3"],
  ["oa-plos-one", "https://api.openalex.org/works?filter=primary_location.source.issn:1932-6203,to_publication_date:2026-10-11,type:article|preprint|review&sort=publication_date:desc&per-page=3"],
  ["oa-doi", "https://api.openalex.org/works/doi:10.1038/nature14539"],
  ["oa-doi-new", "https://api.openalex.org/works/doi:10.1111/nous.70071"],
  ["oa-search-precise", "https://api.openalex.org/works?filter=title_and_abstract.search:predictive%20coding,to_publication_date:2026-10-11,type:article|preprint|review&sort=publication_date:desc&per-page=5"],
  ["oa-field-phil", "https://api.openalex.org/works?filter=primary_topic.subfield.id:1211,to_publication_date:2026-10-11,type:article|preprint|review&sort=publication_date:desc&per-page=5"],
  ["oa-biorxiv-neuro", "https://api.openalex.org/works?filter=primary_location.source.id:S4306402567,primary_topic.field.id:28,to_publication_date:2026-10-11&sort=publication_date:desc&per-page=5"],
  ["crossref-pii", "https://api.crossref.org/works?filter=alternative-id:S0896627326007282&rows=1"],
  ["crossref-work", "https://api.crossref.org/works/10.1111/nous.70071"],
  ["biorxiv-api-3d-neuro", "https://api.biorxiv.org/details/biorxiv/3d/0?category=neuroscience"],
  ["biorxiv-api-n", "https://api.biorxiv.org/details/biorxiv/30/0?category=neuroscience"],
  ["biorxiv-api-doi", "https://api.biorxiv.org/details/biorxiv/10.64898/2026.09.28.755022"],
  ["medrxiv-api-3d", "https://api.biorxiv.org/details/medrxiv/3d/0?category=neurology"],
  ["arxiv-api-cat", "https://export.arxiv.org/api/query?search_query=cat:q-bio.NC&sortBy=submittedDate&sortOrder=descending&max_results=20"],
  ["arxiv-api-cat-ai", "https://export.arxiv.org/api/query?search_query=cat:cs.AI&sortBy=submittedDate&sortOrder=descending&max_results=20"],
  ["tics-cell", "https://www.cell.com/trends/cognitive-sciences/inpress.rss"],
  ["cell-inpress", "https://www.cell.com/cell/inpress.rss"],
  ["cellreports-inpress", "https://www.cell.com/cell-reports/inpress.rss"],
  ["neuron-current-2", "https://www.cell.com/neuron/current.rss"],
  ["biorxiv-rss-guess", "https://www.biorxiv.org/rss/subject/neuroscience"],
  ["philpapers-api", "https://philpapers.org/rec/CHAFTH"],
  ["tandf-ajp-feed", "https://www.tandfonline.com/feed/rss/rajp20"],
  ["oup-mind-feed", "https://academic.oup.com/rss/site_5280/3164.xml"],
];

const meta = (html: string, name: string) =>
  [...html.matchAll(new RegExp(`<meta[^>]+(?:name|property)=["']${name}["'][^>]*content=["']([^"']+)`, "gi"))].map((m) => m[1]).slice(0, 3);

async function probe(id: string, url: string) {
  const started = Date.now();
  try {
    if (url.includes("api.crossref.org") || url.includes("api.openalex.org") || url.includes("api.biorxiv.org")) {
      const res = await fetch(url, { headers: { accept: "application/json" }, signal: AbortSignal.timeout(15000) });
      const body = await res.json().catch(() => null);
      const items = body?.message?.items ?? body?.results ?? body?.collection;
      return {
        id, status: res.status, ms: Date.now() - started,
        keys: body ? Object.keys(body).slice(0, 8) : null,
        items: Array.isArray(items) ? items.length : undefined,
        sample: Array.isArray(items)
          ? items.slice(0, 3).map((i: any) => ({
              title: String(Array.isArray(i.title) ? i.title[0] : i.display_name ?? i.title ?? "").slice(0, 90),
              date: i.published?.["date-parts"]?.[0] ?? i.publication_date ?? i.date,
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
