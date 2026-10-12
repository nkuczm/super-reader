import { stripHtml, toIso, faviconFor, fetchText, parseFeed, looksLikeFeed } from "./feed";
import { sortNewestFirst } from "./sort";
import type { Article, Attachment, SourceMeta } from "./types";
import { ARXIV_CATEGORIES as ARXIV_NAMES } from "./arxiv";

/**
 * A directory of data APIs — CourtListener, the Federal Register, arXiv and
 * friends — that can be followed like any other source.
 *
 * These are not feeds. They answer with JSON, they take a query, and several
 * want a key. Rather than one adapter per site scattered through the app, each
 * one is a row in the registry below: how to build the request, where the
 * items live in the answer, and how one item becomes an Article. Everything
 * else — preview, refresh, the reader, sync, offline — already works on
 * Articles and needs no knowledge that an API was involved.
 *
 * ## Adding an API
 *
 * Append a provider to API_PROVIDERS with:
 *
 *   id/name/category/description  what the catalogue shows
 *   params                        what the user fills in (query, court, state…)
 *   request()                     the URL (and headers) to call
 *   items()                       the array of records in the response
 *   article()                     one record as an Article
 *
 * Set `envKey` if it needs a credential, and `keyOptional` when the API still
 * answers without one at a lower rate limit. Set `format: "feed"` if the API
 * replies with RSS/Atom instead of JSON — then `items`/`article` are not
 * needed, because the existing feed parser handles the body.
 *
 * There is a test asserting every provider is well formed; it will tell you
 * what a new row is missing.
 */

export type ApiParamOption = { value: string; label: string };

export type ApiParam = {
  key: string;
  label: string;
  placeholder?: string;
  required?: boolean;
  /** Present for a fixed set of choices; the UI renders a select. */
  options?: ApiParamOption[];
  default?: string;
  hint?: string;
};

export type ApiParams = Record<string, string>;

export type ApiRequest = { url: string; headers?: Record<string, string> };

/**
 * Some sources serve their text through the API and not to a fetch of the page.
 * CourtListener is the case that forced this: the opinion page answers a
 * non-browser request with a 2KB stub, so scraping it yields nothing, while the
 * API holds the whole opinion.
 */
export type ApiReader = {
  /** Whether this provider owns the article at this URL. */
  owns: (url: string) => boolean;
  read: (
    url: string,
    context: { key: string | null },
  ) => Promise<{
    title?: string;
    html: string;
    byline?: string;
    /** Files the record itself points at, such as the filed PDF. */
    attachments?: Attachment[];
  } | null>;
};

/**
 * Court opinions arrive as one <pre> slab: fixed-width text, hard-wrapped at
 * whatever the court used, with citation links inside. Rendered as-is that is
 * a horizontally scrolling wall on a phone, so the hard wrapping is undone and
 * the paragraphs are allowed to flow. Blank lines separate paragraphs; single
 * newlines are the court's line breaks, not the author's.
 */
export function reflowPreformatted(html: string): string {
  if (!/<pre\b/i.test(html)) return html;
  return html.replace(/<pre\b[^>]*>([\s\S]*?)<\/pre>/gi, (_match, inner: string) => {
    const blocks = inner
      .split(/\n\s*\n/)
      .map((block) => block.replace(/\s*\n\s*/g, " ").trim())
      .filter(Boolean);
    return blocks.length > 0 ? blocks.map((b) => `<p>${b}</p>`).join("") : inner;
  });
}

export type ApiProvider = {
  id: string;
  name: string;
  category: string;
  description: string;
  siteUrl: string;
  docsUrl: string;
  /** Environment variable carrying the credential, when the API needs one. */
  envKey?: string;
  /** The API answers without a key too, usually at a lower rate limit. */
  keyOptional?: boolean;
  /** How to get a key, shown when one is missing. */
  keyHint?: string;
  params: ApiParam[];
  /** "json" (the default) or "feed" when the API answers with RSS/Atom. */
  format?: "json" | "feed";
  request: (
    params: ApiParams,
    context: { limit: number; key: string | null },
  ) => ApiRequest;
  /** JSON only: the array of records inside the response. */
  items?: (body: any) => any[];
  /** JSON only: one record as an Article, or null to drop it. */
  article?: (item: any, params: ApiParams) => Article | null;
  /**
   * The URL of the next page, when an API pages its results. Without this a
   * source shows one page and looks like it has stopped: CourtListener's
   * search returns 20 whatever you ask for.
   */
  nextPage?: (body: any, url: string) => string | null;
  /**
   * Another way to the same records, used when the first one cannot answer
   * (rate-limited, down, timed out). A journal's newest papers come from
   * OpenAlex, and from Crossref when OpenAlex is busy: two services, two
   * separate limits.
   */
  fallback?: Pick<ApiProvider, "request" | "items" | "article">;
  /** Ask the fallback first, for these parameters (the journal route's `via=crossref`). */
  fallbackFirst?: (params: Record<string, string>) => boolean;
  /**
   * Read every page nextPage offers (up to four), however many records the
   * first held: for an API whose first page is its oldest, stopping once
   * "enough" had arrived showed a week-old preprint as the newest.
   */
  readAllPages?: boolean;
  /** The name this source gets, given what the user asked for. */
  title: (params: ApiParams) => string;
  /** How to get an article's text from the API rather than from the page. */
  reader?: ApiReader;
};

/** First value that is a non-empty string. */
function pick(...values: unknown[]): string | undefined {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return undefined;
}

/** Collapse whitespace and drop any markup an API embedded in a field. */
function clean(value: unknown, max = 400): string | undefined {
  if (typeof value !== "string" || !value.trim()) return undefined;
  const text = stripHtml(value, max);
  return text || undefined;
}

/** YYYYMMDD, as openFDA and a few others report dates. */
/**
 * A date the publisher put in the future is not a publication date.
 *
 * Crossref carries whatever the publisher registered, and that includes
 * cover dates months ahead of the issue and outright mistakes — one 2011
 * paper is filed as published in the year 2100. Either way the article would
 * sit at the top of the reader until the date passed, which is worse than
 * the ingestion dates this set out to fix. A small grace period allows for
 * clock skew and same-day publication in a later timezone.
 */
function notFuture(iso: string | undefined, now = Date.now()): string | undefined {
  if (!iso) return undefined;
  const at = Date.parse(iso);
  if (!Number.isFinite(at)) return undefined;
  return at <= now + 36 * 60 * 60 * 1000 ? iso : undefined;
}

/**
 * Crossref carries the real publication date as parts — [[2024, 5, 17]] —
 * separately from the timestamps that record when the DOI was registered
 * with Crossref.
 */
function fromDateParts(value: unknown): string | undefined {
  const parts = (value as { "date-parts"?: unknown[][] } | undefined)?.["date-parts"]?.[0];
  if (!Array.isArray(parts) || parts.length === 0) return undefined;
  const [year, month = 1, day = 1] = parts.map((part) => Number(part));
  if (!Number.isFinite(year)) return undefined;
  const iso = `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(
    day,
  ).padStart(2, "0")}T00:00:00Z`;
  return toIso(iso);
}

/**
 * A date is when the thing happened or was published — filed, introduced,
 * posted, issued — and never when the API's own record of it was created or
 * last touched. Those bookkeeping timestamps move whenever the publisher
 * reindexes, so they read as "just now" for documents that are years old,
 * which sorted a 2020 trial above this morning's news.
 */
