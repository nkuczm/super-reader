/**
 * Research: links to papers, preprint servers and journals, turned into
 * something that can be followed.
 *
 * Measured from the deployment on 11 Oct 2026 (docs/COLLECTION.md §2), and
 * the reason this is a rung of its own rather than ordinary discovery:
 * almost no publisher will show a server its pages. nature.com answers an
 * article with a "Client Challenge", and jneurosci.org, cell.com, Wiley,
 * Oxford, ScienceDirect and PhilPapers all answer 403 — so a pasted paper
 * cannot be read to find out which journal it is from. What the link
 * itself says has to be enough: an arXiv identifier, a bioRxiv collection,
 * a DOI (in its own right, or inside a publisher's address), or an address
 * under a journal the directory already holds. The journal is then found
 * from that, without touching the publisher's site.
 *
 * Their feeds are another matter: most still answer (Wiley, Taylor &
 * Francis, Cell Press, Nature, eLife, PLOS), and the directory holds the
 * ones that were measured. Where a journal has none that answers, its
 * newest papers come from OpenAlex, by ISSN.
 */

import { buildApiSourceUrl, OSF_SERVERS } from "./apis";
import { ARXIV_CATEGORIES, arxivQuery } from "./arxiv";
import { OUTLETS, RESEARCH_CATEGORIES, isResearchCategory, type Outlet } from "./outlets";
import type { KnownFeed } from "./publishers";

/** Directory categories that are research rather than news. */
export { RESEARCH_CATEGORIES };
export const isResearch = (outlet: Outlet) => isResearchCategory(outlet.category);

/** A route into research: a feed (or API source) to follow, and the paper it was found from. */
export type ScholarlyRoute = KnownFeed & { fromArticle?: { url: string; title?: string } };

/* ---------- arXiv ---------- */

export { ARXIV_CATEGORIES };

/** An arXiv category as arXiv spells it ("q-bio.NC", "cs.AI", "quant-ph"), or null. */
export function arxivCategory(value: string): string | null {
  const v = value.trim();
  if (!/^[a-z]+(?:-[a-z]+)?(?:\.[A-Za-z]+(?:-[a-z]+)?)?$/.test(v)) return null;
  const known = Object.keys(ARXIV_CATEGORIES).find((cat) => cat.toLowerCase() === v.toLowerCase());
  return known ?? null;
}

/**
 * A category is followed through arXiv's API, not its RSS: the RSS lists
 * only the latest announcement, and arXiv announces nothing at weekends —
 * every category feed measured on Sunday 11 Oct 2026 was empty, while the
 * API answered each with its newest twenty, the newest three days old.
 */
export function arxivRoute(cat: string): ScholarlyRoute {
  const name = ARXIV_CATEGORIES[cat];
  return {
    feedUrl: buildApiSourceUrl("arxiv", { q: arxivQuery(cat) }),
    title: `arXiv · ${name ?? cat}`,
    siteUrl: `https://arxiv.org/list/${cat}/recent`,
    faviconHost: "arxiv.org",
    scope: "section",
    note: `New submissions to arXiv's ${name ? `${name} (${cat})` : cat} category, newest first.`,
  };
}

const ARXIV_ID = /(\d{4}\.\d{4,5}|[a-z-]+(?:\.[A-Z]{2})?\/\d{7})(?:v\d+)?/;

/** An arXiv paper's identifier from a link to it, "arXiv:2410.12345", or its DOI. */
export function arxivIdFrom(input: string): string | null {
  const raw = input.trim();
  const prefixed = raw.match(new RegExp(`^arxiv:\\s*${ARXIV_ID.source}$`, "i"));
  if (prefixed) return prefixed[1];
  const doi = raw.match(new RegExp(`10\\.48550/arxiv\\.${ARXIV_ID.source}`, "i"));
  if (doi) return doi[1];
  const url = asUrl(raw);
  if (!url || !/(^|\.)arxiv\.org$/.test(url.hostname)) return null;
  const path = url.pathname.match(new RegExp(`^/(?:abs|pdf|html|format)/${ARXIV_ID.source}`));
  return path ? path[1] : null;
}

