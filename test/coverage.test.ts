import test from "node:test";
import assert from "node:assert/strict";
import { API_PROVIDERS, fetchApiSource } from "../lib/apis";

/**
 * Does everything a source returns actually reach the list?
 *
 * `fetchApiSource` maps each record with the provider's own `article()`, and
 * a record that function cannot map is dropped — quietly, along with any that
 * throws. That is the right behaviour for one malformed row and a silent
 * disaster for a renamed field: the source empties out, no error is raised
 * anywhere, and the feed simply looks like a quiet day.
 *
 * So each provider gets a recorded response here, and the rule is that every
 * record in it becomes an article. A mapper that starts dropping rows fails
 * this suite rather than going unnoticed until someone wonders where the
 * Federal Register went.
 *
 * These fixtures are shapes, not live data — see the note in apis.test.ts.
 * What they cannot catch is the API itself changing; that needs the live
 * audit, which is a different thing from a test.
 */

const realFetch = globalThis.fetch;

function answerWith(body: unknown, text?: string) {
  globalThis.fetch = (async (input: any) =>
    ({
      ok: true,
      status: 200,
      statusText: "",
      url: String(input),
      json: async () => body,
      text: async () => text ?? JSON.stringify(body),
    }) as any) as typeof fetch;
}

test.afterEach(() => {
  globalThis.fetch = realFetch;
});

type Fixture = {
  /** The source URL, with any required parameters filled in. */
  source: string;
  /** A response shaped the way the provider's API answers. */
  body?: unknown;
  /** For the providers that answer in RSS/Atom rather than JSON. */
  text?: string;
  /** How many records the fixture holds. Every one should come back. */
  records: number;
  /** Credentials the provider insists on before it will call out. */
  env?: Record<string, string>;
};

