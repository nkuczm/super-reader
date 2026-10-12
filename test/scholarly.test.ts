import test from "node:test";
import assert from "node:assert/strict";
import {
  arxivCategoryFrom,
  arxivIdFrom,
  directoryForIssn,
  directoryForUrl,
  doiFrom,
  normalIssn,
  osfFrom,
  piiFrom,
  rxivFrom,
  scholarlyRoute,
  wileyJournalFrom,
} from "../lib/scholarly";
import { abstractFrom, buildApiSourceUrl, fetchApiSource, getApiProvider, isFurniture, openAlexArticle, parseApiSourceUrl } from "../lib/apis";
import { OUTLETS, RESEARCH_CATEGORIES, frontOutletForHost } from "../lib/outlets";
import { arxivQuery } from "../lib/arxiv";

/*
 * The links here are the shapes measured on 11 Oct 2026 (docs/COLLECTION.md
 * §2): the addresses papers actually have at each publisher. None of these
 * tests reaches the network — the publishers refuse a server anyway, which
 * is why the link alone has to say where the paper is from.
 */

test("a DOI is found in every shape publishers put one", () => {
  const cases: [string, string | null][] = [
    ["https://doi.org/10.1111/nous.70071", "10.1111/nous.70071"],
    ["https://dx.doi.org/10.1038/nature14539", "10.1038/nature14539"],
    ["doi:10.1093/mind/fzag023", "10.1093/mind/fzag023"],
    ["10.1007/s11098-026-02616-9", "10.1007/s11098-026-02616-9"],
    ["https://onlinelibrary.wiley.com/doi/10.1111/nous.70071?af=R", "10.1111/nous.70071"],
    ["https://onlinelibrary.wiley.com/doi/full/10.1111/phpr.70168", "10.1111/phpr.70168"],
    ["https://www.tandfonline.com/doi/full/10.1080/00048402.2026.2688289?af=R", "10.1080/00048402.2026.2688289"],
    ["https://www.science.org/doi/abs/10.1126/science.adx9628?af=R", "10.1126/science.adx9628"],
    ["https://journals.physiology.org/doi/abs/10.1152/jn.00011.2026", "10.1152/jn.00011.2026"],
    ["https://link.springer.com/article/10.1007/s11098-026-02616-9", "10.1007/s11098-026-02616-9"],
    ["https://journals.plos.org/ploscompbiol/article?id=10.1371/journal.pcbi.1014858", "10.1371/journal.pcbi.1014858"],
    ["https://www.nature.com/articles/s41593-026-02472-0", "10.1038/s41593-026-02472-0"],
    ["https://elifesciences.org/articles/108246", "10.7554/eLife.108246"],
    ["https://www.nytimes.com/2026/10/09/science/brains.html", null],
    ["predictive coding", null],
  ];
  for (const [input, doi] of cases) assert.equal(doiFrom(input), doi, input);
});

test("an Elsevier article is known by its PII, from ScienceDirect or Cell Press", () => {
  assert.equal(piiFrom("https://www.sciencedirect.com/science/article/pii/S0896627326007282?dgcid=rss_sd_all"), "S0896627326007282");
  assert.equal(piiFrom("https://www.cell.com/neuron/fulltext/S0896-6273(26)00728-2?rss=yes"), "S0896627326007282");
  assert.equal(piiFrom("https://www.cell.com/neuron/home"), null);
});

test("arXiv: a paper by its identifier, a category by its listing, feed or name", () => {
  assert.equal(arxivIdFrom("https://arxiv.org/abs/1706.03762"), "1706.03762");
  assert.equal(arxivIdFrom("https://arxiv.org/abs/2610.12426v1"), "2610.12426");
  assert.equal(arxivIdFrom("https://arxiv.org/pdf/2610.12426v2"), "2610.12426");
  assert.equal(arxivIdFrom("arXiv:2610.12426"), "2610.12426");
  assert.equal(arxivIdFrom("https://doi.org/10.48550/arXiv.1706.03762"), "1706.03762");
  assert.equal(arxivIdFrom("https://arxiv.org/list/q-bio.NC/recent"), null);
  assert.equal(arxivCategoryFrom("https://arxiv.org/list/q-bio.NC/recent"), "q-bio.NC");
  assert.equal(arxivCategoryFrom("https://rss.arxiv.org/rss/cs.AI"), "cs.AI");
  assert.equal(arxivCategoryFrom("https://export.arxiv.org/rss/physics.hist-ph"), "physics.hist-ph");
  assert.equal(arxivCategoryFrom("arxiv cs.ai"), "cs.AI");
  assert.equal(arxivCategoryFrom("arXiv q-bio.NC"), "q-bio.NC");
  assert.equal(arxivCategoryFrom("arxiv nonsense"), null);
});

