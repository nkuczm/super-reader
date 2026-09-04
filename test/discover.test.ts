import test from "node:test";
import assert from "node:assert/strict";
import { startFixtures } from "./fixtures.mjs";
import { discover } from "../lib/discover";

const B = "http://127.0.0.1:8781";
let server: { close: () => void };

test.before(async () => {
  server = await startFixtures(8781);
});
test.after(() => server.close());

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
    /No RSS or Atom feed found/,
  );
});