const FIXTURES: Fixture[] = [
  {
    source: "api:courtlistener?q=immunity",
    records: 2,
    body: {
      results: [
        {
          id: 9001,
          caseName: "Doe v. Roe",
          absolute_url: "/opinion/9001/doe-v-roe/",
          court: "Ninth Circuit",
          dateFiled: "2026-02-03",
          opinions: [{ snippet: "Qualified immunity does not apply." }],
        },
        {
          cluster_id: 9002,
          case_name: "Roe v. Doe",
          docket_absolute_url: "/docket/9002/roe-v-doe/",
          court_id: "ca9",
          date_filed: "2026-02-04",
          text: "On appeal from the district court.",
        },
      ],
    },
  },
  {
    source: "api:federal-register?agency=environmental-protection-agency",
    records: 2,
    body: {
      results: [
        {
          document_number: "2026-0001",
          title: "Rule on emissions",
          html_url: "https://www.federalregister.gov/documents/2026/0001",
          publication_date: "2026-01-05",
          abstract: "A short abstract.",
          agencies: [{ name: "Environmental Protection Agency" }],
        },
        {
          document_number: "2026-0002",
          title: "Notice of hearing",
          html_url: "https://www.federalregister.gov/documents/2026/0002",
          publication_date: "2026-01-06",
          agencies: [{ raw_name: "DEPARTMENT OF ENERGY" }],
        },
      ],
    },
  },
  {
    source: "api:regulations-gov?q=water",
    records: 2,
    env: { REGULATIONS_GOV_API_KEY: "test-key" },
    body: {
      data: [
        {
          id: "EPA-HQ-OW-2026-0001-0001",
          attributes: {
            title: "Proposed rule on water quality",
            agencyId: "EPA",
            postedDate: "2026-03-02T00:00:00Z",
            documentType: "Proposed Rule",
          },
        },
        {
          id: "DOE-HQ-2026-0002-0001",
          attributes: {
            title: "Comment request",
            agencyId: "DOE",
            lastModifiedDate: "2026-03-03",
            subtype: "Notice",
          },
        },
      ],
    },
  },
  {
    source: "api:congress?congress=119",
    records: 2,
    env: { CONGRESS_GOV_API_KEY: "test-key" },
    body: {
      bills: [
        {
          congress: 119,
          type: "HR",
          number: 1234,
          title: "A bill to do a thing",
          originChamber: "House",
          updateDate: "2026-04-01T14:23:45Z",
          latestAction: { text: "Referred to committee." },
        },
        {
          congress: 119,
          type: "S",
          number: 567,
          title: "A Senate bill",
          originChamber: "Senate",
          introducedDate: "2026-04-02",
        },
      ],
    },
  },
  {
    source: "api:sec-edgar?q=artificial intelligence",
    records: 2,
    body: {
      hits: {
        hits: [
          {
            _id: "0001234567-26-000123:doc1.htm",
            _source: {
              ciks: ["0000320193"],
              display_names: ["Apple Inc."],
              root_forms: ["10-K"],
              file_date: "2026-05-01",
              file_description: "Annual report",
            },
          },
          {
            _id: "0007654321-26-000456:doc2.htm",
            _source: {
              ciks: ["0000789019"],
              display_names: ["Microsoft Corp."],
              file_type: "8-K",
              file_date: "2026-05-02",
            },
          },
        ],
      },
    },
  },
  {
    source: "api:clinicaltrials?q=mrna",
    records: 2,
    body: {
      studies: [
        {
          protocolSection: {
            identificationModule: { nctId: "NCT00000001", briefTitle: "A study of something" },
            sponsorCollaboratorsModule: { leadSponsor: { name: "Some University" } },
            statusModule: { lastUpdatePostDateStruct: { date: "2026-06-01" } },
            descriptionModule: { briefSummary: "What the study is about." },
          },
        },
        {
          protocolSection: {
            identificationModule: { nctId: "NCT00000002", officialTitle: "Another study" },
            statusModule: { studyFirstPostDateStruct: { date: "2026-06-02" } },
          },
        },
      ],
    },
  },
  {
    source: "api:openfda?endpoint=drug/enforcement",
    records: 2,
    body: {
      results: [
        {
          recall_number: "D-1234-2026",
          product_description: "Some tablets, 10mg",
          reason_for_recall: "Mislabelled.",
          classification: "Class II",
          recalling_firm: "A Pharma Co",
          report_date: "20260701",
        },
        {
          event_id: "98765",
          product_description: "A device",
          reason_for_recall: "Faulty batch.",
          state: "CA",
          recall_initiation_date: "20260702",
        },
      ],
    },
  },
  {
    source: "api:crossref?q=mrna vaccine",
    records: 2,
    body: {
      message: {
        items: [
          {
            DOI: "10.1000/example1",
            URL: "https://doi.org/10.1000/example1",
            title: ["A paper about something"],
            author: [{ given: "Ada", family: "Lovelace" }],
            created: { "date-time": "2026-08-01T09:00:00Z" },
            abstract: "The abstract.",
          },
          {
            DOI: "10.1000/example2",
            URL: "https://doi.org/10.1000/example2",
            title: ["Another paper"],
            "container-title": ["A Journal"],
            deposited: { "date-time": "2026-08-02T09:00:00Z" },
          },
        ],
      },
    },
  },
  {
    source: "api:hacker-news?q=postgres",
    records: 2,
    body: {
      hits: [
        {
          objectID: "1",
          title: "A link post",
          url: "https://example.com/post",
          author: "someone",
          created_at: "2026-03-01T00:00:00Z",
          points: 120,
        },
        {
          objectID: "2",
          story_title: "Ask HN: anything?",
          author: "someone-else",
          created_at: "2026-03-02T00:00:00Z",
          num_comments: 3,
        },
      ],
    },
  },
  {
    source: "api:github-releases?repo=vercel/next.js",
    records: 2,
    body: [
      {
        id: 7,
        name: "v16.0.0",
        html_url: "https://github.com/vercel/next.js/releases/tag/v16.0.0",
        published_at: "2026-04-01T10:00:00Z",
        author: { login: "someone" },
        body: "Release notes.",
      },
      {
        id: 8,
        tag_name: "v16.0.1",
        html_url: "https://github.com/vercel/next.js/releases/tag/v16.0.1",
        created_at: "2026-04-02T10:00:00Z",
      },
    ],
  },
  {
    source: "api:weather-alerts?area=CA",
    records: 2,
    body: {
      features: [
        {
          id: "https://api.weather.gov/alerts/urn:oid:1",
          properties: {
            "@id": "https://api.weather.gov/alerts/urn:oid:1",
            id: "urn:oid:1",
            headline: "Flood Warning issued",
            senderName: "NWS Sacramento",
            sent: "2026-09-01T12:00:00Z",
            areaDesc: "Sacramento County",
          },
        },
        {
          id: "https://api.weather.gov/alerts/urn:oid:2",
          properties: {
            event: "Red Flag Warning",
            effective: "2026-09-02T12:00:00Z",
            description: "Critical fire weather.",
          },
        },
      ],
    },
  },
  {
    source: "api:arxiv?q=diffusion",
    records: 2,
    text: `<?xml version="1.0"?><feed xmlns="http://www.w3.org/2005/Atom">
      <title>arXiv Query</title>
      <entry><title>A paper about diffusion</title><id>http://arxiv.org/abs/2601.00001v1</id>
      <link rel="alternate" href="http://arxiv.org/abs/2601.00001v1"/>
      <published>2026-01-02T00:00:00Z</published><summary>Abstract text.</summary></entry>
      <entry><title>A second paper</title><id>http://arxiv.org/abs/2601.00002v1</id>
      <link rel="alternate" href="http://arxiv.org/abs/2601.00002v1"/>
      <published>2026-01-03T00:00:00Z</published><summary>More abstract.</summary></entry>
      </feed>`,
  },
];

