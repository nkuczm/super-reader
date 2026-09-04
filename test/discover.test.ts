import test from "node:test";
import assert from "node:assert/strict";
import { startFixtures, startNoFeedSite } from "./fixtures.mjs";
import { discover } from "../lib/discover";

const B = "http://127.0.0.1:8781";
// A site with no feed of any kind, on its own origin.
const N = "http://127.0.0.1:8783";
let server: { close: () => void };
let noFeed: { close: () => void };

test.before(async () => {
  server = await startFixtures(8781);
  noFeed = await startNoFeedSite(8783);
});
test.after(() => {
  server.close();
  noFeed.close();
});

test("parses an RSS 2.0 feed", async () => {
  const r = await discover(`${B}/rss`);
  assert.equal(r.title, "Example Blog");
  assert.equal(r.kind, "feed");
  assert.equal(r.articles.length, 3);

  const [first, second] = r.articles;
  assert.equal(first.title, "Hello & welcome", "decodes XML entities");
  assert.equal(first.link, `${B}/posts/1`, "resolves relative links");
  assert.equal(first.author, "Ada", "reads dc:creator");
  assert.ok(first.publishedAt?.startsWith("2025-09-02"));
  assert.equal(first.summary, "First post body.", "strips HTML from content");
  assert.equal(first.image, `${B}/img/a.png`, "pulls image out of content");
  assert.equal(second.image, "http://cdn/x.jpg", "falls back to enclosure");
});

test("decodes numeric HTML entities, including inside URLs", async () => {
  const r = await discover(`${B}/rss`);
  const third = r.articles[2];
  assert.equal(third.title, "Ben\u2019s take on AI & chips", "numeric entities in titles");
  assert.equal(third.summary, "It\u2019s a test \u2014 really\u2026", "entities in summaries");
  assert.equal(
    third.image,
    "http://cdn/i.jpg?w=10&ssl=1",
    "a stray &#038; must not break an image URL",
  );
});

test("parses an Atom feed", async () => {
  const r = await discover(`${B}/atom`);
  assert.equal(r.title, "Atom Site");
  assert.equal(r.articles[0].title, "Atom entry one");
  assert.equal(r.articles[0].author, "Grace");
  assert.equal(r.articles[0].link, `${B}/a/1`);
});

test("finds a feed declared in a page's <head>", async () => {
  const r = await discover(`${B}/declared`);
  assert.equal(r.title, "Example Blog");
  assert.equal(r.articles.length, 3);
});

test("guesses a conventional feed path when none is declared", async () => {
  const r = await discover(`${B}/silent`);
  assert.equal(r.articles.length, 3);
});

test("honors the article limit", async () => {
  const r = await discover(`${B}/rss`, 1);
  assert.equal(r.articles.length, 1);
});

test("reports a clear error when there is no feed", async () => {
  await assert.rejects(
    () => discover("http://127.0.0.1:8782/nothing"),
    /No feed found for that site/,
  );
});

test("builds a feed from a page that has no RSS at all", async () => {
  const r = await discover(`${N}/news`);
  assert.equal(r.kind, "page");
  assert.equal(r.title, "Anthropic", "uses og:site_name");
  assert.equal(r.articles.length, 6, "finds the articles, not the chrome");

  const titles = r.articles.map((a) => a.title);
  assert.deepEqual(titles, [
    "Introducing Claude Opus 5",
    "The Anthropic Economic Index update",
    "Progress on interpretability research",
    "Enterprise frontier safeguards",
    // Date and category must not be glued onto the headline.
    "How Claude\u2019s text watermark works",
    "Our position on open-weights models",
  ]);

  const [first] = r.articles;
  assert.equal(first.link, `${N}/news/claude-opus-5`);
  assert.ok(
    first.publishedAt?.startsWith("2026-09-02"),
    `read the <time> date, got ${first.publishedAt}`,
  );
  assert.equal(first.image, `${N}/img/opus.png`);

  // Nav, footer and legal links must not become articles.
  const links = r.articles.map((a) => a.link).join(" ");
  for (const junk of ["/pricing", "/careers", "/privacy", "/terms", "/legal"]) {
    assert.ok(!links.includes(junk), `${junk} leaked into the feed`);
  }
});

test("dedupes repeated links to the same article", async () => {
  const r = await discover(`${N}/news`);
  const links = r.articles.map((a) => a.link);
  assert.equal(new Set(links).size, links.length);
});

test("refuses a page that is not a list of articles", async () => {
  await assert.rejects(
    () => discover(`${N}/about`),
    /doesn't look like a list of articles|article links could be read/,
  );
});
