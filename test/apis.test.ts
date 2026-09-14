import test from "node:test";
import assert from "node:assert/strict";
import {
  API_PROVIDERS,
  apiCatalog,
  buildApiSourceUrl,
  fetchApiSource,
  getApiProvider,
  parseApiSourceUrl,
} from "../lib/apis";
import { discover } from "../lib/discover";

/**
 * The APIs are not reachable from the test sandbox — and calling them for real
 * would make the suite depend on other people's uptime and rate limits. Each
 * test stubs fetch, asserts the request that was built, and answers with a
 * recorded shape.
 */
const realFetch = globalThis.fetch;

function stubFetch(body: unknown, options: { text?: string; status?: number } = {}) {
  const calls: { url: string; headers: Record<string, string> }[] = [];
  globalThis.fetch = (async (input: any, init: any) => {
    calls.push({
      url: String(input),
      headers: Object.fromEntries(
        Object.entries((init?.headers ?? {}) as Record<string, string>).map(
          ([key, value]) => [key.toLowerCase(), value],
        ),
      ),
    });
    const status = options.status ?? 200;
    return {
      ok: status >= 200 && status < 300,
      status,
      statusText: "",
      url: String(input),
      json: async () => body,
      text: async () => options.text ?? JSON.stringify(body),
    } as any;
  }) as typeof fetch;
  return calls;
}

test.afterEach(() => {
  globalThis.fetch = realFetch;
});

test("every provider in the directory is well formed", () => {
  const seen = new Set<string>();
  for (const provider of API_PROVIDERS) {
    assert.ok(/^[a-z0-9-]+$/.test(provider.id), `${provider.id} is a usable id`);
    assert.ok(!seen.has(provider.id), `${provider.id} appears once`);
    seen.add(provider.id);

    for (const field of ["name", "category", "description", "siteUrl", "docsUrl"] as const) {
      assert.ok(provider[field]?.trim(), `${provider.id} has a ${field}`);
    }
    assert.ok(provider.params.length > 0, `${provider.id} takes at least one input`);
    for (const param of provider.params) {
      assert.ok(param.key && param.label, `${provider.id} params are labelled`);
    }

    if (provider.format === "feed") continue;
    assert.equal(typeof provider.items, "function", `${provider.id} finds its items`);
    assert.equal(typeof provider.article, "function", `${provider.id} maps an item`);
    // A provider must survive an answer that carries nothing.
    assert.deepEqual(provider.items!({}), [], `${provider.id} handles an empty body`);
  }
});

test("api source urls round-trip, with defaults filled in", () => {
  const url = buildApiSourceUrl("courtlistener", { q: "qualified immunity", court: "ca9" });
  assert.equal(url, "api:courtlistener?q=qualified+immunity&court=ca9");

  const parsed = parseApiSourceUrl(url);
  assert.equal(parsed?.provider.id, "courtlistener");
  assert.equal(parsed?.params.q, "qualified immunity");
  assert.equal(parsed?.params.court, "ca9");
  // Not supplied, so the provider's own default stands.
  assert.equal(parsed?.params.type, "o");

  assert.equal(parseApiSourceUrl("api:not-a-real-api?q=x"), null);
  assert.equal(parseApiSourceUrl("https://example.com/feed"), null);
  assert.equal(parseApiSourceUrl("@OpenAI"), null);
});

test("blank fields are left out of the source url", () => {
  assert.equal(buildApiSourceUrl("hacker-news", { q: "  ", points: "50" }), "api:hacker-news?points=50");
  assert.equal(buildApiSourceUrl("federal-register", {}), "api:federal-register");
});