test("bioRxiv and medRxiv: a collection by its subject, a preprint by its DOI (old prefix and new)", () => {
  assert.deepEqual(rxivFrom("https://www.biorxiv.org/collection/neuroscience"), { server: "biorxiv", subject: "neuroscience" });
  assert.deepEqual(rxivFrom("https://www.biorxiv.org/collection/cell-biology"), { server: "biorxiv", subject: "cell_biology" });
  assert.deepEqual(rxivFrom("https://www.biorxiv.org/content/10.1101/2025.10.29.685457v4"), { server: "biorxiv", doi: "10.1101/2025.10.29.685457" });
  assert.deepEqual(rxivFrom("https://www.medrxiv.org/content/10.64898/2026.10.05.26364229v1.full"), { server: "medrxiv", doi: "10.64898/2026.10.05.26364229" });
});

test("a journal's address finds its directory entry, the longest path winning; news is left alone", () => {
  assert.equal(directoryForUrl("https://www.cell.com/neuron/fulltext/S0896-6273(26)00728-2")?.id, "neuron");
  assert.equal(directoryForUrl("https://www.cell.com/cell/fulltext/S0092-8674(26)01071-8")?.id, "cell");
  assert.equal(directoryForUrl("https://www.jneurosci.org/content/46/41/e0619262026")?.id, "jneurosci");
  assert.equal(directoryForUrl("https://academic.oup.com/mind/article/135/540/1/1234")?.id, "mind");
  assert.equal(directoryForUrl("https://academic.oup.com/brain")?.id, "brain");
  assert.equal(directoryForUrl("https://elifesciences.org/subjects/neuroscience")?.id, "elife-neuro");
  assert.equal(directoryForUrl("https://elifesciences.org/articles/108246")?.id, "elife");
  assert.equal(directoryForUrl("https://www.nytimes.com/section/world"), null, "a news section keeps its own way of being found");
  // A bare domain's front outlet is news; the research rung finds journals.
  assert.equal(frontOutletForHost("jneurosci.org"), null);
});

test("ISSNs: any spelling, and a journal by any of its numbers", () => {
  assert.equal(normalIssn("14680068"), "1468-0068");
  assert.equal(normalIssn("ISSN 0022-362x"), "0022-362X");
  assert.equal(normalIssn("12345"), null);
  assert.equal(directoryForIssn(["1468-0068"])?.id, "nous");
  assert.equal(directoryForIssn(["0029-4624"])?.id, "nous");
  assert.equal(directoryForIssn(["1476-4687"])?.id, "nature-news");
  assert.equal(wileyJournalFrom("https://onlinelibrary.wiley.com/journal/14680017"), "1468-0017");
});

