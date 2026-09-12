import test from "node:test";
import assert from "node:assert/strict";
import { PGlite } from "@electric-sql/pglite";
import { setSqlForTesting, type Sql } from "../lib/db";
import { enrichArticles } from "../lib/enrich";
import { readEnriched, writeEnriched, ensureEnrichSchema } from "../lib/enrich-cache";
import type { Article } from "../lib/types";

/**
 * Gap-filling is what made a refresh take half a minute: a feed carrying no
 * images sent this off to fetch fifteen article pages, three waves deep, at a
 * nine-second timeout each — and then threw the answers away, so the next
 * refresh did it again.
 *
 * Two things bound it now, and both are covered here: anything looked up
 * before comes from the cache without a request, and what is left runs
 * against a deadline rather than to completion.
 */

let db: PGlite;

test.before(async () => {
  db = new PGlite();
  const sql: Sql = async (strings, ...values) => {
    const text = strings.reduce(
      (acc, part, i) => acc + part + (i < values.length ? `$${i + 1}` : ""),
      "",
    );
    const result = await db.query(text, values as any[]);
    return result.rows as Record<string, any>[];
  };
  setSqlForTesting(sql);
  await ensureEnrichSchema();
});

test.after(async () => {
  setSqlForTesting(null);
  await db.close();
});

const realFetch = globalThis.fetch;

/** Answers every article page with the same metadata, and counts the calls. */
function stubPages(html: string, { delayMs = 0 }: { delayMs?: number } = {}) {
  const asked: string[] = [];
  globalThis.fetch = (async (input: any) => {
    asked.push(String(input));
    if (delayMs > 0) await new Promise((resolve) => setTimeout(resolve, delayMs));
    return {
      ok: true,
      status: 200,
      statusText: "",
      url: String(input),
      text: async () => html,
    } as any;
  }) as typeof fetch;
  return asked;
}

test.afterEach(async () => {
  globalThis.fetch = realFetch;
  await db.query("DELETE FROM enrich_cache");
});

const PAGE = `<html><head>
  <meta property="og:description" content="What the article says.">
  <meta property="og:image" content="https://example.test/hero.jpg">
  <meta property="article:published_time" content="2026-05-05T09:00:00Z">
</head><body></body></html>`;

const bare = (n: number): Article => ({
  id: `a${n}`,
  title: `Article ${n}`,
  link: `https://example.test/a${n}`,
});

test("a gap is filled from the article's own page", async () => {
  const asked = stubPages(PAGE);
  const [filled] = await enrichArticles([bare(1)]);

  assert.equal(asked.length, 1);
  assert.equal(filled.summary, "What the article says.");
  assert.equal(filled.image, "https://example.test/hero.jpg");
  assert.equal(filled.publishedAt, "2026-05-05T09:00:00.000Z");
});

test("the second refresh asks the cache, not the publisher", async () => {
  const first = stubPages(PAGE);
  await enrichArticles([bare(1), bare(2)]);
  assert.equal(first.length, 2, "the first refresh reads both pages");

  const second = stubPages(PAGE);
  const filled = await enrichArticles([bare(1), bare(2)]);
  assert.equal(second.length, 0, "the second reads none of them");
  assert.equal(filled[0].summary, "What the article says.", "and is no worse for it");
  assert.equal(filled[1].image, "https://example.test/hero.jpg");
});

test("a page that gave nothing is remembered too", async () => {
  // The nine-second timeout on a dead link is the expensive case; paying it
  // again every refresh for the same link is the worst thing this can do.
  globalThis.fetch = (async () => {
    throw new Error("connection refused");
  }) as typeof fetch;
  await enrichArticles([bare(1)]);

  const asked = stubPages(PAGE);
  const [again] = await enrichArticles([bare(1)]);
  assert.equal(asked.length, 0, "the dead link is not tried again");
  assert.equal(again.summary, undefined, "and still has nothing to show");
});

