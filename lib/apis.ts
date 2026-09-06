import { stripHtml, toIso, faviconFor, fetchText, parseFeed, looksLikeFeed } from "./feed";
import { sortNewestFirst } from "./sort";
import type { Article, SourceMeta } from "./types";

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
  /** The name this source gets, given what the user asked for. */
  title: (params: ApiParams) => string;
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
function fromCompactDate(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const match = value.match(/^(\d{4})(\d{2})(\d{2})$/);
  return match ? `${match[1]}-${match[2]}-${match[3]}T00:00:00Z` : toIso(value);
}

const query = (value: string) => encodeURIComponent(value.trim());

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
          pick(item.dateFiled, item.date_filed, item.dateArgued, item.dateCreated),
        ),
        summary: clean(snippet),
      };
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
        publishedAt: toIso(pick(attributes.postedDate, attributes.lastModifiedDate)),
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
        publishedAt: toIso(pick(item.updateDate, item.introducedDate)),
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
    description: "Registered studies, newest updates first.",
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
        sort: "LastUpdatePostDate:desc",
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
          pick(
            section.statusModule?.lastUpdatePostDateStruct?.date,
            section.statusModule?.studyFirstPostDateStruct?.date,
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
          pick(item.report_date, item.recall_initiation_date, item.center_classification_date),
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
    title: ({ q }) => `arXiv · ${q?.trim() ?? "recent"}`,
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
    article: (item) => {
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
        publishedAt: toIso(pick(item.created?.["date-time"], item.deposited?.["date-time"])),
        summary: clean(item.abstract),
      };
    },
    title: ({ q }) => `Crossref · “${q?.trim() ?? ""}”`,
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

export function getApiProvider(id: string): ApiProvider | undefined {
  return API_PROVIDERS.find((provider) => provider.id === id);
}

/** The credential for a provider, read at call time so tests can set it. */
export function apiKeyFor(provider: ApiProvider): string | null {
  if (!provider.envKey) return null;
  return process.env[provider.envKey]?.trim() || null;
}

export function isApiConfigured(provider: ApiProvider) {
  return !provider.envKey || provider.keyOptional === true || apiKeyFor(provider) !== null;
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

async function fetchJson(request: ApiRequest, timeoutMs = 15000) {
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
      throw new Error("The API rate limit was reached. Try again shortly.");
    }
    if (!res.ok) throw new Error(`API error ${res.status} ${res.statusText}`);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Call one API source and turn its answer into articles. The result has the
 * same shape as a parsed feed, which is what lets the rest of the app treat
 * these like any other source.
 */
export async function fetchApiSource(
  sourceUrl: string,
  limit = 20,
): Promise<{ meta: SourceMeta; articles: Article[] }> {
  const parsed = parseApiSourceUrl(sourceUrl);
  if (!parsed) throw new Error("Not an API source");
  const { provider, params } = parsed;

  for (const parameter of provider.params) {
    if (parameter.required && !params[parameter.key]?.trim()) {
      throw new Error(`${provider.name} needs ${parameter.label.toLowerCase()}.`);
    }
  }

  const key = apiKeyFor(provider);
  if (provider.envKey && !key && !provider.keyOptional) {
    throw new Error(
      `${provider.name} needs an API key. Add ${provider.envKey} to this deployment.` +
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

  const body = await fetchJson(request);
  const items = provider.items?.(body) ?? [];
  const articles = items
    .map((item) => {
      try {
        return provider.article?.(item, params) ?? null;
      } catch {
        // One malformed record should not cost the whole source.
        return null;
      }
    })
    .filter((article): article is Article => article !== null);

  return { meta, articles: sortNewestFirst(articles).slice(0, limit) };
}