function fromCompactDate(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const match = value.match(/^(\d{4})(\d{2})(\d{2})$/);
  // Normalised like every other provider's date, so one shape reaches the
  // reader and the story corpus.
  return toIso(match ? `${match[1]}-${match[2]}-${match[3]}T00:00:00Z` : value);
}

const query = (value: string) => encodeURIComponent(value.trim());

/** Today, as the APIs below want a date: "2026-10-11". Papers dated later than this are a cover date, not a publication. */
const today = () => new Date().toISOString().slice(0, 10);
const yearAgo = () => new Date(Date.now() - 365 * 86_400_000).toISOString().slice(0, 10);

/** One Crossref work as an Article. */
function crossrefArticle(item: any): Article | null {
  const title = pick(item?.title?.[0]);
  const link = pick(item?.URL);
  if (!title || !link) return null;
  const authors = (item.author ?? [])
    .map((person: any) => pick(person?.family ? `${person.given ?? ""} ${person.family}` : person?.name))
    .filter(Boolean);
  return {
    id: `crossref:${pick(item.DOI) ?? link}`,
    title,
    link,
    author: authors.slice(0, 3).join(", ") || pick(item["container-title"]?.[0]),
    publishedAt: crossrefDate(item),
    summary: clean(item.abstract),
  };
}

/**
 * When a Crossref work appeared. A date to the day wins, in any of the forms
 * Crossref records one, skipping any that has not happened yet. Many
 * publishers deposit only a year or a month — Cambridge, the Journal of
 * Philosophy and Duke among them — which read as 1 January and made a
 * journal publishing that week look nine months quiet (12 Oct 2026). For
 * those, the DOI's registration is the real moment, so long as it falls
 * inside that year or month: a 2011 paper deposited last week must not
 * arrive as last week's news.
 */
function crossrefDate(item: any): string | undefined {
  const forms = [item.published, item["published-online"], item["published-print"], item.issued];
  const precise = forms.find((form) => form?.["date-parts"]?.[0]?.length >= 3 && notFuture(fromDateParts(form)));
  if (precise) return notFuture(fromDateParts(precise));
  const coarse = forms.map((form) => form?.["date-parts"]?.[0]).find((parts) => Array.isArray(parts) && parts.length > 0) as number[] | undefined;
  const created = toIso(pick(item.created?.["date-time"]));
  if (!coarse) return created;
  const [year, month] = coarse.map(Number);
  if (created) {
    const at = new Date(created);
    if (at.getUTCFullYear() === year && (month === undefined || at.getUTCMonth() + 1 >= month)) return created;
  }
  return notFuture(fromDateParts({ "date-parts": [coarse] })) ?? created;
}

/**
 * OpenAlex keeps an abstract as an inverted index — each word with the
 * places it appears — rather than as text, for licensing reasons. Put back
 * in order, it reads as the abstract did.
 */
export function abstractFrom(index: unknown, max = 600): string | undefined {
  if (!index || typeof index !== "object") return undefined;
  const words: string[] = [];
  for (const [word, places] of Object.entries(index as Record<string, unknown>)) {
    if (!Array.isArray(places)) continue;
    for (const at of places) if (Number.isInteger(at) && at >= 0 && at < 5000) words[at] = word;
  }
  const text = words.filter(Boolean).join(" ").replace(/\s+/g, " ").trim();
  return text ? clean(text, max) : undefined;
}

/** One OpenAlex work as an Article: its DOI as the link, the journal after its authors. */
export function openAlexArticle(item: any): Article | null {
  const title = clean(pick(item?.display_name, item?.title), 300);
  const link = pick(item?.doi, item?.primary_location?.landing_page_url, item?.id);
  if (!title || !link) return null;
  const people = (Array.isArray(item.authorships) ? item.authorships : [])
    .map((a: any) => pick(a?.author?.display_name))
    .filter(Boolean) as string[];
  const names = people.length > 3 ? `${people.slice(0, 3).join(", ")} et al.` : people.join(", ");
  const venue = pick(item?.primary_location?.source?.display_name);
  return {
    id: `openalex:${pick(item.id) ?? link}`,
    title,
    link,
    author: [names, venue].filter(Boolean).join(" · ") || undefined,
    publishedAt: notFuture(toIso(pick(item.publication_date) ? `${item.publication_date}T00:00:00Z` : undefined)),
    summary: abstractFrom(item.abstract_inverted_index),
  };
}

/** What a filter value may hold: OpenAlex separates filters with commas and values with pipes. */
const filterValue = (value: string) => encodeURIComponent(value.replace(/[,|:]/g, " ").replace(/\s+/g, " ").trim());

/** The fields and subfields OpenAlex files works under (ids measured 11 Oct 2026). */
export const OPENALEX_AREAS: { value: string; label: string; filter: string }[] = [
  { value: "neuroscience", label: "Neuroscience", filter: "primary_topic.field.id:28" },
  { value: "psychology", label: "Psychology", filter: "primary_topic.field.id:32" },
  { value: "philosophy", label: "Philosophy", filter: "primary_topic.subfield.id:1211" },
  { value: "ai", label: "Artificial intelligence", filter: "primary_topic.subfield.id:1702" },
];

/** The Open Science Framework's preprint servers people follow, by the id its API uses. */
export const OSF_SERVERS: Record<string, { label: string }> = {
  psyarxiv: { label: "PsyArXiv (psychology)" },
  socarxiv: { label: "SocArXiv (social sciences)" },
  edarxiv: { label: "EdArXiv (education)" },
  lawarxiv: { label: "LawArXiv (law)" },
  mediarxiv: { label: "MediArXiv (media and communication)" },
  metaarxiv: { label: "MetaArXiv (research on research)" },
  sportrxiv: { label: "SportRxiv (sport and exercise science)" },
};

/** bioRxiv's subject collections, as its API names them. */
export const BIORXIV_SUBJECTS = [
  "animal_behavior_and_cognition", "biochemistry", "bioengineering", "bioinformatics", "biophysics", "cancer_biology",
  "cell_biology", "developmental_biology", "ecology", "evolutionary_biology", "genetics", "genomics", "immunology",
  "microbiology", "molecular_biology", "neuroscience", "paleontology", "pathology", "pharmacology_and_toxicology",
  "physiology", "plant_biology", "scientific_communication_and_education", "synthetic_biology", "systems_biology", "zoology",
];
export const MEDRXIV_SUBJECTS = [
  "neurology", "psychiatry_and_clinical_psychology", "epidemiology", "infectious_diseases", "public_and_global_health",
  "health_policy", "health_informatics", "genetic_and_genomic_medicine", "oncology", "cardiovascular_medicine",
  "pediatrics", "pharmacology_and_therapeutics", "radiology_and_imaging", "rehabilitation_medicine_and_physical_therapy",
];

/** How far back a preprint collection is read: long enough to fill a source after a quiet weekend. */
const RXIV_DAYS = 5;