/** The category an arXiv link or name points at: a listing, an archive, a category feed, or "arxiv cs.AI". */
export function arxivCategoryFrom(input: string): string | null {
  const raw = input.trim();
  const named = raw.match(/^arxiv[\s:·-]+(\S+)$/i);
  if (named) return arxivCategory(named[1]);
  const url = asUrl(raw);
  if (!url || !/(^|\.)arxiv\.org$/.test(url.hostname)) return null;
  const path = url.pathname.match(/^\/(?:list|archive|rss|atom|catchup)\/([^/]+)/);
  return path ? arxivCategory(decodeURIComponent(path[1])) : null;
}

/* ---------- bioRxiv and medRxiv ---------- */

/** "neuroscience", "cell_biology": the subject in a collection link, as the bioRxiv API spells it. */
export function rxivFrom(input: string): { server: "biorxiv" | "medrxiv"; subject?: string; doi?: string } | null {
  const url = asUrl(input.trim());
  if (!url) return null;
  const server = /(^|\.)biorxiv\.org$/.test(url.hostname) ? "biorxiv" : /(^|\.)medrxiv\.org$/.test(url.hostname) ? "medrxiv" : null;
  if (!server) return null;
  const subject = url.pathname.match(/^\/collection\/([a-z_-]+)/i)?.[1];
  if (subject) return { server, subject: subject.toLowerCase().replace(/-/g, "_") };
  // 10.1101/2025.10.29.685457 (or 10.64898/…, the newer prefix), or an early 10.1101/123456.
  const doi = url.pathname.match(/^\/content\/(10\.\d{4,9}\/(?:\d{4}\.\d{2}\.\d{2}\.\d+|\d{6,}))/)?.[1];
  return doi ? { server, doi } : { server };
}

export function rxivRoute(server: "biorxiv" | "medrxiv", subject: string): ScholarlyRoute {
  const label = subject.replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase());
  const name = server === "biorxiv" ? "bioRxiv" : "medRxiv";
  return {
    feedUrl: buildApiSourceUrl("rxiv", { server, subject }),
    title: `${name} · ${label}`,
    siteUrl: `https://www.${server}.org/collection/${subject.replace(/_/g, "-")}`,
    faviconHost: `${server}.org`,
    scope: "section",
    note: `New preprints in ${name}'s ${label.toLowerCase()} collection, newest first.`,
  };
}

/* ---------- DOIs ---------- */

/**
 * The DOI a link carries, in any of the shapes publishers put one in:
 * doi.org links, "doi:10…", a bare DOI, Atypon and Wiley's /doi/…,
 * Springer's /article/10…, PLOS's ?id=, Nature's /articles/<id> and
 * eLife's /articles/<n> (whose DOIs are built from those).
 */
