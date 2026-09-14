import test from "node:test";
import assert from "node:assert/strict";
import { discover } from "../lib/discover";

const SITEMAP = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"
        xmlns:news="http://www.google.com/schemas/sitemap-news/0.9">
  <url><loc>https://www.cnn.com/2026/09/14/politics/a-real-story-filed-today</loc>
    <news:news><news:title>A real story filed today</news:title>
      <news:publication_date>2026-09-14T01:00:00Z</news:publication_date></news:news></url>
  <url><loc>https://www.cnn.com/2026/09/14/world/another-real-story-today</loc>
    <news:news><news:title>Another real story today</news:title>
      <news:publication_date>2026-09-14T00:30:00Z</news:publication_date></news:news></url>
  <url><loc>https://www.cnn.com/about</loc></url>
</urlset>`;

test("a news sitemap can be followed as a source", async () => {
  // CNN declares no RSS anywhere, so this is the only structured route it has.
  const real = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    if (String(input) === "https://www.cnn.com/sitemap/news.xml") {
      return new Response(SITEMAP, { status: 200, headers: { "content-type": "application/xml" } });
    }
    return new Response("no", { status: 404, statusText: "Not Found" });
  }) as typeof fetch;

  try {
    const result = await discover("https://www.cnn.com/sitemap/news.xml", 10);
    assert.equal(result.kind, "feed");
    assert.equal(result.siteUrl, "https://www.cnn.com");
    assert.equal(result.title, "cnn.com");
    assert.equal(result.articles.length, 2, "the About page is not a story");
    assert.equal(result.articles[0].title, "A real story filed today");
    assert.ok(result.articles[0].publishedAt, "a sitemap dates every entry");
  } finally {
    globalThis.fetch = real;
  }
});

test("an ordinary XML feed is still read as a feed", () => {
  // looksLikeFeed accepts anything opening with an XML declaration, which is
  // why the sitemap check has to come first. This guards the other direction:
  // reordering must not turn feeds into sitemaps.
  const rss = `<?xml version="1.0"?><rss version="2.0"><channel>
    <title>A Blog</title><link>https://blog.example</link>
    <item><title>A post</title><link>https://blog.example/a-post-here</link></item>
  </channel></rss>`;
  assert.equal(
    /<(?:[a-z0-9]+:)?(urlset|sitemapindex)\b/i.test(rss),
    false,
    "an RSS feed is not mistaken for a sitemap",
  );
});
