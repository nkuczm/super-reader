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
  // neuroscience
  ["nature-neuro", "https://www.nature.com/neuro.rss"],
  ["nature-nrn", "https://www.nature.com/nrn.rss"],
  ["nature-subject-neuro", "https://www.nature.com/subjects/neuroscience.rss"],
  ["ncomms-neuro", "https://www.nature.com/subjects/neuroscience/ncomms.rss"],
  ["nathumbehav", "https://www.nature.com/nathumbehav.rss"],
  ["neuron-cell-inpress", "https://www.cell.com/neuron/inpress.rss"],
  ["neuron-cell-current", "https://www.cell.com/neuron/current.rss"],
  ["neuron-sd", "https://rss.sciencedirect.com/publication/science/08966273"],
  ["curbio-cell", "https://www.cell.com/current-biology/inpress.rss"],
  ["jneurosci-current", "https://www.jneurosci.org/rss/current.xml"],
  ["jneurosci-ahead", "https://www.jneurosci.org/rss/ahead.xml"],
  ["eneuro-current", "https://www.eneuro.org/rss/current.xml"],
  ["elife-neuro", "https://elifesciences.org/rss/subject/neuroscience.xml"],
  ["biorxiv-neuro", "https://connect.biorxiv.org/biorxiv_xml/neuroscience"],
  ["medrxiv-neurology", "https://connect.medrxiv.org/medrxiv_xml/neurology"],
  ["plos-compbio", "https://journals.plos.org/ploscompbiol/feed/atom"],
  ["neuroimage-sd", "https://rss.sciencedirect.com/publication/science/10538119"],
  ["tins-sd", "https://rss.sciencedirect.com/publication/science/01662236"],
  ["tics-sd", "https://rss.sciencedirect.com/publication/science/13646613"],
  ["tins-cell", "https://www.cell.com/trends/neurosciences/inpress.rss"],
  ["neurosciencenews", "https://neurosciencenews.com/feed/"],
  ["transmitter", "https://www.thetransmitter.org/feed/"],
  ["jneurophys", "https://journals.physiology.org/action/showFeed?type=etoc&feed=rss&jc=jn"],
  ["pnas-neuro", "https://www.pnas.org/action/showFeed?type=searchTopic&taxonomyCode=topic&tagCode=neuro-sci"],
  ["arxiv-qbio-nc", "https://rss.arxiv.org/rss/q-bio.NC"],
  ["arxiv-old-qbio-nc", "https://export.arxiv.org/rss/q-bio.NC"],
  // philosophy
  ["sep", "https://plato.stanford.edu/rss/sep.xml"],
  ["dailynous", "https://dailynous.com/feed/"],
  ["aeon", "https://aeon.co/feed.rss"],
  ["psyche", "https://psyche.co/feed.rss"],
  ["philpapers-1", "https://philpapers.org/recent.pl?format=rss"],
  ["philpapers-2", "https://philpapers.org/rss/recent.xml"],
  ["philarchive", "https://philarchive.org/rss"],
  ["nous-wiley", "https://onlinelibrary.wiley.com/feed/14680068/most-recent"],
  ["ppr-wiley", "https://onlinelibrary.wiley.com/feed/19331592/most-recent"],
  ["mindlang-wiley", "https://onlinelibrary.wiley.com/feed/14680017/most-recent"],
  ["philcompass-wiley", "https://onlinelibrary.wiley.com/feed/17479991/most-recent"],
  ["synthese-springer", "https://link.springer.com/search.rss?facet-content-type=Article&facet-journal-id=11229&channel-name=Synthese"],
  ["philstudies-springer", "https://link.springer.com/search.rss?facet-content-type=Article&facet-journal-id=11098&channel-name=Philosophical+Studies"],
  ["erkenntnis-springer", "https://link.springer.com/search.rss?facet-content-type=Article&facet-journal-id=10670&channel-name=Erkenntnis"],
  ["brainsblog", "https://philosophyofbrains.com/feed"],
  ["peasoup", "https://peasoupblog.com/feed/"],
  ["leiter", "https://leiterreports.com/feed/"],
  ["ndpr", "https://ndpr.nd.edu/reviews/feed/"],
  ["ndpr-2", "https://ndpr.nd.edu/feed/"],
  // research, preprints, flagship journals
  ["arxiv-cs-ai", "https://rss.arxiv.org/rss/cs.AI"],
  ["arxiv-cs-lg", "https://rss.arxiv.org/rss/cs.LG"],
  ["arxiv-cs-cl", "https://rss.arxiv.org/rss/cs.CL"],
  ["arxiv-stat-ml", "https://rss.arxiv.org/rss/stat.ML"],
  ["arxiv-quant-ph", "https://rss.arxiv.org/rss/quant-ph"],
  ["arxiv-astro-ph", "https://rss.arxiv.org/rss/astro-ph"],
  ["arxiv-cs-cy", "https://rss.arxiv.org/rss/cs.CY"],
  ["arxiv-econ-gn", "https://rss.arxiv.org/rss/econ.GN"],
  ["arxiv-physics-hist-ph", "https://rss.arxiv.org/rss/physics.hist-ph"],
  ["biorxiv-all-1", "https://connect.biorxiv.org/biorxiv_xml/all"],
  ["biorxiv-all-2", "https://connect.biorxiv.org/biorxiv_xml/biorxiv"],
  ["medrxiv-all", "https://connect.medrxiv.org/medrxiv_xml/all"],
  ["elife-recent", "https://elifesciences.org/rss/recent.xml"],
  ["pnas-etoc", "https://www.pnas.org/action/showFeed?type=etoc&feed=rss&jc=pnas"],
  ["science-etoc", "https://www.science.org/action/showFeed?type=etoc&feed=rss&jc=science"],
  ["cell-current", "https://www.cell.com/cell/current.rss"],
  ["plos-biology", "https://journals.plos.org/plosbiology/feed/atom"],
  ["nature-research", "https://www.nature.com/nature/research-articles.rss"],
  ["nature-main", "https://www.nature.com/nature.rss"],
  // APIs
  ["crossref-journal-neuron", "https://api.crossref.org/journals/0896-6273/works?sort=published&order=desc&rows=5"],
  ["crossref-journal-mind", "https://api.crossref.org/journals/0026-4423/works?sort=published&order=desc&rows=5"],
  ["crossref-journal-filtered", "https://api.crossref.org/journals/0026-4423/works?sort=published&order=desc&rows=5&filter=until-pub-date:2026-10-11"],
  ["crossref-work", "https://api.crossref.org/works/10.1038/nature14539"],
  ["openalex-search", "https://api.openalex.org/works?search=predictive%20coding&sort=publication_date:desc&filter=to_publication_date:2026-10-11&per-page=5"],
  ["openalex-field-28", "https://api.openalex.org/fields/28"],
  ["openalex-subfield-1211", "https://api.openalex.org/subfields/1211"],
  ["openalex-subfield-1702", "https://api.openalex.org/subfields/1702"],
  ["openalex-field-32", "https://api.openalex.org/fields/32"],
  ["openalex-filtered", "https://api.openalex.org/works?filter=primary_topic.field.id:28,to_publication_date:2026-10-11&sort=publication_date:desc&per-page=5"],
  ["openalex-source-issn", "https://api.openalex.org/sources/issn:0896-6273"],
  ["arxiv-api-id", "https://export.arxiv.org/api/query?id_list=1706.03762"],
  ["biorxiv-api-range", "https://api.biorxiv.org/details/biorxiv/2026-10-01/2026-10-02/0"],
  // pages: readable from a server, and what they declare
  ["page-nature-article", "https://www.nature.com/articles/nature14539"],
  ["page-jneurosci", "https://www.jneurosci.org/"],
  ["page-cell-neuron", "https://www.cell.com/neuron/home"],
  ["page-wiley-nous", "https://onlinelibrary.wiley.com/journal/14680068"],
  ["page-oup-mind", "https://academic.oup.com/mind"],
  ["page-philpapers", "https://philpapers.org/"],
  ["page-arxiv-abs", "https://arxiv.org/abs/1706.03762"],
  ["page-arxiv-list", "https://arxiv.org/list/q-bio.NC/recent"],
  ["page-biorxiv-collection", "https://www.biorxiv.org/collection/neuroscience"],
  ["page-sciencedirect-journal", "https://www.sciencedirect.com/journal/neuroimage"],
  ["page-doi", "https://doi.org/10.1038/nature14539"],
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
              title: (i.title?.[0] ?? i.display_name ?? i.title ?? "").slice(0, 90),
              date: i.published?.["date-parts"]?.[0] ?? i.publication_date ?? i.date,
              link: i.URL ?? i.doi ?? i.primary_location?.landing_page_url,
              source: i["container-title"]?.[0] ?? i.primary_location?.source?.display_name ?? i.category,
              abstract: Boolean(i.abstract || i.abstract_inverted_index),
            }))
          : undefined,
        work: body?.message?.ISSN ? { issn: body.message.ISSN, container: body.message["container-title"], type: body.message.type } : undefined,
        named: body?.display_name, idOf: body?.id, issnL: body?.issn_l, works: body?.works_count,
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
  const results = await Promise.all(mine.map(([id, url]) => probe(id, url)));
  return NextResponse.json({ part, parts: Math.ceil(CANDIDATES.length / size), results });
}
