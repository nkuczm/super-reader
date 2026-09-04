import test from "node:test";
import assert from "node:assert/strict";
import { startSectionSite } from "./fixtures.mjs";
import { discover } from "../lib/discover";

// A section page that advertises the site-wide feed — the blog.google shape.
let withFeed: { close: () => void };
let withoutFeed: { close: () => void };

test.before(async () => {
  withFeed = await startSectionSite(8784, { sectionHasFeed: true });
  withoutFeed = await startSectionSite(8786, { sectionHasFeed: false });
});
test.after(() => {
  withFeed.close();
  withoutFeed.close();
});

test("prefers the section's own feed over the site-wide one", async () => {
  const r = await discover("http://127.0.0.1:8784/topics/gemini");
  assert.equal(r.scope, "section");
  assert.equal(r.title, "Gemini", "not the site-wide feed");
  assert.equal(r.feedUrl, "http://127.0.0.1:8784/topics/gemini/rss");
  assert.ok(
    r.articles.every((a) => a.title.includes("Gemini")),
    "only the section's articles",
  );
});

test("falls back to reading the section page when it has no feed", async () => {
  const r = await discover("http://127.0.0.1:8786/topics/gemini");
  assert.equal(r.scope, "section");
  assert.equal(r.kind, "page", "read the page rather than the site feed");
  assert.equal(r.articles.length, 3);
  assert.ok(r.articles.every((a) => a.link.includes("/topics/gemini/")));
});

test("still offers the whole site when that is what was asked for", async () => {
  const r = await discover("http://127.0.0.1:8784/topics/gemini", 12, "site");
  assert.equal(r.scope, "site");
  assert.equal(r.title, "News from Everywhere");
  assert.ok(
    r.articles.some((a) => a.title.includes("translate")),
    "the site-wide feed's articles",
  );
});

test("a bare domain is unaffected and stays site-wide", async () => {
  const r = await discover("http://127.0.0.1:8784");
  assert.equal(r.scope, "site");
  assert.equal(r.title, "News from Everywhere");
});
