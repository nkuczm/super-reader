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