test("the same story reached two ways is only looked up once", async () => {
  // Two feeds carrying one story with different tracking parameters. The list
  // already treats those as one article; gap-filling should agree, or the
  // second feed pays for a page the first one just read.
  const first = stubPages(PAGE);
  await enrichArticles([{ ...bare(1), link: "https://example.test/a1?utm_source=rss" }]);
  assert.equal(first.length, 1);

  const second = stubPages(PAGE);
  const [filled] = await enrichArticles([
    { ...bare(1), link: "https://www.example.test/a1?utm_campaign=daily" },
  ]);
  assert.equal(second.length, 0, "the second feed reads nothing");
  assert.equal(filled.summary, "What the article says.");
});

test("an article that needs nothing costs nothing", async () => {
  const asked = stubPages(PAGE);
  const complete: Article = {
    ...bare(1),
    summary: "Already summarised.",
    image: "https://example.test/own.jpg",
  };
  const [same] = await enrichArticles([complete]);

  assert.equal(asked.length, 0, "no page is read");
  assert.equal(same.summary, "Already summarised.");
  assert.equal(same.image, "https://example.test/own.jpg");
});

test("what the feed said wins over what the page says", async () => {
  stubPages(PAGE);
  // Missing an image, so the page is read — but the feed's summary stands.
  const [filled] = await enrichArticles([{ ...bare(1), summary: "The feed's own words." }]);
  assert.equal(filled.summary, "The feed's own words.");
  assert.equal(filled.image, "https://example.test/hero.jpg", "the gap is still filled");
});

test("a site's boilerplate description is not repeated under every headline", async () => {
  stubPages(PAGE);
  const [filled] = await enrichArticles([bare(1)], {
    siteDescription: "What the article says.",
  });
  assert.equal(filled.summary, undefined, "the site's blurb is not this article's");
  assert.equal(filled.image, "https://example.test/hero.jpg");
});

test("the boilerplate check is about the source, not the cached page", async () => {
  // One reader follows the site whose blurb this is; another reaches the same
  // article through an aggregator. The cache is shared, so the filtering has
  // to happen on the way out, per source — not when the page was read.
  stubPages(PAGE);
  await enrichArticles([bare(1)], { siteDescription: "What the article says." });

  const asked = stubPages(PAGE);
  const [elsewhere] = await enrichArticles([bare(1)], { siteDescription: "A different site." });
  assert.equal(asked.length, 0, "served from cache");
  assert.equal(
    elsewhere.summary,
    "What the article says.",
    "and the other source still gets the summary",
  );
});

test("the deadline stops the fan-out rather than waiting it out", async () => {
  // Five at a time against a budget of two waves. Before there was a budget
  // this ran all three waves however long each took — which, at a
  // nine-second timeout per page, is where the half-minute refresh came from.
  const asked = stubPages(PAGE, { delayMs: 400 });
  const articles = Array.from({ length: 15 }, (_, i) => bare(i + 1));

  const started = Date.now();
  const filled = await enrichArticles(articles, {
    budgetMs: 1200,
    perRequestMs: 700,
    concurrency: 5,
  });
  const took = Date.now() - started;

  assert.ok(took < 1200 + 400, `kept to its budget: ${took}ms`);
  assert.equal(asked.length, 10, "it read two waves and stopped");
  assert.equal(filled.length, 15, "every article still comes back");
  assert.ok(
    filled.slice(10).every((article) => article.summary === undefined),
    "the ones it did not reach keep what their feed gave them",
  );
});

test("what the deadline did reach is cached, so the next refresh gets further", async () => {
  const articles = Array.from({ length: 15 }, (_, i) => bare(i + 1));
  stubPages(PAGE, { delayMs: 400 });
  await enrichArticles(articles, { budgetMs: 1200, perRequestMs: 700, concurrency: 5 });

  const cached = await readEnriched(articles.map((a) => a.link));
  assert.equal(cached.size, 10, "the pages it read are remembered");

  // Nothing is spent twice: the second pass only asks for what is left.
  const asked = stubPages(PAGE);
  const filled = await enrichArticles(articles, { budgetMs: 5000, perRequestMs: 700, concurrency: 5 });
  assert.equal(asked.length, 5, "only the five it never reached are read");
  assert.ok(
    filled.every((article) => article.summary === "What the article says."),
    "and across two refreshes the source fills in completely",
  );
});