test("CourtListener: builds the search and maps an opinion", async () => {
  process.env.COURTLISTENER_TOKEN = "test-token";
  const calls = stubFetch({
    results: [
      {
        id: 9001,
        caseName: "Doe v. Roe",
        absolute_url: "/opinion/9001/doe-v-roe/",
        court: "Ninth Circuit",
        dateFiled: "2026-02-03",
        opinions: [{ snippet: "<em>Qualified immunity</em> does not apply." }],
      },
      { caseName: "No link here" },
    ],
  });

  const { meta, articles } = await fetchApiSource("api:courtlistener?q=immunity&court=ca9");

  const [request] = calls;
  assert.match(request.url, /courtlistener\.com\/api\/rest\/v4\/search\//);
  assert.match(request.url, /q=immunity/);
  assert.match(request.url, /court=ca9/);
  assert.equal(request.headers.authorization, "Token test-token");

  assert.equal(meta.feedUrl, "api:courtlistener?q=immunity&type=o&court=ca9");
  assert.match(meta.title, /CourtListener/);
  assert.equal(articles.length, 1, "the record with no link is dropped");
  assert.equal(articles[0].title, "Doe v. Roe");
  assert.equal(
    articles[0].link,
    "https://www.courtlistener.com/opinion/9001/doe-v-roe/",
    "relative API paths become real links",
  );
  assert.equal(articles[0].summary, "Qualified immunity does not apply.", "markup is stripped");
  assert.equal(articles[0].publishedAt, "2026-02-03T00:00:00.000Z");
  delete process.env.COURTLISTENER_TOKEN;
});

test("Federal Register: newest first, with the agency as the byline", async () => {
  const calls = stubFetch({
    results: [
      {
        document_number: "2026-0001",
        title: "Rule on something",
        html_url: "https://www.federalregister.gov/documents/2026/0001",
        publication_date: "2026-01-05",
        abstract: "A short abstract.",
        agencies: [{ name: "Environmental Protection Agency" }],
      },
    ],
  });

  const { articles } = await fetchApiSource("api:federal-register?q=emissions&type=RULE");
  assert.match(calls[0].url, /conditions%5Bterm%5D=emissions/);
  assert.match(calls[0].url, /conditions%5Btype%5D%5B%5D=RULE/);
  assert.equal(articles[0].author, "Environmental Protection Agency");
  assert.equal(articles[0].summary, "A short abstract.");
});

test("Hacker News: prefers the story link and falls back to the discussion", async () => {
  stubFetch({
    hits: [
      { objectID: "1", title: "A link post", url: "https://example.com/post", created_at: "2026-03-01T00:00:00Z" },
      { objectID: "2", title: "Ask HN: anything?", created_at: "2026-03-02T00:00:00Z", points: 12, num_comments: 3 },
    ],
  });

  const { articles } = await fetchApiSource("api:hacker-news?q=postgres&points=50");
  const byTitle = Object.fromEntries(articles.map((a) => [a.title, a.link]));
  assert.equal(byTitle["A link post"], "https://example.com/post");
  assert.equal(byTitle["Ask HN: anything?"], "https://news.ycombinator.com/item?id=2");
  assert.equal(articles[0].title, "Ask HN: anything?", "newest first");
});

test("GitHub releases: numeric filter and repo name in the title", async () => {
  const calls = stubFetch([
    {
      id: 7,
      name: "v16.0.0",
      html_url: "https://github.com/vercel/next.js/releases/tag/v16.0.0",
      published_at: "2026-04-01T10:00:00Z",
      body: "Release notes.",
      author: { login: "someone" },
    },
  ]);

  const { articles } = await fetchApiSource("api:github-releases?repo=vercel/next.js");
  assert.match(calls[0].url, /repos\/vercel\/next\.js\/releases/);
  assert.equal(articles[0].title, "vercel/next.js v16.0.0");
  assert.equal(articles[0].author, "someone");
});

test("arXiv is read with the feed parser, because it answers in Atom", async () => {
  const atom = `<?xml version="1.0"?><feed xmlns="http://www.w3.org/2005/Atom">
    <title>arXiv Query</title>
    <entry><title>A paper about diffusion</title><id>http://arxiv.org/abs/2601.00001v1</id>
    <link rel="alternate" href="http://arxiv.org/abs/2601.00001v1"/>
    <published>2026-01-02T00:00:00Z</published><summary>Abstract text.</summary></entry></feed>`;
  const calls = stubFetch(null, { text: atom });

  const { articles } = await fetchApiSource("api:arxiv?q=diffusion models");
  // A bare phrase is not valid arXiv syntax, so it is scoped for the user.
  assert.match(calls[0].url, /search_query=all%3Adiffusion/);
  assert.equal(articles[0].title, "A paper about diffusion");
});

test("a required field is refused before any request is made", async () => {
  const calls = stubFetch({});
  await assert.rejects(() => fetchApiSource("api:github-releases"), /repository/i);
  assert.equal(calls.length, 0, "nothing was fetched");
});

test("an API that needs a key says so instead of failing obscurely", async () => {
  delete process.env.CONGRESS_GOV_API_KEY;
  const calls = stubFetch({});
  await assert.rejects(
    () => fetchApiSource("api:congress"),
    /CONGRESS_GOV_API_KEY/,
  );
  assert.equal(calls.length, 0);
});

test("an optional key is not required, only reported", () => {
  delete process.env.COURTLISTENER_TOKEN;
  const entry = apiCatalog().find((api) => api.id === "courtlistener");
  assert.equal(entry?.ready, true, "CourtListener still answers without a token");
  assert.match(entry?.keyNote ?? "", /COURTLISTENER_TOKEN/);

  const congress = apiCatalog().find((api) => api.id === "congress");
  assert.equal(congress?.ready, false, "Congress.gov cannot be called without a key");
});

test("the catalogue carries no functions or secrets", () => {
  process.env.COURTLISTENER_TOKEN = "super-secret";
  const json = JSON.stringify(apiCatalog());
  assert.ok(!json.includes("super-secret"), "keys never reach the client");
  assert.ok(json.includes("courtlistener"));
  assert.equal(apiCatalog().length, API_PROVIDERS.length);
  delete process.env.COURTLISTENER_TOKEN;
});

test("a rate-limited API is reported in words the reader can act on", async () => {
  stubFetch({}, { status: 429 });
  await assert.rejects(() => fetchApiSource("api:hacker-news?q=x"), /rate limit/i);
});

test("discover treats an api: source like any other source", async () => {
  stubFetch({
    hits: [
      { objectID: "5", title: "Story", url: "https://example.com/s", created_at: "2026-05-01T00:00:00Z" },
    ],
  });

  const result = await discover("api:hacker-news?q=postgres");
  assert.equal(result.kind, "api");
  assert.equal(result.scope, "site");
  assert.equal(result.feedUrl, "api:hacker-news?q=postgres");
  assert.equal(result.total, 1);
  assert.equal(result.articles[0].title, "Story");
  assert.ok(result.favicon.includes("news.ycombinator.com"));
});

test("providers are looked up by id", () => {
  assert.equal(getApiProvider("federal-register")?.name, "Federal Register");
  assert.equal(getApiProvider("nope"), undefined);
});

test("a reader's own key beats the deployment's", async () => {
  process.env.COURTLISTENER_TOKEN = "the-deployment-key";
  const calls = stubFetch({ results: [] });

  await fetchApiSource("api:courtlistener?q=x", 10, {
    courtlistener: "the-reader-key",
  });
  assert.equal(calls[0].headers.authorization, "Token the-reader-key");

  // With none supplied, the deployment's key is still used.
  const fallback = stubFetch({ results: [] });
  await fetchApiSource("api:courtlistener?q=x", 10, {});
  assert.equal(fallback[0].headers.authorization, "Token the-deployment-key");
  delete process.env.COURTLISTENER_TOKEN;
});

test("a supplied key satisfies an API that has none on the deployment", async () => {
  delete process.env.CONGRESS_GOV_API_KEY;
  const calls = stubFetch({ bills: [] });

  // Without a key this refuses before making a request; with one it proceeds.
  await assert.rejects(() => fetchApiSource("api:congress"), /CONGRESS_GOV_API_KEY/);
  await fetchApiSource("api:congress", 10, { congress: "readers-own" });
  assert.match(calls[0].url, /api_key=readers-own/);
});

test("a key for one API is never sent to another", async () => {
  delete process.env.COURTLISTENER_TOKEN;
  const calls = stubFetch({ hits: [] });
  await fetchApiSource("api:hacker-news?q=x", 10, { courtlistener: "secret" });
  assert.ok(
    !JSON.stringify(calls[0]).includes("secret"),
    "Hacker News takes no key and must not receive one",
  );
});

test("a record's own PDF field is not turned into an attachment", async () => {
  // Every Federal Register document has one, so attaching it put a file chip
  // under every item and made files look like the norm. A file shows up when a
  // publication actually links one, not because a field exists.
  stubFetch({
    results: [
      {
        document_number: "2026-0002",
        title: "Final rule",
        html_url: "https://www.federalregister.gov/documents/2026/0002",
        publication_date: "2026-01-06",
        pdf_url: "https://www.govinfo.gov/content/pkg/FR-2026-01-06/pdf/2026-0002.pdf",
      },
    ],
  });

  const { articles } = await fetchApiSource("api:federal-register?q=rule");
  assert.equal(articles[0].attachments, undefined);
});

test("an API source follows its own paging rather than showing one page", async () => {
  // CourtListener returns 20 per page whatever you ask for, so a source
  // stopped at 20 and looked like it had run out.
  const pages = [
    { results: Array.from({ length: 20 }, (_, i) => opinion(i)), next: "https://cl.test/page2" },
    { results: Array.from({ length: 20 }, (_, i) => opinion(100 + i)), next: null },
  ];
  let call = 0;
  const real = globalThis.fetch;
  const urls: string[] = [];
  globalThis.fetch = (async (input: any) => {
    urls.push(String(input));
    const body = pages[Math.min(call++, pages.length - 1)];
    return { ok: true, status: 200, statusText: "", json: async () => body } as any;
  }) as typeof fetch;

  const { articles } = await fetchApiSource("api:courtlistener?q=x", 40);
  globalThis.fetch = real;

  assert.equal(articles.length, 40, "both pages are used");
  assert.equal(urls.length, 2);
  assert.equal(urls[1], "https://cl.test/page2", "the API's own next link is followed");
});

function opinion(n: number) {
  return {
    id: n,
    caseName: `Case ${n}`,
    absolute_url: `/opinion/${n}/case-${n}/`,
    dateFiled: "2026-02-03",
  };
}

test("a court opinion's preformatted slab is reflowed to wrap", async () => {
  const { reflowPreformatted } = await import("../lib/apis");
  const { OPINION_HTML } = await import("./fixtures.mjs");

  const out = reflowPreformatted(OPINION_HTML as string);

  assert.ok(!/<pre/i.test(out), "the pre wrapper is gone, so the text can wrap");
  assert.match(
    out,
    /<p>UNITED STATES COURT OF APPEALS FOR THE FIFTH CIRCUIT<\/p>/,
    "a caption split across lines becomes one line",
  );
  assert.match(out, /<p>No\. 24-60370<\/p>/, "blank lines still separate blocks");
  assert.match(
    out,
    /The district court denied qualified immunity\. We review that denial de novo/,
    "the court's hard line breaks are joined into flowing prose",
  );
  assert.match(out, /<a href="\/c\/F3d\/1\/1\/">/, "citation links survive");
  assert.ok(!/\n\s+conclude/.test(out), "no leading indentation left mid-sentence");
});

test("markup that is not preformatted is left alone", async () => {
  const { reflowPreformatted } = await import("../lib/apis");
  const html = "<p>Already flowing.</p><p>Two paragraphs.</p>";
  assert.equal(reflowPreformatted(html), html);
});

/**
 * Dates come from when the thing was published, never from when the API's
 * own record of it was created or last touched.
 *
 * Every case below is the shape the live API really returns, with both kinds
 * of field present — because the bug was preferring the wrong one, not
 * missing it. Left alone, a 2020 clinical trial edited this morning arrived
 * dated today and sorted above the day's news.
 */
const provider = (id: string) => {
  const found = API_PROVIDERS.find((entry) => entry.id === id);
  assert.ok(found, `no provider called ${id}`);
  return found;
};

const dateOf = (id: string, item: unknown) =>
  provider(id).article?.(item, {})?.publishedAt;

test("CourtListener dates an opinion when it was filed", () => {
  assert.equal(
    dateOf("courtlistener", {
      id: 9,
      caseName: "United States v. Example",
      absolute_url: "/opinion/9/us-v-example/",
      dateFiled: "1998-04-21",
      dateCreated: "2026-09-14T01:00:00Z",
    }),
    "1998-04-21T00:00:00.000Z",
  );
});

test("ClinicalTrials dates a study when it was first posted", () => {
  assert.equal(
    dateOf("clinicaltrials", {
      protocolSection: {
        identificationModule: { nctId: "NCT04381130", briefTitle: "A Phase I/IIa Study" },
        statusModule: {
          studyFirstPostDateStruct: { date: "2020-05-08" },
          studyFirstSubmitDateStruct: { date: "2020-05-06" },
          lastUpdatePostDateStruct: { date: "2026-09-11" },
        },
      },
    }),
    "2020-05-08T00:00:00.000Z",
  );
});

test("ClinicalTrials asks for the newest registrations, not the newest edits", () => {
  // Otherwise the page it fetches is full of old studies touched today, and
  // dating them honestly just buries them.
  const { url } = provider("clinicaltrials").request(
    { q: "cancer" },
    { limit: 20, key: null },
  );
  assert.match(url, /sort=StudyFirstPostDate/);
});

test("Crossref dates a paper when it was published, not when it was registered", () => {
  assert.equal(
    dateOf("crossref", {
      DOI: "10.4268/cjcmm20110224",
      title: ["Effect of Jinqiaomai"],
      URL: "https://doi.org/10.4268/cjcmm20110224",
      published: { "date-parts": [[2011, 2, 24]] },
      created: { "date-time": "2026-09-05T11:05:08Z" },
      deposited: { "date-time": "2026-09-06T02:00:00Z" },
    }),
    "2011-02-24T00:00:00.000Z",
  );

  // Falls through the other shapes Crossref uses, and copes with a
  // year-only date.
  assert.equal(
    dateOf("crossref", {
      DOI: "10.1/x",
      title: ["Year only"],
      URL: "https://doi.org/10.1/x",
      issued: { "date-parts": [[1999]] },
      created: { "date-time": "2026-01-01T00:00:00Z" },
    }),
    "1999-01-01T00:00:00.000Z",
  );

  // Registration time is the last resort, not the first choice.
  assert.equal(
    dateOf("crossref", {
      DOI: "10.1/y",
      title: ["No publication date"],
      URL: "https://doi.org/10.1/y",
      created: { "date-time": "2026-03-04T05:06:07Z" },
    }),
    "2026-03-04T05:06:07.000Z",
  );
});

test("Congress dates a bill when it was introduced", () => {
  assert.equal(
    dateOf("congress", {
      congress: 119,
      number: "1234",
      type: "hr",
      title: "An Act to do something",
      introducedDate: "2025-03-11",
      updateDate: "2026-09-14",
      latestAction: { actionDate: "2025-06-02" },
    }),
    "2025-03-11T00:00:00.000Z",
  );
});

test("Regulations.gov dates a document when it was posted", () => {
  assert.equal(
    dateOf("regulations-gov", {
      id: "EPA-HQ-OAR-2025-0001-0001",
      attributes: {
        title: "Proposed rule",
        postedDate: "2025-01-15T05:00:00Z",
        lastModifiedDate: "2026-09-14T01:00:00Z",
      },
    }),
    "2025-01-15T05:00:00.000Z",
  );
});

test("openFDA dates a recall when it was reported", () => {
  assert.equal(
    dateOf("openfda", {
      recall_number: "D-1234-2025",
      product_description: "Widget",
      reason_for_recall: "Mislabelled",
      classification: "Class II",
      report_date: "20250310",
      recall_initiation_date: "20250204",
      center_classification_date: "20260914",
    }),
    "2025-03-10T00:00:00.000Z",
  );
});

test("Crossref ignores a publication date that has not happened yet", () => {
  // Real record: this 2011 paper is registered with a print date of 2100,
  // and journals routinely post-date an issue by months. Either way the
  // article would sit at the top of the reader until the date arrived.
  assert.equal(
    dateOf("crossref", {
      DOI: "10.4268/cjcmm20110224",
      title: ["Effect of Jinqiaomai"],
      URL: "https://doi.org/10.4268/cjcmm20110224",
      "published-print": { "date-parts": [[2100, 1, 15]] },
      created: { "date-time": "2011-01-28T07:32:17Z" },
    }),
    "2011-01-28T07:32:17.000Z",
    "falls back to when it was actually registered",
  );

  // A cover date a few months out is skipped the same way.
  const nextYear = new Date().getUTCFullYear() + 1;
  assert.equal(
    dateOf("crossref", {
      DOI: "10.1/future",
      title: ["Post-dated issue"],
      URL: "https://doi.org/10.1/future",
      issued: { "date-parts": [[nextYear, 10, 1]] },
      created: { "date-time": "2026-08-03T12:39:18Z" },
    }),
    "2026-08-03T12:39:18.000Z",
  );

  // Today's publication is not the future, even across a timezone.
  const today = new Date();
  const parts = [today.getUTCFullYear(), today.getUTCMonth() + 1, today.getUTCDate()];
  assert.match(
    dateOf("crossref", {
      DOI: "10.1/today",
      title: ["Published today"],
      URL: "https://doi.org/10.1/today",
      published: { "date-parts": [parts] },
      created: { "date-time": "2020-01-01T00:00:00Z" },
    }) ?? "",
    new RegExp(`^${parts[0]}-`),
  );
});
