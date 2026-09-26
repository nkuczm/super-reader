import test from "node:test";
import assert from "node:assert/strict";
import { startSitemapOnlySite } from "./fixtures.mjs";
import { discover } from "../lib/discover";
import { sitemapSource, withinOf, keepWithin } from "../lib/sitemap";
import { GET } from "../app/api/feed/route";

test("a section's path rides in a sitemap source's fragment", () => {
  const source = sitemapSource("https://example.com/sitemap.xml", "/essays");
  assert.equal(source, "https://example.com/sitemap.xml#within=%2Fessays%2F");
  assert.equal(withinOf(source), "/essays/");
  assert.equal(withinOf("https://example.com/sitemap.xml"), null);
  const kept = keepWithin(
    [
      { link: "https://example.com/essays/" },
      { link: "https://example.com/essays/a-real-essay/" },
      { link: "https://example.com/about/" },
    ],
    "/essays/",
  );
  assert.deepEqual(kept.map((a) => a.link), ["https://example.com/essays/a-real-essay/"]);
});

test("a section with no feed is read from the sitemap robots.txt declares", async () => {
  // institute.deepmind.com/essays, measured 26 Sep 2026: no feed, a minified
  // homepage, and a sitemap that lists every essay.
  const site = await startSitemapOnlySite(8795);
  try {
    const result = await discover("http://127.0.0.1:8795/essays", 10);
    assert.equal(result.kind, "feed");
    assert.equal(result.scope, "section");
    assert.equal(result.feedUrl, "http://127.0.0.1:8795/sitemap.xml#within=%2Fessays%2F");
    assert.equal(result.articles.length, 4);
    assert.ok(result.articles.every((a) => a.link.includes("/essays/")));
    // Titles from each page's og:title, not the slug.
    assert.ok(result.articles.some((a) => a.title === "Economic Policy for AGI"));

    // Refresh keeps it the section.
    const res = await GET(new Request(`http://x/api/feed?url=${encodeURIComponent(result.feedUrl)}`));
    const body = await res.json();
    const refreshed = (body.results ?? body)[0] ?? body;
    const articles = refreshed.articles ?? body.articles;
    assert.equal(articles.length, 4);
    assert.ok(articles.some((a: { title: string }) => a.title === "Economic Policy for AGI"));
  } finally {
    site.close();
  }
});