test("a lookup cut short by the budget is not filed as an empty page", async () => {
  // The trap: a wave that runs out of time records five good articles as
  // having nothing on them, and the short miss TTL then hides them for hours.
  const articles = Array.from({ length: 10 }, (_, i) => bare(i + 1));
  stubPages(PAGE, { delayMs: 400 });
  // Enough for one wave; the second is refused rather than started doomed.
  await enrichArticles(articles, { budgetMs: 900, perRequestMs: 700, concurrency: 5 });

  const cached = await readEnriched(articles.map((a) => a.link));
  assert.equal(cached.size, 5, "only the wave that actually ran is recorded");
  for (const [url, found] of cached) {
    assert.ok(found.summary, `${url} was read properly, not filed as empty`);
  }
});

test("no database means no cache, not a broken refresh", async () => {
  setSqlForTesting(null);
  try {
    const asked = stubPages(PAGE);
    const [filled] = await enrichArticles([bare(1)]);
    assert.equal(asked.length, 1);
    assert.equal(filled.summary, "What the article says.", "gap-filling still works");
  } finally {
    const sql: Sql = async (strings, ...values) => {
      const text = strings.reduce(
        (acc, part, i) => acc + part + (i < values.length ? `$${i + 1}` : ""),
        "",
      );
      return (await db.query(text, values as any[])).rows as Record<string, any>[];
    };
    setSqlForTesting(sql);
  }
});

test("the cache round-trips exactly what it was given", async () => {
  await writeEnriched([
    {
      url: "https://example.test/one",
      found: {
        summary: "A summary.",
        image: "https://example.test/one.jpg",
        publishedAt: "2026-05-05T09:00:00.000Z",
      },
    },
    { url: "https://example.test/two", found: {} },
  ]);

  const found = await readEnriched([
    "https://example.test/one",
    "https://example.test/two",
    "https://example.test/never-seen",
  ]);

  assert.equal(found.size, 2, "a URL never looked up is absent, not empty");
  assert.deepEqual(found.get("https://example.test/one"), {
    summary: "A summary.",
    image: "https://example.test/one.jpg",
    publishedAt: "2026-05-05T09:00:00.000Z",
  });
  assert.deepEqual(
    found.get("https://example.test/two"),
    { summary: undefined, image: undefined, publishedAt: undefined },
    "a page with nothing on it is still a fact worth keeping",
  );
});

test("a re-read page replaces what was stored for it", async () => {
  const url = "https://example.test/one";
  await writeEnriched([{ url, found: { summary: "Before." } }]);
  await writeEnriched([{ url, found: { summary: "After.", image: "https://x.test/i.jpg" } }]);

  const found = await readEnriched([url]);
  assert.equal(found.get(url)?.summary, "After.");
  assert.equal(found.get(url)?.image, "https://x.test/i.jpg");
});

test("a stale miss is retried; a stale hit is not", async () => {
  // A page that gave nothing is worth another look before long. A page whose
  // og:image we already have is not — that does not change after publication.
  await writeEnriched([
    { url: "https://example.test/miss", found: {} },
    { url: "https://example.test/hit", found: { summary: "Still true." } },
  ]);
  await db.query("UPDATE enrich_cache SET fetched_at = now() - interval '7 hours'");

  const found = await readEnriched(["https://example.test/miss", "https://example.test/hit"]);
  assert.equal(found.has("https://example.test/miss"), false, "the miss has aged out");
  assert.equal(found.get("https://example.test/hit")?.summary, "Still true.");
});

test("asking for nothing does not go near the database", async () => {
  assert.equal((await readEnriched([])).size, 0);
  assert.equal(await writeEnriched([]), 0);
});