export function doiFrom(input: string): string | null {
  const raw = input.trim();
  const clean = (doi: string) => decodeURIComponent(doi).replace(/[?#].*$/, "").replace(/[.,;)\]]+$/, "").replace(/\/(?:abstract|full|pdf|epdf|meta)$/i, "");
  const bare = raw.match(/^(?:doi:\s*)?(10\.\d{4,9}\/\S+)$/i);
  if (bare) return clean(bare[1]);
  const url = asUrl(raw);
  if (!url) return null;
  const host = url.hostname.replace(/^www\./, "");
  if (/^(dx\.)?doi\.org$/.test(host)) {
    const doi = url.pathname.slice(1);
    return /^10\.\d{4,9}\//.test(decodeURIComponent(doi)) ? clean(doi) : null;
  }
  const inPath = url.pathname.match(/\/(10\.\d{4,9}\/.+)$/);
  if (inPath && /\/(doi|article|chapter|content)(\/(abs|full|pdf|epdf|epub|book|reader))?\/10\./.test(url.pathname)) return clean(inPath[1]);
  const inQuery = [...url.searchParams.values()].find((v) => /^10\.\d{4,9}\//.test(v));
  if (inQuery) return clean(inQuery);
  if (host === "nature.com") {
    const id = url.pathname.match(/^\/articles\/([a-z0-9.-]+)$/i)?.[1];
    if (id) return `10.1038/${id}`;
  }
  if (host === "elifesciences.org") {
    const n = url.pathname.match(/^\/articles\/(\d+)/)?.[1];
    if (n) return `10.7554/eLife.${n}`;
  }
  return null;
}

/** An Elsevier article's PII, from a ScienceDirect or Cell Press address. */
export function piiFrom(input: string): string | null {
  const url = asUrl(input.trim());
  if (!url) return null;
  const sd = url.pathname.match(/\/pii\/(S[0-9X]{16})/i)?.[1];
  if (sd) return sd.toUpperCase();
  // cell.com/neuron/fulltext/S0896-6273(26)00728-2
  const cell = url.pathname.match(/\/(?:fulltext|abstract|pdf)\/(S\d{4}-\d{3}[\dX]\(\d{2}\)\d{5}-[\dX])/i)?.[1];
  return cell ? cell.replace(/[-()]/g, "").toUpperCase() : null;
}

/* ---------- journals ---------- */

/** "1468-0068" from "14680068", "1468-0068" or "ISSN 1468-0068"; null when it is not one. */
export function normalIssn(value: string): string | null {
  const digits = value.toUpperCase().replace(/[^0-9X]/g, "");
  return /^\d{7}[\dX]$/.test(digits) ? `${digits.slice(0, 4)}-${digits.slice(4)}` : null;
}

/** The directory entry for a journal, by any of its ISSNs. */
export function directoryForIssn(issns: string[]): Outlet | null {
  const wanted = new Set(issns.map(normalIssn).filter((v): v is string => !!v));
  return OUTLETS.find((outlet) => outlet.issn?.some((issn) => wanted.has(issn))) ?? null;
}

/**
 * The directory's research entry an address sits under: same host, and its
 * path inside the entry's own (the longest such wins). cell.com/neuron/… is
 * Neuron; jneurosci.org/content/… is the Journal of Neuroscience. Research
 * only — news sections have their own, measured, way of being found.
 */
export function directoryForUrl(input: string): Outlet | null {
  const url = asUrl(input.trim());
  if (!url) return null;
  const host = url.hostname.replace(/^www\./, "").toLowerCase();
  const path = url.pathname.replace(/\/+$/, "").toLowerCase();
  let best: { outlet: Outlet; length: number } | null = null;
  for (const outlet of OUTLETS) {
    if (!isResearch(outlet)) continue;
    const site = asUrl(outlet.siteUrl);
    if (!site || site.hostname.replace(/^www\./, "").toLowerCase() !== host) continue;
    const base = site.pathname.replace(/\/+$/, "").toLowerCase();
    if (base && path !== base && !path.startsWith(`${base}/`)) continue;
    if (!best || base.length > best.length) best = { outlet, length: base.length };
  }
  return best?.outlet ?? null;
}

export function outletRoute(outlet: Outlet): ScholarlyRoute {
  return {
    feedUrl: outlet.feedUrl,
    title: outlet.section && outlet.section !== "All" ? `${outlet.name} · ${outlet.section}` : outlet.name,
    siteUrl: outlet.siteUrl,
    faviconHost: asUrl(outlet.siteUrl)?.hostname.replace(/^www\./, "") ?? "openalex.org",
    scope: "section",
    // Followed by ISSN: say so, rather than describe the API that answers.
    ...(outlet.feedUrl.startsWith("api:journal?")
      ? { note: `The newest papers in ${outlet.name}, from OpenAlex's index of what publishers register — ${asUrl(outlet.siteUrl)?.hostname.replace(/^www\./, "")} will not serve a feed to a server.` }
      : {}),
  };
}

/** A journal by ISSN: its directory entry when it has one, otherwise its newest papers through OpenAlex. */
export function journalRoute(issns: string[], name: string, siteUrl?: string): ScholarlyRoute | null {
  const known = directoryForIssn(issns);
  if (known) return outletRoute(known);
  const issn = issns.map(normalIssn).find((v): v is string => !!v);
  if (!issn) return null;
  return {
    feedUrl: buildApiSourceUrl("journal", { issn, name }),
    title: name || `Journal ${issn}`,
    siteUrl: siteUrl || `https://portal.issn.org/resource/ISSN/${issn}`,
    faviconHost: siteUrl ? asUrl(siteUrl)?.hostname.replace(/^www\./, "") ?? "openalex.org" : "openalex.org",
    scope: "section",
    note: `The newest papers in ${name || `the journal with ISSN ${issn}`}, from OpenAlex's index of what publishers register.`,
  };
}

/** A Wiley journal's address names its ISSN: onlinelibrary.wiley.com/journal/14680068. */
export function wileyJournalFrom(input: string): string | null {
  const url = asUrl(input.trim());
  if (!url || !/(^|\.)onlinelibrary\.wiley\.com$/.test(url.hostname)) return null;
  const issn = url.pathname.match(/^\/journal\/(\d{7}[\dX])\/?$/i)?.[1];
  return issn ? normalIssn(issn) : null;
}

function asUrl(value: string): URL | null {
  if (!value || /\s/.test(value)) return null;
  try {
    return new URL(/^https?:\/\//i.test(value) ? value : `https://${value}`);
  } catch {
    return null;
  }
}

/* ---------- the rung ---------- */

type Lookups = {
  /** arXiv's own record of a paper: its primary category and title. */
  arxiv: (id: string) => Promise<{ category: string; title?: string } | null>;
  /** bioRxiv's or medRxiv's record of a preprint: its subject and title. */
  rxiv: (server: "biorxiv" | "medrxiv", doi: string) => Promise<{ subject: string; title?: string } | null>;
  /** A DOI's journal: its ISSNs and name, and the paper's title. */
  doi: (doi: string) => Promise<{ issns: string[]; journal: string; title?: string } | null>;
  /** An Elsevier PII's journal, the same way. */
  pii: (pii: string) => Promise<{ issns: string[]; journal: string; title?: string } | null>;
};

/**
 * What a pasted link to research should follow — or null to let ordinary
 * discovery have it. Order matters: what the link says outright (an arXiv
 * listing, a bioRxiv collection, a journal the directory holds) before
 * anything that needs a lookup.
 */
/** OSF's preprint DOIs, by prefix: a paper's DOI names the server it was posted to (measured: SocArXiv 10.31235). */
const OSF_DOI: Record<string, string> = { "10.31234": "psyarxiv", "10.31235": "socarxiv" };

/**
 * Which OSF preprint server a link, a DOI or a bare name points at:
 * osf.io/preprints/socarxiv/…, psyarxiv.com/…, doi.org/10.31234/osf.io/…,
 * or just "psyarxiv". A paper is followed as its server, as an arXiv paper is
 * followed as its category.
 */
export function osfFrom(input: string): string | null {
  const raw = input.trim();
  const named = raw.toLowerCase().replace(/\s+/g, "");
  if (OSF_SERVERS[named]) return named;
  const doi = raw.match(/\b(10\.\d{4,9})\/osf\.io\//i)?.[1];
  if (doi && OSF_DOI[doi]) return OSF_DOI[doi];
  let url: URL;
  try {
    url = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`);
  } catch {
    return null;
  }
  const host = url.hostname.replace(/^www\./, "").toLowerCase();
  const onOsf = host === "osf.io" ? url.pathname.match(/^\/preprints\/([a-z]+)/i)?.[1]?.toLowerCase() : undefined;
  if (onOsf && OSF_SERVERS[onOsf]) return onOsf;
  const own = host.split(".")[0];
  return host.split(".").length === 2 && OSF_SERVERS[own] ? own : null;
}

export function osfRoute(server: string): ScholarlyRoute {
  const label = OSF_SERVERS[server]?.label ?? server;
  return {
    feedUrl: buildApiSourceUrl("osf", { server }),
    title: label.split(" (")[0],
    siteUrl: `https://osf.io/preprints/${server}`,
    faviconHost: "osf.io",
    scope: "section",
    note: `New preprints on ${label}, newest first — first versions only, not revisions.`,
  };
}

export async function scholarlyRoute(input: string, lookups: Lookups = LIVE): Promise<ScholarlyRoute | null> {
  const raw = input.trim();
  if (!raw) return null;

  const cat = arxivCategoryFrom(raw);
  if (cat) return arxivRoute(cat);
  const arxivId = arxivIdFrom(raw);
  if (arxivId) {
    const paper = await lookups.arxiv(arxivId).catch(() => null);
    const category = paper && arxivCategory(paper.category);
    if (category) return { ...arxivRoute(category), fromArticle: { url: `https://arxiv.org/abs/${arxivId}`, title: paper?.title } };
    return null;
  }

  const rxiv = rxivFrom(raw);
  if (rxiv?.subject) return rxivRoute(rxiv.server, rxiv.subject);
  if (rxiv?.doi) {
    const paper = await lookups.rxiv(rxiv.server, rxiv.doi).catch(() => null);
    if (paper) return { ...rxivRoute(rxiv.server, paper.subject), fromArticle: { url: raw, title: paper.title } };
    return null;
  }

  const osf = osfFrom(raw);
  if (osf) return osfRoute(osf);

  const listed = directoryForUrl(raw);
  if (listed) return { ...outletRoute(listed), ...(articleish(raw, listed) ? { fromArticle: { url: raw } } : {}) };

  const wiley = wileyJournalFrom(raw);
  if (wiley) {
    const known = directoryForIssn([wiley]);
    if (known) return outletRoute(known);
    const meta = await lookups.doi(`issn:${wiley}`).catch(() => null);
    return {
      feedUrl: `https://onlinelibrary.wiley.com/feed/${wiley.replace("-", "")}/most-recent`,
      title: meta?.journal || `Wiley journal ${wiley}`,
      siteUrl: `https://onlinelibrary.wiley.com/journal/${wiley.replace("-", "")}`,
      faviconHost: "onlinelibrary.wiley.com",
      scope: "section",
    };
  }

  const doi = doiFrom(raw);
  const pii = doi ? null : piiFrom(raw);
  if (doi || pii) {
    const found = await (doi ? lookups.doi(doi) : lookups.pii(pii!)).catch(() => null);
    if (!found) return null;
    const route = journalRoute(found.issns, found.journal);
    return route ? { ...route, fromArticle: { url: /^https?:\/\//i.test(raw) ? raw : `https://doi.org/${doi}`, title: found.title } } : null;
  }
  return null;
}

/** A pasted address that is a paper rather than the journal's own front page. */
function articleish(raw: string, outlet: Outlet): boolean {
  const url = asUrl(raw);
  const site = asUrl(outlet.siteUrl);
  if (!url || !site) return false;
  return url.pathname.replace(/\/+$/, "").split("/").length > site.pathname.replace(/\/+$/, "").split("/").length + 1;
}

/* ---------- the lookups, live ---------- */

const UA = "SuperReader/1.0 (research feeds; https://github.com/nkuczm/super-reader)";

async function getJson(url: string): Promise<any> {
  const res = await fetch(url, { headers: { accept: "application/json", "user-agent": UA }, signal: AbortSignal.timeout(10000) });
  if (!res.ok) throw new Error(`${res.status}`);
  return res.json();
}

const LIVE: Lookups = {
  async arxiv(id) {
    const res = await fetch(`https://export.arxiv.org/api/query?id_list=${encodeURIComponent(id)}`, { headers: { "user-agent": UA }, signal: AbortSignal.timeout(10000) });
    if (!res.ok) return null;
    const xml = await res.text();
    const category = xml.match(/<arxiv:primary_category[^>]*term="([^"]+)"/)?.[1];
    const title = xml.match(/<entry>[\s\S]*?<title>([\s\S]*?)<\/title>/)?.[1]?.replace(/\s+/g, " ").trim();
    return category ? { category, title } : null;
  },
  async rxiv(server, doi) {
    const body = await getJson(`https://api.biorxiv.org/details/${server}/${doi}`);
    const record = body?.collection?.[0];
    return record?.category ? { subject: String(record.category).toLowerCase().replace(/\s+/g, "_"), title: record.title } : null;
  },
  async doi(doi) {
    // Crossref holds every DOI the moment it is registered; one lookup on a paste is well inside its limits.
    if (doi.startsWith("issn:")) {
      const body = await getJson(`https://api.crossref.org/journals/${doi.slice(5)}`);
      return { issns: body?.message?.ISSN ?? [], journal: body?.message?.title ?? "" };
    }
    const body = await getJson(`https://api.crossref.org/works/${encodeURIComponent(doi).replace(/%2F/g, "/")}`);
    const work = body?.message;
    if (!work?.ISSN?.length) return null;
    return { issns: work.ISSN, journal: work["container-title"]?.[0] ?? "", title: work.title?.[0] };
  },
  async pii(pii) {
    const body = await getJson(`https://api.crossref.org/works?filter=alternative-id:${encodeURIComponent(pii)}&rows=1`);
    const work = body?.message?.items?.[0];
    if (!work?.ISSN?.length) return null;
    return { issns: work.ISSN, journal: work["container-title"]?.[0] ?? "", title: work.title?.[0] };
  },
};