/** Every provider the catalogue offers needs a fixture, or this is not coverage. */
test("every API provider is covered by a fixture", () => {
  const covered = new Set(
    FIXTURES.map((fixture) => fixture.source.replace(/^api:/, "").split("?")[0]),
  );
  const missing = API_PROVIDERS.map((provider) => provider.id).filter(
    (id) => !covered.has(id),
  );
  assert.deepEqual(missing, [], "these providers have no coverage fixture");
});

for (const fixture of FIXTURES) {
  const id = fixture.source.replace(/^api:/, "").split("?")[0];

  test(`${id}: every record in the response becomes an article`, async () => {
    for (const [key, value] of Object.entries(fixture.env ?? {})) {
      process.env[key] = value;
    }
    answerWith(fixture.body, fixture.text);
    try {
      const { articles } = await fetchApiSource(fixture.source);

      assert.equal(
        articles.length,
        fixture.records,
        `${articles.length} of ${fixture.records} records survived mapping — ` +
          "a field this provider depends on has probably been renamed",
      );

      for (const article of articles) {
        assert.ok(article.id?.trim(), `${id}: every article has an id`);
        assert.ok(article.title?.trim(), `${id}: every article has a title`);
        assert.match(
          article.link ?? "",
          /^https?:\/\//,
          `${id}: every article has an absolute link`,
        );
        assert.ok(
          article.publishedAt && !Number.isNaN(Date.parse(article.publishedAt)),
          `${id}: every article is dated — undated ones sort last and vanish`,
        );
      }

      const ids = articles.map((article) => article.id);
      assert.equal(new Set(ids).size, ids.length, `${id}: ids are distinct`);
    } finally {
      for (const key of Object.keys(fixture.env ?? {})) delete process.env[key];
    }
  });

  test(`${id}: a day's records do not collapse onto one timestamp`, async () => {
    for (const [key, value] of Object.entries(fixture.env ?? {})) {
      process.env[key] = value;
    }
    answerWith(fixture.body, fixture.text);
    try {
      const { articles } = await fetchApiSource(fixture.source);
      const stamps = articles.map((article) => article.publishedAt);
      assert.equal(
        new Set(stamps).size,
        stamps.length,
        `${id}: records dated to different days share a timestamp, so the ` +
          "list cannot order them — this is what midnight-UTC parsing did",
      );
    } finally {
      for (const key of Object.keys(fixture.env ?? {})) delete process.env[key];
    }
  });
}
