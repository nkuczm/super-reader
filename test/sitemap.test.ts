import test from "node:test";
import assert from "node:assert/strict";
import {
  looksLikeSitemap,
  parseSitemap,
  rankSitemaps,
  titleFromSlug,
} from "../lib/sitemap";

const NEWS = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"
        xmlns:news="http://www.google.com/schemas/sitemap-news/0.9"
        xmlns:image="http://www.google.com/schemas/sitemap-image/1.1">
  <url>
    <loc>https://paper.example/world/2026/sep/14/flood-defences-hold</loc>
    <news:news>
      <news:publication><news:name>The Paper</news:name><news:language>en</news:language></news:publication>
      <news:publication_date>2026-09-14T06:00:00Z</news:publication_date>
      <news:title>Flood defences hold through the worst of the storm</news:title>
    </news:news>
    <image:image><image:loc>https://paper.example/img/flood.jpg</image:loc></image:image>
  </url>
  <url>
    <loc>https://paper.example/markets/2026/sep/14/gold-edges-lower</loc>
    <news:news>
      <news:publication_date>2026-09-14T05:30:00Z</news:publication_date>
      <news:title>Gold edges lower as inflation data lands</news:title>
    </news:news>
  </url>
</urlset>`;

const INDEX = `<?xml version="1.0"?>
<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <sitemap><loc>https://paper.example/sitemaps/video.xml</loc><lastmod>2026-09-10</lastmod></sitemap>
  <sitemap><loc>https://paper.example/sitemaps/news.xml</loc><lastmod>2026-09-14</lastmod></sitemap>
</sitemapindex>`;

const PLAIN = `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url><loc>https://paper.example/about</loc><lastmod>2024-01-01</lastmod></url>
  <url><loc>https://paper.example/2026/09/14/a-real-story-ran-today</loc><lastmod>2026-09-14T09:00:00Z</lastmod></url>
</urlset>`;

test("a news sitemap yields headlines, dates and images", () => {
  const parsed = parseSitemap(NEWS, "https://paper.example/sitemaps/news.xml");
  assert.equal(parsed.kind, "urls");
  if (parsed.kind !== "urls") return;

  assert.equal(parsed.articles.length, 2);
  assert.equal(parsed.withNews, 2, "both entries carried real news metadata");

  const [first] = parsed.articles;
  assert.equal(first.title, "Flood defences hold through the worst of the storm");
  assert.equal(first.link, "https://paper.example/world/2026/sep/14/flood-defences-hold");
  assert.equal(first.publishedAt, new Date("2026-09-14T06:00:00Z").toISOString());
  assert.equal(first.image, "https://paper.example/img/flood.jpg");
});

test("an index is recognised rather than read as stories", () => {
  const parsed = parseSitemap(INDEX, "https://paper.example/sitemap.xml");
  assert.equal(parsed.kind, "index");
  if (parsed.kind !== "index") return;
  assert.equal(parsed.children.length, 2);
  assert.equal(parsed.children[1].lastmod, "2026-09-14");
});

test("a plain sitemap still gives usable entries, dated by lastmod", () => {
  const parsed = parseSitemap(PLAIN, "https://paper.example/sitemap.xml");
  assert.equal(parsed.kind, "urls");
  if (parsed.kind !== "urls") return;
  assert.equal(parsed.withNews, 0, "nothing here claims to be news");
  assert.equal(parsed.articles[1].title, "A real story ran today", "the slug stands in");
  assert.ok(parsed.articles[1].publishedAt);
});

test("the ranking prefers news over video and the reader's own section", () => {
  const urls = [
    "https://bbc.example/sitemaps/https-index-com-mundo-news.xml",
    "https://bbc.example/sitemaps/video.xml",
    "https://bbc.example/sitemaps/news.xml",
    "https://bbc.example/sitemaps/sport-news.xml",
  ];
  const ranked = rankSitemaps(urls, "/sport");
  assert.match(ranked[0], /sport-news/, "the pasted section wins");
  assert.equal(ranked[ranked.length - 1], "https://bbc.example/sitemaps/video.xml");
  assert.ok(
    ranked.indexOf("https://bbc.example/sitemaps/news.xml") <
      ranked.indexOf("https://bbc.example/sitemaps/https-index-com-mundo-news.xml"),
    "an edition nobody asked for ranks below the plain one",
  );
});

test("something that is not a sitemap is not treated as one", () => {
  assert.equal(looksLikeSitemap("<html><body>Not found</body></html>"), false);
  assert.equal(looksLikeSitemap('<rss version="2.0"><channel/></rss>'), false);
  assert.ok(looksLikeSitemap(NEWS));
  assert.ok(looksLikeSitemap(INDEX));
});

test("a slug becomes a readable headline, and an id does not pretend to be one", () => {
  assert.equal(titleFromSlug("https://x.example/a/b/senate-passes-the-bill"), "Senate passes the bill");
  assert.equal(titleFromSlug("https://x.example/story/12345678"), "");
});

test("entities in a headline are decoded", () => {
  const xml = `<urlset xmlns:news="x"><url><loc>https://x.example/a/b-c-d</loc>
    <news:news><news:title>Ford &amp; Co. &#8217;s quarter</news:title></news:news></url></urlset>`;
  const parsed = parseSitemap(xml, "https://x.example/s.xml");
  if (parsed.kind !== "urls") throw new Error("expected urls");
  assert.equal(parsed.articles[0].title, "Ford & Co. ’s quarter");
});