export const API_PROVIDERS: ApiProvider[] = [
  {
    id: "courtlistener",
    name: "CourtListener",
    category: "Law",
    description:
      "Opinions, oral arguments and PACER dockets from US federal and state courts.",
    siteUrl: "https://www.courtlistener.com",
    docsUrl: "https://www.courtlistener.com/help/api/rest/",
    envKey: "COURTLISTENER_TOKEN",
    keyOptional: true,
    keyHint:
      "Free from courtlistener.com/profile/api/ — without it the API rate-limits hard.",
    params: [
      {
        key: "q",
        label: "Search",
        placeholder: "qualified immunity",
        hint: "Left empty, this follows everything new in the chosen court.",
      },
      {
        key: "type",
        label: "Kind",
        default: "o",
        options: [
          { value: "o", label: "Opinions" },
          { value: "r", label: "PACER filings" },
          { value: "oa", label: "Oral arguments" },
        ],
      },
      {
        key: "court",
        label: "Court",
        placeholder: "scotus, ca9, cafc — blank for all",
      },
    ],
    request: ({ q = "", type = "o", court = "" }, { key }) => {
      const search = new URLSearchParams({ type, order_by: "dateFiled desc" });
      if (q.trim()) search.set("q", q.trim());
      if (court.trim()) search.set("court", court.trim());
      return {
        url: `https://www.courtlistener.com/api/rest/v4/search/?${search}`,
        headers: key ? { authorization: `Token ${key}` } : undefined,
      };
    },
    items: (body) => body?.results ?? [],
    nextPage: (body) => (typeof body?.next === "string" ? body.next : null),
    article: (item) => {
      const path = pick(item.absolute_url, item.docket_absolute_url);
      const link = path
        ? new URL(path, "https://www.courtlistener.com").toString()
        : undefined;
      const title = pick(item.caseName, item.case_name, item.docketNumber);
      if (!link || !title) return null;
      // v4 nests the matched text under the opinion, older shapes inline it.
      const snippet = pick(item.snippet, item.opinions?.[0]?.snippet, item.text);
      return {
        id: `courtlistener:${pick(item.id, item.cluster_id, link)}`,
        title,
        link,
        author: pick(item.court, item.court_id),
        publishedAt: toIso(
          // Filed, then argued. Not dateCreated: that is when CourtListener
          // ingested the record, which for a decades-old opinion is today.
          pick(item.dateFiled, item.date_filed, item.dateArgued, item.date_argued),
        ),
        summary: clean(snippet),
      };
    },
    reader: {
      owns: (url) => /^https?:\/\/(www\.)?courtlistener\.com\/opinion\/\d+\//i.test(url),
      read: async (url, { key }) => {
        const id = url.match(/\/opinion\/(\d+)\//)?.[1];
        if (!id) return null;
        if (!key) {
          throw new Error(
            "CourtListener serves opinion text through its API, which needs a key. " +
              "Add one in Settings, or set COURTLISTENER_TOKEN on this deployment.",
          );
        }
        const res = await fetch(
          `https://www.courtlistener.com/api/rest/v4/opinions/${id}/`,
          {
            headers: { authorization: `Token ${key}`, accept: "application/json" },
            signal: AbortSignal.timeout(15000),
          },
        );
        if (res.status === 401 || res.status === 403) {
          throw new Error("CourtListener rejected the API key.");
        }
        if (!res.ok) throw new Error(`CourtListener API error ${res.status}`);

        const body: any = await res.json();
        // Opinions arrive as marked-up text, as raw text, or not at all —
        // older scanned ones have only a PDF behind download_url.
        const marked = pick(
          body.html_with_citations,
          body.html,
          body.html_columbia,
          body.html_lawbox,
        );
        const html: string | undefined =
          (marked && reflowPreformatted(marked)) ||
          (typeof body.plain_text === "string" && body.plain_text.trim()
            ? body.plain_text
                .split(/\n{2,}/)
                .map((block: string) => block.trim())
                .filter(Boolean)
                .map((block: string) => `<p>${block.replace(/\n/g, " ")}</p>`)
                .join("")
            : undefined);
        if (!html) return null;

        // The court's own PDF, for reading in a proper viewer. This is a file
        // the publication genuinely links, not one invented from a field.
        const pdf = pick(
          typeof body.download_url === "string" && /\.pdf($|\?)/i.test(body.download_url)
            ? body.download_url
            : undefined,
          typeof body.local_path === "string" && /\.pdf$/i.test(body.local_path)
            ? `https://storage.courtlistener.com/${body.local_path.replace(/^\/+/, "")}`
            : undefined,
        );

        return {
          html,
          byline: pick(body.author_str, body.joined_by_str),
          attachments: pdf
            ? [{ url: pdf, kind: "pdf" as const, title: "The opinion as filed (PDF)" }]
            : undefined,
        };
      },
    },
    title: ({ q, court, type }) =>
      [
        "CourtListener",
        q?.trim() ? `“${q.trim()}”` : null,
        court?.trim() ? court.trim() : null,
        type === "r" ? "filings" : type === "oa" ? "oral arguments" : null,
      ]
        .filter(Boolean)
        .join(" · "),
  },

  {
    id: "federal-register",
    name: "Federal Register",
    category: "Government",
    description:
      "Rules, proposed rules and notices published daily by US federal agencies.",
    siteUrl: "https://www.federalregister.gov",
    docsUrl: "https://www.federalregister.gov/developers/documentation/api/v1",
    params: [
      { key: "q", label: "Search", placeholder: "artificial intelligence" },
      {
        key: "type",
        label: "Document type",
        default: "",
        options: [
          { value: "", label: "Everything" },
          { value: "RULE", label: "Final rules" },
          { value: "PRORULE", label: "Proposed rules" },
          { value: "NOTICE", label: "Notices" },
          { value: "PRESDOCU", label: "Presidential documents" },
        ],
      },
      {
        key: "agency",
        label: "Agency slug",
        placeholder: "environmental-protection-agency",
      },
    ],
    request: ({ q = "", type = "", agency = "" }, { limit }) => {
      const search = new URLSearchParams({
        per_page: String(limit),
        order: "newest",
      });
      for (const field of ["title", "html_url", "publication_date", "abstract", "agencies", "type", "document_number"])
        search.append("fields[]", field);
      if (q.trim()) search.set("conditions[term]", q.trim());
      if (type) search.append("conditions[type][]", type);
      if (agency.trim()) search.append("conditions[agencies][]", agency.trim());
      return { url: `https://www.federalregister.gov/api/v1/documents.json?${search}` };
    },
    items: (body) => body?.results ?? [],
    nextPage: (body) =>
      typeof body?.next_page_url === "string" ? body.next_page_url : null,
    article: (item) => {
      if (!item?.html_url || !item?.title) return null;
      const agencies = (item.agencies ?? [])
        .map((agency: any) => pick(agency?.name, agency?.raw_name))
        .filter(Boolean);
      return {
        id: `federal-register:${item.document_number ?? item.html_url}`,
        title: String(item.title),
        link: String(item.html_url),
        author: agencies.slice(0, 2).join(", ") || undefined,
        publishedAt: toIso(item.publication_date),
        summary: clean(item.abstract),
      };
    },
    title: ({ q, agency }) =>
      q?.trim()
        ? `Federal Register · “${q.trim()}”`
        : agency?.trim()
          ? `Federal Register · ${agency.trim()}`
          : "Federal Register",
  },

  {
    id: "regulations-gov",
    name: "Regulations.gov",
    category: "Government",
    description: "Dockets, public comments and rulemaking documents across agencies.",
    siteUrl: "https://www.regulations.gov",
    docsUrl: "https://open.gsa.gov/api/regulationsgov/",
    envKey: "REGULATIONS_GOV_API_KEY",
    keyHint: "Free key from api.data.gov/signup — the same key works for several US APIs.",
    params: [
      { key: "q", label: "Search", placeholder: "emissions standards" },
      { key: "agency", label: "Agency ID", placeholder: "EPA" },
    ],
    request: ({ q = "", agency = "" }, { limit, key }) => {
      const search = new URLSearchParams({
        "page[size]": String(Math.min(limit, 250)),
        sort: "-postedDate",
        api_key: key ?? "",
      });
      if (q.trim()) search.set("filter[searchTerm]", q.trim());
      if (agency.trim()) search.set("filter[agencyId]", agency.trim().toUpperCase());
      return { url: `https://api.regulations.gov/v4/documents?${search}` };
    },
    items: (body) => body?.data ?? [],
    article: (item) => {
      const attributes = item?.attributes ?? {};
      if (!item?.id || !attributes.title) return null;
      return {
        id: `regulations-gov:${item.id}`,
        title: String(attributes.title),
        link: `https://www.regulations.gov/document/${item.id}`,
        author: pick(attributes.agencyId),
        // Posted, not lastModifiedDate — a comment period reopening should
        // not redate the document to today.
        publishedAt: toIso(pick(attributes.postedDate)),
        summary: clean(pick(attributes.documentType, attributes.subtype)),
      };
    },
    title: ({ q, agency }) =>
      ["Regulations.gov", q?.trim() ? `“${q.trim()}”` : null, agency?.trim()]
        .filter(Boolean)
        .join(" · "),
  },

  {
    id: "congress",
    name: "Congress.gov",
    category: "Government",
    description: "Bills and resolutions as they are introduced and acted on.",
    siteUrl: "https://www.congress.gov",
    docsUrl: "https://api.congress.gov/",
    envKey: "CONGRESS_GOV_API_KEY",
    keyHint: "Free key from api.data.gov/signup.",
    params: [
      {
        key: "congress",
        label: "Congress",
        placeholder: "119 — blank for the current one",
      },
    ],
    request: ({ congress = "" }, { limit, key }) => {
      const search = new URLSearchParams({
        format: "json",
        limit: String(Math.min(limit, 250)),
        sort: "updateDate+desc",
        api_key: key ?? "",
      });
      const scope = congress.trim() ? `/${congress.trim()}` : "";
      return { url: `https://api.congress.gov/v3/bill${scope}?${search}` };
    },
    items: (body) => body?.bills ?? [],
    article: (item) => {
      const title = pick(item?.title);
      const number = pick(item?.number, String(item?.number ?? ""));
      if (!title || !number || !item?.congress) return null;
      // The API returns its own URL; the readable page is built from the type.
      const slugs: Record<string, string> = {
        hr: "house-bill",
        s: "senate-bill",
        hjres: "house-joint-resolution",
        sjres: "senate-joint-resolution",
        hconres: "house-concurrent-resolution",
        sconres: "senate-concurrent-resolution",
        hres: "house-resolution",
        sres: "senate-resolution",
      };
      const type = String(item.type ?? "hr").toLowerCase();
      const slug = slugs[type] ?? "house-bill";
      return {
        id: `congress:${item.congress}-${type}-${number}`,
        title: `${type.toUpperCase()} ${number} — ${title}`,
        link: `https://www.congress.gov/bill/${item.congress}th-congress/${slug}/${number}`,
        author: pick(item.originChamber),
        // Introduced, or the latest action on it. updateDate is when the
        // API last touched its own row, and it is usually today.
        publishedAt: toIso(pick(item.introducedDate, item.latestAction?.actionDate)),
        summary: clean(item.latestAction?.text),
      };
    },
    title: ({ congress }) =>
      congress?.trim() ? `Congress.gov · ${congress.trim()}th` : "Congress.gov · bills",
  },

  {
    id: "sec-edgar",
    name: "SEC EDGAR",
    category: "Finance",
    description: "Full-text search across company filings — 8-Ks, 10-Ks, S-1s.",
    siteUrl: "https://www.sec.gov",
    docsUrl: "https://www.sec.gov/edgar/sec-api-documentation",
    params: [
      { key: "q", label: "Search", placeholder: "\"artificial intelligence\"", required: true },
      { key: "forms", label: "Forms", placeholder: "8-K,10-K — blank for all" },
    ],
    request: ({ q = "", forms = "" }) => {
      const search = new URLSearchParams({ q: q.trim() });
      if (forms.trim()) search.set("forms", forms.trim());
      return {
        url: `https://efts.sec.gov/LATEST/search-index?${search}`,
        // SEC asks automated clients to identify themselves and will refuse
        // a generic browser string.
        headers: {
          "user-agent":
            process.env.SEC_USER_AGENT ?? "super-reader (feed reader; contact via site)",
        },
      };
    },
    items: (body) => body?.hits?.hits ?? [],
    article: (item) => {
      const source = item?._source ?? {};
      const id: string = pick(item?._id) ?? "";
      // _id is "<accession-with-dashes>:<file>", and the archive path wants
      // the accession without them.
      const [accession, file] = id.split(":");
      const cik = String(source.ciks?.[0] ?? "").replace(/^0+/, "");
      if (!accession || !cik) return null;
      const bare = accession.replace(/-/g, "");
      const link = `https://www.sec.gov/Archives/edgar/data/${cik}/${bare}/${file ?? ""}`;
      const company = pick(source.display_names?.[0]) ?? "SEC filing";
      const form = pick(source.root_forms?.[0], source.file_type) ?? "Filing";
      return {
        id: `sec-edgar:${id}`,
        title: `${form} — ${company}`,
        link,
        author: company,
        publishedAt: toIso(pick(source.file_date)),
        summary: clean(pick(source.file_description, source.display_names?.join(", "))),
      };
    },
    title: ({ q, forms }) =>
      ["SEC EDGAR", q?.trim() ? `“${q.trim()}”` : null, forms?.trim()]
        .filter(Boolean)
        .join(" · "),
  },

  {
    id: "clinicaltrials",
    name: "ClinicalTrials.gov",
    category: "Health",
    description: "Registered studies, newest registrations first.",
    siteUrl: "https://clinicaltrials.gov",
    docsUrl: "https://clinicaltrials.gov/data-api/api",
    params: [
      { key: "q", label: "Condition or term", placeholder: "pancreatic cancer" },
      {
        key: "status",
        label: "Status",
        default: "",
        options: [
          { value: "", label: "Any" },
          { value: "RECRUITING", label: "Recruiting" },
          { value: "COMPLETED", label: "Completed" },
          { value: "TERMINATED", label: "Terminated" },
        ],
      },
    ],
    request: ({ q = "", status = "" }, { limit }) => {
      const search = new URLSearchParams({
        pageSize: String(Math.min(limit, 100)),
        // Sorted by first posting, to match the date shown: sorting by last
        // update returns studies from years ago that were touched today.
        sort: "StudyFirstPostDate:desc",
        countTotal: "true",
      });
      if (q.trim()) search.set("query.term", q.trim());
      if (status) search.set("filter.overallStatus", status);
      return { url: `https://clinicaltrials.gov/api/v2/studies?${search}` };
    },
    items: (body) => body?.studies ?? [],
    article: (item) => {
      const section = item?.protocolSection ?? {};
      const nctId = pick(section.identificationModule?.nctId);
      const title = pick(
        section.identificationModule?.briefTitle,
        section.identificationModule?.officialTitle,
      );
      if (!nctId || !title) return null;
      return {
        id: `clinicaltrials:${nctId}`,
        title,
        link: `https://clinicaltrials.gov/study/${nctId}`,
        author: pick(section.sponsorCollaboratorsModule?.leadSponsor?.name),
        publishedAt: toIso(
          // When the study was first posted, not when its record was last
          // revised — a 2020 trial edited this morning is not today's news.
          pick(
            section.statusModule?.studyFirstPostDateStruct?.date,
            section.statusModule?.studyFirstSubmitDateStruct?.date,
          ),
        ),
        summary: clean(section.descriptionModule?.briefSummary),
      };
    },
    title: ({ q }) =>
      q?.trim() ? `ClinicalTrials · “${q.trim()}”` : "ClinicalTrials.gov",
  },

  {
    id: "openfda",
    name: "openFDA",
    category: "Health",
    description: "Drug, device and food recalls and enforcement reports.",
    siteUrl: "https://open.fda.gov",
    docsUrl: "https://open.fda.gov/apis/",
    envKey: "OPENFDA_API_KEY",
    keyOptional: true,
    keyHint: "Optional — a free api.data.gov key raises the rate limit.",
    params: [
      {
        key: "endpoint",
        label: "Dataset",
        default: "drug/enforcement",
        options: [
          { value: "drug/enforcement", label: "Drug recalls" },
          { value: "device/enforcement", label: "Device recalls" },
          { value: "food/enforcement", label: "Food recalls" },
        ],
      },
      { key: "q", label: "Search", placeholder: "recalling_firm:acme — optional" },
    ],
    request: ({ endpoint = "drug/enforcement", q = "" }, { limit, key }) => {
      const search = new URLSearchParams({
        limit: String(Math.min(limit, 100)),
        sort: "report_date:desc",
      });
      if (q.trim()) search.set("search", q.trim());
      if (key) search.set("api_key", key);
      return { url: `https://api.fda.gov/${endpoint}.json?${search}` };
    },
    items: (body) => body?.results ?? [],
    article: (item, { endpoint = "drug/enforcement" }) => {
      const description = pick(item?.product_description, item?.reason_for_recall);
      const number = pick(item?.recall_number, item?.event_id);
      if (!description || !number) return null;
      return {
        id: `openfda:${number}`,
        title: `${pick(item.classification) ?? "Recall"} — ${stripHtml(description, 120)}`,
        // openFDA has no per-record page; the recall search is the closest thing.
        link: `https://www.accessdata.fda.gov/scripts/ires/index.cfm?Product=${encodeURIComponent(
          endpoint.split("/")[0],
        )}#tabs-2`,
        author: pick(item.recalling_firm, item.state),
        publishedAt: fromCompactDate(
          // Reported, then initiated. Not the classification date, which the
          // centre revises after the fact.
          pick(item.report_date, item.recall_initiation_date),
        ),
        summary: clean(item.reason_for_recall),
      };
    },
    title: ({ endpoint = "drug/enforcement" }) =>
      `openFDA · ${endpoint.replace("/", " ")}`,
  },

  {
    id: "arxiv",
    name: "arXiv",
    category: "Research",
    description: "Preprints, newest submissions first.",
    siteUrl: "https://arxiv.org",
    docsUrl: "https://info.arxiv.org/help/api/user-manual.html",
    // arXiv answers in Atom, so the existing feed parser reads it as-is.
    format: "feed",
    params: [
      {
        key: "q",
        label: "Query",
        placeholder: "cat:cs.AI, or all:diffusion models",
        required: true,
        hint: "arXiv syntax: cat: for a category, au: for an author, all: for anything.",
      },
    ],
    request: ({ q = "" }, { limit }) => {
      const value = q.trim();
      // A bare phrase is not valid arXiv syntax; scope it for the user.
      const expression = /\b(all|ti|au|abs|cat|jr|co|rn|id):/.test(value)
        ? value
        : `all:${value}`;
      return {
        url:
          `https://export.arxiv.org/api/query?search_query=${query(expression)}` +
          `&sortBy=submittedDate&sortOrder=descending&max_results=${limit}`,
      };
    },
    title: ({ q }) => {
      const cat = q?.trim().match(/^cat:([\w.*-]+)$/)?.[1];
      return `arXiv · ${cat ? ARXIV_NAMES[cat] ?? cat : q?.trim() ?? "recent"}`;
    },
  },

  {
    id: "crossref",
    name: "Crossref",
    category: "Research",
    description: "Newly registered journal articles across every publisher.",
    siteUrl: "https://www.crossref.org",
    docsUrl: "https://api.crossref.org/swagger-ui/index.html",
    params: [
      { key: "q", label: "Search", placeholder: "mRNA vaccine", required: true },
    ],
    request: ({ q = "" }, { limit }) => ({
      url:
        `https://api.crossref.org/works?query=${query(q)}` +
        `&sort=published&order=desc&rows=${limit}`,
    }),
    items: (body) => body?.message?.items ?? [],
    article: crossrefArticle,
    title: ({ q }) => `Crossref · “${q?.trim() ?? ""}”`,
  },

  {
    id: "journal",
    name: "A journal's newest papers",
    category: "Research",
    description: "Any journal by its ISSN — for the many whose own site will not serve a feed.",
    siteUrl: "https://openalex.org",
    docsUrl: "https://docs.openalex.org/api-entities/works/filter-works",
    params: [
      {
        key: "issn",
        label: "ISSN",
        placeholder: "0026-4423",
        required: true,
        hint: "On the journal's own site, usually labelled ISSN or eISSN. Either one works.",
      },
      { key: "name", label: "Name", placeholder: "Mind" },
    ],
    // OpenAlex first: abstracts, authors, and every publisher. Measured on
    // 11 Oct 2026 for twenty journals whose sites refuse a server, each
    // with papers from that week. `via=crossref` reverses the order, for a
    // journal whose papers OpenAlex dates only by the year — it then sorts
    // a year's papers in no particular order, and the newest go missing.
    request: ({ issn = "" }, { limit }) => ({
      url:
        `https://api.openalex.org/works?filter=primary_location.source.issn:${filterValue(issn)},` +
        `to_publication_date:${today()},type:article|preprint|review` +
        `&sort=publication_date:desc&per-page=${Math.min(limit, 50)}`,
    }),
    items: (body) => body?.results ?? [],
    article: openAlexArticle,
    // Crossref when OpenAlex cannot answer: the same journal by the same ISSN,
    // newest registered first — a publication date of only a year cannot order
    // a year's papers, and registration is when a paper appears.
    fallback: {
      request: ({ issn = "" }, { limit }) => ({
        url:
          `https://api.crossref.org/journals/${encodeURIComponent(issn.trim())}/works` +
          `?sort=created&order=desc&rows=${Math.min(limit, 50)}` +
          // A year back at most: Crossref registers old back issues as well, and a
          // registration sort put New Literary History's 1994 papers first.
          `&filter=from-pub-date:${yearAgo()},until-pub-date:${today()},type:journal-article`,
      }),
      items: (body) => body?.message?.items ?? [],
      article: crossrefArticle,
    },
    fallbackFirst: ({ via }) => via === "crossref",
    title: ({ name, issn }) => name?.trim() || `Journal ${issn?.trim() ?? ""}`,
  },

  {
    id: "openalex",
    name: "Papers (OpenAlex)",
    category: "Research",
    description:
      "New papers matching your words, across every journal and preprint server — the open index that stands in for Google Scholar, which has no API.",
    siteUrl: "https://openalex.org",
    docsUrl: "https://docs.openalex.org/api-entities/works/search-works",
    params: [
      {
        key: "q",
        label: "Words",
        placeholder: "predictive coding",
        hint: "Found in a paper's title or abstract; put a phrase in quotes. Leave empty to follow a whole field.",
      },
      {
        key: "area",
        label: "Field",
        options: [{ value: "", label: "Any field" }, ...OPENALEX_AREAS.map(({ value, label }) => ({ value, label }))],
        default: "",
      },
    ],
    request: ({ q = "", area = "" }, { limit }) => {
      const field = OPENALEX_AREAS.find((a) => a.value === area);
      if (!q.trim() && !field) throw new Error("Give OpenAlex some words to look for, or a field to follow.");
      const filters = [
        q.trim() ? `title_and_abstract.search:${filterValue(q)}` : null,
        field?.filter,
        `to_publication_date:${today()}`,
        "type:article|preprint|review",
      ].filter(Boolean);
      return {
        url: `https://api.openalex.org/works?filter=${filters.join(",")}&sort=publication_date:desc&per-page=${Math.min(limit, 50)}`,
      };
    },
    // Not Zenodo: anyone can deposit anything there, and a search sorted by date
    // brings it to the top — three of the first twelve for "predictive coding"
    // in neuroscience on 11 Oct 2026, one by an author named "Your Name".
    items: (body) => (body?.results ?? []).filter((work: any) => !/\/10\.5281\/zenodo\./i.test(String(work?.doi ?? ""))),
    article: openAlexArticle,
    title: ({ q, area }) => {
      const field = OPENALEX_AREAS.find((a) => a.value === area)?.label;
      const words = q?.trim() ? `“${q.trim()}”` : "";
      return `Papers · ${[words, field].filter(Boolean).join(" in ") || "newest"}`;
    },
  },

  {
    id: "rxiv",
    name: "bioRxiv & medRxiv",
    category: "Research",
    description: "New preprints in a subject, newest first — first versions only, not revisions.",
    siteUrl: "https://www.biorxiv.org",
    docsUrl: "https://api.biorxiv.org",
    params: [
      {
        key: "server",
        label: "Server",
        options: [{ value: "biorxiv", label: "bioRxiv (biology)" }, { value: "medrxiv", label: "medRxiv (medicine)" }],
        default: "biorxiv",
      },
      {
        key: "subject",
        label: "Subject",
        options: [...BIORXIV_SUBJECTS, ...MEDRXIV_SUBJECTS].map((value) => ({ value, label: value.replace(/_/g, " ") })),
        default: "neuroscience",
        required: true,
      },
    ],
    // The API lists a date range oldest first, thirty at a time (measured:
    // 237 neuroscience records over five days, 155 of them new papers). The
    // first page says how many there are; the rest are read from the newest end.
    request: ({ server = "biorxiv", subject = "neuroscience" }) => {
      const to = new Date();
      const from = new Date(to.getTime() - RXIV_DAYS * 86_400_000);
      const host = server === "medrxiv" ? "medrxiv" : "biorxiv";
      return {
        url:
          `https://api.biorxiv.org/details/${host}/${from.toISOString().slice(0, 10)}/${to.toISOString().slice(0, 10)}/0` +
          `?category=${encodeURIComponent(subject.trim().toLowerCase())}`,
      };
    },
    readAllPages: true,
    nextPage: (body, url) => {
      const status = body?.messages?.[0];
      const total = Number(status?.total);
      const cursor = Number(status?.cursor);
      const size = Array.isArray(body?.collection) ? body.collection.length : 0;
      if (!Number.isFinite(total) || !Number.isFinite(cursor) || !size) return null;
      // From the first page, jump to the last; from there, step back towards the first.
      const next = cursor === 0 ? Math.max(size, total - size) : cursor - size;
      if (next <= 0 || next >= total || (cursor !== 0 && next < size)) return null;
      return url.replace(/\/\d+(\?|$)/, `/${next}$1`);
    },
    items: (body) => (Array.isArray(body?.collection) ? body.collection : []).filter((item: any) => String(item?.version) === "1"),
    article: (item, { server = "biorxiv" }) => {
      const title = clean(item?.title, 300);
      const doi = pick(item?.doi);
      if (!title || !doi) return null;
      const people = String(item.authors ?? "").split(";").map((a) => a.trim()).filter(Boolean);
      return {
        id: `${server}:${doi}`,
        title,
        link: `https://www.${server === "medrxiv" ? "medrxiv" : "biorxiv"}.org/content/${doi}v1`,
        author: people.length > 3 ? `${people.slice(0, 3).join(", ")} et al.` : people.join(", ") || undefined,
        publishedAt: notFuture(toIso(pick(item.date) ? `${item.date}T00:00:00Z` : undefined)),
        summary: clean(item.abstract, 600),
      };
    },
    title: ({ server = "biorxiv", subject = "" }) =>
      `${server === "medrxiv" ? "medRxiv" : "bioRxiv"} · ${subject.replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase())}`,
  },

  {
    id: "osf",
    name: "PsyArXiv, SocArXiv & other OSF preprints",
    category: "Research",
    description: "New preprints on one of the Open Science Framework's servers — psychology, sociology, education, law and more — newest first, first versions only.",
    siteUrl: "https://osf.io/preprints",
    docsUrl: "https://developer.osf.io",
    params: [
      {
        key: "server",
        label: "Server",
        options: Object.entries(OSF_SERVERS).map(([value, { label }]) => ({ value, label })),
        default: "psyarxiv",
        required: true,
      },
    ],
    // Measured 12 Oct 2026: published preprints only, newest first, with their
    // authors embedded — a second's wait for a page, and each one's own date.
    request: ({ server = "psyarxiv" }, { limit }) => ({
      url:
        `https://api.osf.io/v2/preprints/?filter%5Bprovider%5D=${encodeURIComponent(server.trim().toLowerCase())}` +
        `&filter%5Bis_published%5D=true&sort=-date_published&page%5Bsize%5D=${Math.min(limit + 10, 50)}` +
        `&embed=bibliographic_contributors&fields%5Bpreprints%5D=title,date_published,description,bibliographic_contributors,version` +
        `&fields%5Busers%5D=full_name`,
    }),
    // A second version of an old preprint is a revision, not a new paper.
    items: (body) => (Array.isArray(body?.data) ? body.data : []).filter((item: any) => Number(item?.attributes?.version ?? 1) === 1),
    article: (item) => {
      const title = clean(item?.attributes?.title, 300);
      const link = pick(item?.links?.html);
      if (!title || !link) return null;
      const people = (item?.embeds?.bibliographic_contributors?.data ?? [])
        .map((c: any) => pick(c?.embeds?.users?.data?.attributes?.full_name, c?.attributes?.unregistered_contributor))
        .filter(Boolean) as string[];
      const at = pick(item?.attributes?.date_published);
      return {
        id: `osf:${pick(item.id) ?? link}`,
        title,
        link,
        author: people.length > 3 ? `${people.slice(0, 3).join(", ")} et al.` : people.join(", ") || undefined,
        // OSF writes its times without a zone; they are UTC.
        publishedAt: notFuture(toIso(at ? (/[zZ]|[+-]\d\d:?\d\d$/.test(at) ? at : `${at}Z`) : undefined)),
        summary: clean(item?.attributes?.description, 600),
      };
    },
    title: ({ server = "psyarxiv" }) => OSF_SERVERS[server.trim().toLowerCase()]?.label.split(" (")[0] ?? `OSF · ${server}`,
  },

  {
    id: "hacker-news",
    name: "Hacker News",
    category: "Tech",
    description: "Stories matching a query, newest first, via the Algolia index.",
    siteUrl: "https://news.ycombinator.com",
    docsUrl: "https://hn.algolia.com/api",
    params: [
      { key: "q", label: "Search", placeholder: "postgres" },
      { key: "points", label: "Minimum points", placeholder: "50 — optional" },
    ],
    request: ({ q = "", points = "" }, { limit }) => {
      const search = new URLSearchParams({
        tags: "story",
        hitsPerPage: String(Math.min(limit, 100)),
      });
      if (q.trim()) search.set("query", q.trim());
      if (/^\d+$/.test(points.trim())) {
        search.set("numericFilters", `points>=${points.trim()}`);
      }
      return { url: `https://hn.algolia.com/api/v1/search_by_date?${search}` };
    },
    items: (body) => body?.hits ?? [],
    article: (item) => {
      const title = pick(item?.title, item?.story_title);
      if (!title || !item?.objectID) return null;
      const discussion = `https://news.ycombinator.com/item?id=${item.objectID}`;
      return {
        id: `hn:${item.objectID}`,
        title,
        // Link to the article when there is one; Ask HN posts have only text.
        link: pick(item.url) ?? discussion,
        author: pick(item.author),
        publishedAt: toIso(item.created_at),
        summary: clean(
          item.story_text ?? item.comment_text ??
            `${item.points ?? 0} points · ${item.num_comments ?? 0} comments`,
        ),
      };
    },
    title: ({ q, points }) =>
      [
        "Hacker News",
        q?.trim() ? `“${q.trim()}”` : null,
        points?.trim() ? `${points.trim()}+ points` : null,
      ]
        .filter(Boolean)
        .join(" · "),
  },

  {
    id: "github-releases",
    name: "GitHub releases",
    category: "Tech",
    description: "Every release of a repository, with its notes.",
    siteUrl: "https://github.com",
    docsUrl: "https://docs.github.com/en/rest/releases/releases",
    envKey: "GITHUB_TOKEN",
    keyOptional: true,
    keyHint: "Optional — a token raises the hourly rate limit from 60 to 5,000.",
    params: [
      { key: "repo", label: "Repository", placeholder: "vercel/next.js", required: true },
    ],
    request: ({ repo = "" }, { limit, key }) => ({
      url: `https://api.github.com/repos/${repo.trim().replace(/^\/+|\/+$/g, "")}/releases?per_page=${Math.min(limit, 100)}`,
      headers: {
        accept: "application/vnd.github+json",
        ...(key ? { authorization: `Bearer ${key}` } : {}),
      },
    }),
    items: (body) => (Array.isArray(body) ? body : []),
    article: (item, { repo = "" }) => {
      const link = pick(item?.html_url);
      if (!link) return null;
      const name = pick(item?.name, item?.tag_name) ?? "Release";
      return {
        id: `github-releases:${item.id ?? link}`,
        title: `${repo.trim()} ${name}`,
        link,
        author: pick(item.author?.login),
        publishedAt: toIso(pick(item.published_at, item.created_at)),
        summary: clean(item.body),
      };
    },
    title: ({ repo }) => `${repo?.trim() ?? "GitHub"} releases`,
  },

  {
    id: "weather-alerts",
    name: "NWS alerts",
    category: "Public safety",
    description: "Active National Weather Service warnings and watches by state.",
    siteUrl: "https://www.weather.gov",
    docsUrl: "https://www.weather.gov/documentation/services-web-api",
    params: [
      {
        key: "area",
        label: "State",
        placeholder: "CA",
        required: true,
        hint: "Two-letter state or marine zone code.",
      },
      {
        key: "severity",
        label: "Severity",
        default: "",
        options: [
          { value: "", label: "Any" },
          { value: "Extreme", label: "Extreme" },
          { value: "Severe", label: "Severe and above" },
        ],
      },
    ],
    request: ({ area = "", severity = "" }, { limit }) => {
      const search = new URLSearchParams({
        area: area.trim().toUpperCase(),
        limit: String(Math.min(limit, 500)),
      });
      if (severity) search.append("severity", severity);
      return {
        url: `https://api.weather.gov/alerts/active?${search}`,
        headers: { accept: "application/geo+json" },
      };
    },
    items: (body) => body?.features ?? [],
    article: (item) => {
      const properties = item?.properties ?? {};
      const title = pick(properties.headline, properties.event);
      const link = pick(properties["@id"], item?.id);
      if (!title || !link) return null;
      return {
        id: `weather-alerts:${pick(properties.id, link)}`,
        title,
        link,
        author: pick(properties.senderName),
        publishedAt: toIso(pick(properties.sent, properties.effective)),
        summary: clean(pick(properties.areaDesc, properties.description)),
      };
    },
    title: ({ area }) => `NWS alerts · ${area?.trim().toUpperCase() ?? ""}`,
  },
];

/** The provider that serves this article's text through its API, if any. */
export function apiReaderFor(url: string): ApiProvider | undefined {
  return API_PROVIDERS.find((provider) => provider.reader?.owns(url));
}

export function getApiProvider(id: string): ApiProvider | undefined {
  return API_PROVIDERS.find((provider) => provider.id === id);
}

/**
 * The credential for a provider. A key supplied by the reader — decrypted in
 * their browser and sent for this request only — wins over the deployment's
 * own, which is shared by everyone who opens this public URL.
 */
export function apiKeyFor(
  provider: ApiProvider,
  supplied?: Record<string, string>,
): string | null {
  if (!provider.envKey) return null;
  const own = supplied?.[provider.id]?.trim();
  if (own) return own;
  return process.env[provider.envKey]?.trim() || null;
}

export function isApiConfigured(
  provider: ApiProvider,
  supplied?: Record<string, string>,
) {
  return (
    !provider.envKey ||
    provider.keyOptional === true ||
    apiKeyFor(provider, supplied) !== null
  );
}

/**
 * API sources are stored as `api:<provider>?<params>`, so a source is still a
 * single string and sync, dedupe and offline storage need no new shape.
 */
export const API_SCHEME = "api:";

export function buildApiSourceUrl(id: string, params: ApiParams) {
  const search = new URLSearchParams();
  // The provider's own field order, so the same source always spells itself
  // the same way — feed URLs are what dedupe and refresh compare on.
  const order = getApiProvider(id)?.params.map((param) => param.key) ?? [];
  const keys = [...new Set([...order, ...Object.keys(params)])];
  for (const key of keys) {
    const value = params[key];
    if (value?.trim()) search.set(key, value.trim());
  }
  const qs = search.toString();
  return `${API_SCHEME}${id}${qs ? `?${qs}` : ""}`;
}

export function parseApiSourceUrl(
  input: string,
): { provider: ApiProvider; params: ApiParams } | null {
  const value = input.trim();
  if (!value.toLowerCase().startsWith(API_SCHEME)) return null;
  const rest = value.slice(API_SCHEME.length);
  const [id, qs = ""] = rest.split("?");
  const provider = getApiProvider(id);
  if (!provider) return null;

  const params: ApiParams = {};
  for (const parameter of provider.params) {
    if (parameter.default) params[parameter.key] = parameter.default;
  }
  for (const [key, value] of new URLSearchParams(qs)) params[key] = value;
  return { provider, params };
}

/** What the catalogue in the UI needs — no functions, no secrets. */
export type ApiCatalogEntry = {
  id: string;
  name: string;
  category: string;
  description: string;
  siteUrl: string;
  docsUrl: string;
  favicon: string;
  params: ApiParam[];
  /** True when this API can be called right now. */
  ready: boolean;
  /** Set when a key is missing or would help. */
  keyNote?: string;
};

export function apiCatalog(): ApiCatalogEntry[] {
  return API_PROVIDERS.map((provider) => {
    const hasKey = apiKeyFor(provider) !== null;
    const keyNote = !provider.envKey
      ? undefined
      : hasKey
        ? undefined
        : `Needs ${provider.envKey}${provider.keyOptional ? " for full rate limits" : ""}. ${provider.keyHint ?? ""}`.trim();
    return {
      id: provider.id,
      name: provider.name,
      category: provider.category,
      description: provider.description,
      siteUrl: provider.siteUrl,
      docsUrl: provider.docsUrl,
      favicon: faviconFor(provider.siteUrl),
      params: provider.params,
      ready: isApiConfigured(provider),
      keyNote,
    };
  });
}

/**
 * Requests to one service, at most this many at once. A refresh reads every
 * source in one request, so a reader following a dozen journals would ask
 * OpenAlex a dozen times in the same instant — and OpenAlex (and Crossref)
 * answer a burst with 429: measured on 11 Oct 2026, the twelfth of a quick
 * run of requests was refused, and the same request answered minutes later.
 */
const PER_HOST = 2;
/**
 * Crossref's anonymous pool says so in every answer: `x-concurrency-limit: 1`,
 * five a second (measured 12 Oct 2026). A second request in flight is refused.
 */
const HOST_LIMITS: Record<string, number> = { "api.crossref.org": 1 };
const active = new Map<string, number>();
const waiting = new Map<string, (() => void)[]>();
async function turn<T>(host: string, run: () => Promise<T>): Promise<T> {
  if ((active.get(host) ?? 0) >= (HOST_LIMITS[host] ?? PER_HOST)) {
    await new Promise<void>((resolve) => waiting.set(host, [...(waiting.get(host) ?? []), resolve]));
  }
  active.set(host, (active.get(host) ?? 0) + 1);
  try {
    return await run();
  } finally {
    active.set(host, (active.get(host) ?? 1) - 1);
    const next = waiting.get(host)?.shift();
    if (next) next();
  }
}

async function fetchJson(request: ApiRequest, timeoutMs = 15000): Promise<any> {
  let host = "";
  try {
    host = new URL(request.url).hostname;
  } catch {
    /* fetch will say */
  }
  for (let attempt = 0; ; attempt++) {
    try {
      return await turn(host, () => fetchJsonOnce(request, timeoutMs));
    } catch (error) {
      // Rate-limited: once more, after the pause the service asked for (or a second).
      if (!(error instanceof RateLimited) || attempt >= 1) throw error;
      await new Promise((resolve) => setTimeout(resolve, Math.min(3000, error.retryAfterMs)));
    }
  }
}

class RateLimited extends Error {
  constructor(readonly retryAfterMs: number) {
    super("The API rate limit was reached. Try again shortly.");
  }
}

async function fetchJsonOnce(request: ApiRequest, timeoutMs: number) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(request.url, {
      headers: { accept: "application/json", ...request.headers },
      redirect: "follow",
      signal: controller.signal,
    });
    if (res.status === 401 || res.status === 403) {
      throw new Error("The API refused the request — check its API key.");
    }
    if (res.status === 429) {
      const after = Number(res.headers?.get?.("retry-after"));
      throw new RateLimited(Number.isFinite(after) && after > 0 ? after * 1000 : 1000);
    }
    if (!res.ok) throw new Error(`API error ${res.status} ${res.statusText}`);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

/**
 * The parts of an issue that are not papers — covers, front and back matter,
 * the masthead — and the placeholder an index lists before a title is known
 * ("Title Pending 12682", OpenAlex for Ergo and Philosophers' Imprint).
 * Measured 12 Oct 2026: Philosophy of Science's newest "paper" was its cover.
 */
export function isFurniture(title: string): boolean {
  return /^(title pending\b|issue information\b|masthead$|editorial board$|(table of )?contents$|(front|back) ?matter$|front cover$|back cover$|cover and (front|back) matter$)/i.test(title.trim())
    || /\bcover and (front|back) matter\b|\b(front|back) ?matter of\b/i.test(title);
}

/**
 * Call one API source and turn its answer into articles. The result has the
 * same shape as a parsed feed, which is what lets the rest of the app treat
 * these like any other source.
 */
export async function fetchApiSource(
  sourceUrl: string,
  limit = 20,
  /** Keys the reader supplied for this request; never stored. */
  supplied?: Record<string, string>,
): Promise<{ meta: SourceMeta; articles: Article[] }> {
  const parsed = parseApiSourceUrl(sourceUrl);
  if (!parsed) throw new Error("Not an API source");
  const { provider, params } = parsed;

  for (const parameter of provider.params) {
    if (parameter.required && !params[parameter.key]?.trim()) {
      throw new Error(`${provider.name} needs ${parameter.label.toLowerCase()}.`);
    }
  }

  const key = apiKeyFor(provider, supplied);
  if (provider.envKey && !key && !provider.keyOptional) {
    throw new Error(
      `${provider.name} needs an API key. Add one in Settings, or set ${provider.envKey} on this deployment.` +
        (provider.keyHint ? ` ${provider.keyHint}` : ""),
    );
  }

  const request = provider.request(params, { limit, key });

  const meta: SourceMeta = {
    feedUrl: buildApiSourceUrl(provider.id, params),
    siteUrl: provider.siteUrl,
    title: provider.title(params),
    description: provider.description,
    favicon: faviconFor(provider.siteUrl),
  };

  if (provider.format === "feed") {
    const { body, finalUrl } = await fetchText(request.url, 15000);
    if (!looksLikeFeed(body)) throw new Error(`${provider.name} returned no results.`);
    const { articles } = parseFeed(body, finalUrl);
    return { meta, articles: sortNewestFirst(articles).slice(0, limit) };
  }

  // Follow the API's own paging until there is enough, rather than showing
  // whatever one page happened to hold.
  const read = async (way: Pick<ApiProvider, "items" | "article">, first: ApiRequest) => {
    const items: any[] = [];
    let pageUrl: string | null = first.url;
    for (let page = 0; pageUrl && page < 4 && (provider.readAllPages || items.length < limit); page += 1) {
      const body = await fetchJson({ ...first, url: pageUrl });
      items.push(...(way.items?.(body) ?? []));
      pageUrl = provider.nextPage?.(body, pageUrl) ?? null;
    }
    return items
      .map((item) => {
        try {
          return way.article?.(item, params) ?? null;
        } catch {
          // One malformed record should not cost the whole source.
          return null;
        }
      })
      .filter((article): article is Article => article !== null);
  };
  const ways: { way: Pick<ApiProvider, "items" | "article">; ask: () => ApiRequest }[] = [
    { way: provider, ask: () => request },
    ...(provider.fallback ? [{ way: provider.fallback, ask: () => provider.fallback!.request(params, { limit, key }) }] : []),
  ];
  if (provider.fallbackFirst?.(params)) ways.reverse();
  let articles: Article[] = [];
  for (const [index, { way, ask }] of ways.entries()) {
    try {
      // An issue's furniture and an index's placeholders are not papers.
      articles = (await read(way, ask())).filter((article) => provider.category !== "Research" || !isFurniture(article.title));
      // Nothing usable is a reason to ask the other way, as an error is.
      if (articles.length > 0) break;
    } catch (error) {
      if (index === ways.length - 1) throw error;
    }
  }
  // One article per link: an API can list the same record twice (a paper and its revision).
  const seen = new Set<string>();
  const once = sortNewestFirst(articles).filter((article) => !seen.has(article.link) && Boolean(seen.add(article.link)));
  return { meta, articles: once.slice(0, limit) };
}