test("every research entry in the directory can be followed: a feed, or an API source spelled as the API spells it", () => {
  const research = OUTLETS.filter((o) => RESEARCH_CATEGORIES.includes(o.category));
  assert.ok(research.length >= 190);
  // Every discipline has something in it.
  for (const category of RESEARCH_CATEGORIES) assert.ok(research.some((o) => o.category === category), category);
  for (const outlet of research) {
    assert.ok(!outlet.panel, `${outlet.id} is not a news panel entry`);
    for (const issn of outlet.issn ?? []) assert.equal(normalIssn(issn), issn, `${outlet.id}: ${issn}`);
    if (!outlet.feedUrl.startsWith("api:")) {
      assert.match(outlet.feedUrl, /^https:\/\//, outlet.id);
      continue;
    }
    const parsed = parseApiSourceUrl(outlet.feedUrl);
    assert.ok(parsed, `${outlet.id}: ${outlet.feedUrl}`);
    assert.equal(buildApiSourceUrl(parsed!.provider.id, parsed!.params), outlet.feedUrl, `${outlet.id} is spelled as the API spells it`);
  }
  const ids = OUTLETS.map((o) => o.id);
  assert.equal(new Set(ids).size, ids.length, "ids are unique");
  // No two journals claim the same ISSN.
  const issns = OUTLETS.flatMap((o) => o.issn ?? []);
  assert.equal(new Set(issns).size, issns.length);
});

const lookups = (calls: string[] = []) => ({
  arxiv: async (id: string) => (calls.push(`arxiv ${id}`), { category: "cs.CL", title: "Attention Is All You Need" }),
  rxiv: async (server: string, doi: string) => (calls.push(`rxiv ${server} ${doi}`), { subject: "neuroscience", title: "A preprint" }),
  doi: async (doi: string) => {
    calls.push(`doi ${doi}`);
    if (doi === "10.1016/j.neuron.2026.09.018") return { issns: ["0896-6273"], journal: "Neuron", title: "Stepwise engagement" };
    if (doi === "10.1086/742215") return { issns: ["0014-1704"], journal: "Ethics", title: "Three Balance Models" };
    if (doi === "10.9999/unknown.1") return { issns: ["1234-5679"], journal: "Journal of Things", title: "A paper" };
    return null;
  },
  pii: async (pii: string) => (calls.push(`pii ${pii}`), { issns: ["1053-8119"], journal: "NeuroImage", title: "An imaging paper" }),
});

test("a pasted paper leads to its journal's feed — or its category's, or its collection's — and says which paper", async () => {
  const calls: string[] = [];
  const paper = await scholarlyRoute("https://arxiv.org/abs/1706.03762v7", lookups(calls));
  assert.equal(paper?.title, "arXiv · Computation and Language");
  assert.equal(paper?.feedUrl, buildApiSourceUrl("arxiv", { q: "cat:cs.CL" }));
  assert.equal(paper?.fromArticle?.title, "Attention Is All You Need");

  const listing = await scholarlyRoute("https://arxiv.org/list/q-bio.NC/recent", lookups(calls));
  assert.equal(listing?.title, "arXiv · Neurons and Cognition");

  const neuron = await scholarlyRoute("https://doi.org/10.1016/j.neuron.2026.09.018", lookups(calls));
  assert.equal(neuron?.feedUrl, "https://www.cell.com/neuron/inpress.rss", "a journal in the directory: its own feed");
  assert.equal(neuron?.fromArticle?.title, "Stepwise engagement");

  const sd = await scholarlyRoute("https://www.sciencedirect.com/science/article/pii/S1053811926006038", lookups(calls));
  assert.equal(sd?.title, "NeuroImage");
  assert.match(sd?.feedUrl ?? "", /^api:journal\?issn=1053-8119/);

  const unknown = await scholarlyRoute("https://doi.org/10.9999/unknown.1", lookups(calls));
  assert.equal(unknown?.feedUrl, buildApiSourceUrl("journal", { issn: "1234-5679", name: "Journal of Things" }), "any other journal: by its ISSN");

  const preprint = await scholarlyRoute("https://www.biorxiv.org/content/10.64898/2026.09.28.755022v1", lookups(calls));
  assert.equal(preprint?.title, "bioRxiv · Neuroscience");
  assert.equal(preprint?.feedUrl, "api:rxiv?server=biorxiv&subject=neuroscience");

  const oup = await scholarlyRoute("https://academic.oup.com/mind/article/135/540/1/1234", lookups(calls));
  assert.equal(oup?.title, "Mind", "a walled journal the directory holds needs no lookup at all");

  calls.length = 0;
  assert.equal(await scholarlyRoute("https://www.nytimes.com/2026/10/09/science/brains.html", lookups(calls)), null);
  assert.equal(await scholarlyRoute("predictive coding", lookups(calls)), null);
  assert.deepEqual(calls, [], "news and words are not looked up anywhere");
});

test("OpenAlex: an abstract put back in order, the journal after the authors", () => {
  assert.equal(abstractFrom({ brain: [1], The: [0], predicts: [2] }), "The brain predicts");
  const article = openAlexArticle({
    id: "https://openalex.org/W1",
    display_name: "Estradiol-dependent memory",
    doi: "https://doi.org/10.1523/jneurosci.0619-26.2026",
    publication_date: "2026-10-09",
    authorships: ["A", "B", "C", "D"].map((n) => ({ author: { display_name: n } })),
    primary_location: { source: { display_name: "Journal of Neuroscience" } },
    abstract_inverted_index: { Memory: [0], needs: [1], estradiol: [2] },
  });
  assert.equal(article?.link, "https://doi.org/10.1523/jneurosci.0619-26.2026");
  assert.equal(article?.author, "A, B, C et al. · Journal of Neuroscience");
  assert.equal(article?.publishedAt, "2026-10-09T00:00:00.000Z");
  assert.equal(article?.summary, "Memory needs estradiol");
});

const realFetch = globalThis.fetch;
test.after(() => {
  globalThis.fetch = realFetch;
});

test("a journal's papers come from Crossref when OpenAlex is rate-limited, after one retry", async () => {
  const calls: string[] = [];
  globalThis.fetch = (async (input: any) => {
    const url = String(input);
    calls.push(url.replace(/\?.*/, ""));
    if (url.includes("openalex")) return new Response(JSON.stringify({ error: "Too many" }), { status: 429, headers: { "retry-after": "0.01" } });
    return new Response(JSON.stringify({ message: { items: [{ title: ["Three Balance Models"], URL: "https://doi.org/10.1086/742215", DOI: "10.1086/742215", published: { "date-parts": [[2026, 9, 21]] } }] } }), { status: 200 });
  }) as typeof fetch;
  const { meta, articles } = await fetchApiSource(buildApiSourceUrl("journal", { issn: "0014-1704", name: "Ethics" }), 20);
  assert.equal(meta.title, "Ethics");
  assert.deepEqual(articles.map((a) => a.title), ["Three Balance Models"]);
  assert.deepEqual(calls, ["https://api.openalex.org/works", "https://api.openalex.org/works", "https://api.crossref.org/journals/0014-1704/works"]);
});

test("bioRxiv: first versions only, read from the newest end of the range", async () => {
  const provider = getApiProvider("rxiv")!;
  const url = provider.request({ server: "biorxiv", subject: "neuroscience" }, { limit: 20, key: null }).url;
  assert.match(url, /^https:\/\/api\.biorxiv\.org\/details\/biorxiv\/\d{4}-\d{2}-\d{2}\/\d{4}-\d{2}-\d{2}\/0\?category=neuroscience$/);
  const page = (cursor: number) => ({ messages: [{ cursor, total: 237 }], collection: new Array(30).fill({ version: "1" }) });
  const first = provider.nextPage!(page(0), url)!;
  assert.match(first, /\/207\?category=neuroscience$/, "from the first page, straight to the last");
  assert.match(provider.nextPage!(page(207), first)!, /\/177\?/, "then back towards the first");
  assert.equal(provider.nextPage!(page(27), url.replace("/0?", "/27?")), null, "not back onto the first page");
  assert.deepEqual(provider.items!({ collection: [{ version: "1" }, { version: "2" }, { version: "1" }] }).length, 2);
});

test("a short bioRxiv preview still reaches the newest page, not just the first (oldest) one", async () => {
  globalThis.fetch = (async (input: any) => {
    const cursor = Number(String(input).match(/\/(\d+)\?category/)?.[1]);
    // 90 records, oldest first: record n posted on day n/30 of the range.
    const collection = Array.from({ length: 30 }, (_, i) => {
      const n = cursor + i;
      return { doi: `10.1101/2026.10.0${1 + Math.floor(n / 30)}.${n}`, title: `Preprint ${n}`, version: "1", date: `2026-10-0${1 + Math.floor(n / 30)}`, authors: "A, B" };
    });
    return new Response(JSON.stringify({ messages: [{ cursor, total: 90 }], collection }), { status: 200 });
  }) as typeof fetch;
  const { articles } = await fetchApiSource("api:rxiv?server=biorxiv&subject=neuroscience", 5);
  assert.equal(articles.length, 5);
  assert.ok(articles.every((a) => a.publishedAt?.startsWith("2026-10-03")), "the five newest, from the last page");
});

test("an OpenAlex search leaves out Zenodo deposits, which a date sort brings to the top", () => {
  const provider = getApiProvider("openalex")!;
  const kept = provider.items!({ results: [{ doi: "https://doi.org/10.5281/zenodo.23288943" }, { doi: "https://doi.org/10.1038/s41598-026-70108-1" }, { doi: null }] });
  assert.equal(kept.length, 2);
  assert.throws(() => provider.request({ q: "", area: "" }, { limit: 10, key: null }), /words to look for, or a field/);
  assert.match(provider.request({ q: "predictive coding", area: "neuroscience" }, { limit: 10, key: null }).url, /title_and_abstract\.search:predictive%20coding,primary_topic\.field\.id:28,/);
});

test("a journal OpenAlex dates only by the year is read from Crossref first, newest registered first, dated when it appeared", async () => {
  const calls: string[] = [];
  globalThis.fetch = (async (input: any) => {
    const url = String(input);
    calls.push(url);
    return new Response(JSON.stringify({ message: { items: [
      // Cambridge and the Journal of Philosophy deposit only the year: the registration is the real moment.
      { title: ["How Knowledge Entails Truth"], URL: "https://doi.org/10.5840/jphil1", DOI: "10.5840/jphil1", published: { "date-parts": [[2026]] }, created: { "date-time": "2026-10-09T13:05:09Z" } },
      // A month, and a day online: the day.
      { title: ["Field and Formation"], URL: "https://doi.org/10.1632/x", DOI: "10.1632/x", published: { "date-parts": [[2026, 3]] }, "published-online": { "date-parts": [[2026, 7, 29]] }, created: { "date-time": "2026-07-29T12:22:41Z" } },
      // An old paper registered late keeps its own year.
      { title: ["A 2011 paper"], URL: "https://doi.org/10.5840/old", DOI: "10.5840/old", published: { "date-parts": [[2011]] }, created: { "date-time": "2026-10-01T00:00:00Z" } },
      { title: ["Cover and Front matter"], URL: "https://doi.org/10.5840/cover", DOI: "10.5840/cover", published: { "date-parts": [[2026, 10, 1]] } },
    ] } }), { status: 200 });
  }) as typeof fetch;
  const { articles } = await fetchApiSource("api:journal?issn=0022-362X&name=The+Journal+of+Philosophy&via=crossref", 20);
  assert.equal(calls.length, 1);
  assert.match(calls[0], /^https:\/\/api\.crossref\.org\/journals\/0022-362X\/works\?sort=created&order=desc/);
  assert.deepEqual(articles.map((a) => [a.title, a.publishedAt?.slice(0, 10)]), [
    ["How Knowledge Entails Truth", "2026-10-09"],
    ["Field and Formation", "2026-07-29"],
    ["A 2011 paper", "2011-01-01"],
  ]);
});

test("an empty answer from OpenAlex is a reason to ask Crossref, as an error is", async () => {
  const calls: string[] = [];
  globalThis.fetch = (async (input: any) => {
    const url = String(input);
    calls.push(url.replace(/\?.*/, ""));
    if (url.includes("openalex")) return new Response(JSON.stringify({ results: [{ display_name: "Title Pending 12682", doi: "https://doi.org/10.3998/ergo.1", publication_date: "2026-10-06" }] }), { status: 200 });
    return new Response(JSON.stringify({ message: { items: [{ title: ["A real paper"], URL: "https://doi.org/10.3998/ergo.2", DOI: "10.3998/ergo.2", published: { "date-parts": [[2026, 10, 6]] } }] } }), { status: 200 });
  }) as typeof fetch;
  const { articles } = await fetchApiSource(buildApiSourceUrl("journal", { issn: "2330-4014", name: "Ergo" }), 20);
  assert.deepEqual(articles.map((a) => a.title), ["A real paper"], "a placeholder title is not a paper");
  assert.deepEqual(calls, ["https://api.openalex.org/works", "https://api.crossref.org/journals/2330-4014/works"]);
});

test("an issue's furniture and an index's placeholders are not papers", () => {
  for (const title of ["Title Pending 12682", "PSA volume 93 issue 4 Cover and Front matter", "Issue Information", "Front Matter", "Backmatter of Econometrica Vol. 94 Iss. 5", "Editorial Board", "Masthead"]) {
    assert.ok(isFurniture(title), title);
  }
  for (const title of ["The Matter of Fronts", "Contents of Consciousness", "Issue framing in Congress", "Pending reform"]) {
    assert.ok(!isFurniture(title), title);
  }
});

test("an arXiv archive filed under subcategories is followed as all of them", () => {
  assert.equal(arxivQuery("astro-ph"), "cat:astro-ph.*", "cat:astro-ph alone answered with 2019");
  assert.equal(arxivQuery("cond-mat"), "cat:cond-mat.*");
  assert.equal(arxivQuery("hep-th"), "cat:hep-th", "no subcategories");
  assert.equal(arxivQuery("cs.AI"), "cat:cs.AI");
  assert.equal(OUTLETS.find((o) => o.id === "arxiv-astro-ph")?.feedUrl, "api:arxiv?q=cat%3Aastro-ph.*");
  assert.equal(getApiProvider("arxiv")!.title({ q: "cat:astro-ph.*" }), "arXiv · Astrophysics");
});

test("PsyArXiv, SocArXiv and the other OSF servers: newest published first, first versions only, with authors", () => {
  const provider = getApiProvider("osf")!;
  const url = provider.request({ server: "socarxiv" }, { limit: 20, key: null }).url;
  assert.match(url, /^https:\/\/api\.osf\.io\/v2\/preprints\/\?filter%5Bprovider%5D=socarxiv&filter%5Bis_published%5D=true&sort=-date_published/);
  const body = { data: [
    { id: "2rjm6_v1", attributes: { title: "Evaluating LLMs for Coding Survey Responses", date_published: "2026-10-12T11:29:57.742279", description: "Open-ended questions…", version: 1 },
      links: { html: "https://osf.io/preprints/socarxiv/2rjm6_v1/" },
      embeds: { bibliographic_contributors: { data: [
        { attributes: { unregistered_contributor: null }, embeds: { users: { data: { attributes: { full_name: "Laone Maphane" } } } } },
        { attributes: { unregistered_contributor: "Gabriele Durrant" }, embeds: {} },
      ] } } },
    { id: "old_v3", attributes: { title: "A revision", date_published: "2026-10-12T10:00:00", version: 3 }, links: { html: "https://osf.io/preprints/socarxiv/old_v3/" } },
  ] };
  const items = provider.items!(body);
  assert.equal(items.length, 1, "a third version is a revision, not a new paper");
  const article = provider.article!(items[0], { server: "socarxiv" })!;
  assert.equal(article.link, "https://osf.io/preprints/socarxiv/2rjm6_v1/");
  assert.equal(article.author, "Laone Maphane, Gabriele Durrant");
  assert.equal(article.publishedAt, "2026-10-12T11:29:57.742Z", "OSF's zoneless times are UTC");
  assert.equal(provider.title({ server: "psyarxiv" }), "PsyArXiv");
});

test("a preprint on an OSF server is followed as its server", async () => {
  assert.equal(osfFrom("https://osf.io/preprints/socarxiv/2rjm6_v1/"), "socarxiv");
  assert.equal(osfFrom("https://psyarxiv.com/abcd3"), "psyarxiv");
  assert.equal(osfFrom("https://doi.org/10.31234/osf.io/abcd3"), "psyarxiv");
  assert.equal(osfFrom("10.31235/osf.io/2rjm6_v1"), "socarxiv");
  assert.equal(osfFrom("edarxiv"), "edarxiv");
  assert.equal(osfFrom("https://osf.io/abcd3/"), null, "a project, not a preprint server");
  assert.equal(osfFrom("https://example.com/psyarxiv"), null);
  const route = await scholarlyRoute("https://osf.io/preprints/psyarxiv/hr7gc_v1", lookups());
  assert.equal(route?.feedUrl, "api:osf?server=psyarxiv");
  assert.equal(route?.title, "PsyArXiv");
});
