import test from "node:test";
import assert from "node:assert/strict";
import { startSitemapSite } from "./fixtures.mjs";
import { discover } from "../lib/discover";
import {
  parseSitemap,
  sitemapsInRobots,
  articlesFromSitemap,
  scoreSitemapUrl,
  titleFromSlug,
  sitemapSource,
} from "../lib/sitemap";

/**
 * The site here publishes no feed and renders its newsroom in the browser, so
 * there is nothing for feed discovery to find and nothing for the scraper to
 * group. It is the shape a great many government publishers have, and the
 * sitemap they announce in robots.txt is the way in.
 */
const S = "http://127.0.0.1:8794";
let site: { close: () => void };

test.before(async () => {
  site = await startSitemapSite(8794);
});
test.after(() => site.close());

test("a site with no feed and no server-rendered list is followed by its sitemap", async () => {
  const result = await discover(S, 10);

  assert.equal(result.kind, "sitemap");
  assert.equal(result.feedUrl, `${S}/news-sitemap.xml`, "the news sitemap, not the site-wide one");
  assert.equal(result.articles.length, 3);
  // Newest first, and the home page is not an article.
  assert.equal(result.articles[0].title, "Bridge inspection report published");
  assert.ok(
    !result.articles.some((article) => article.link === `${S}/`),
    "the site's own front page is not one of its stories",
  );
  assert.ok(result.articles.every((article) => article.publishedAt));
});

test("a news sitemap is preferred over the index's other children", () => {
  assert.ok(
    scoreSitemapUrl("https://x.gov/news-sitemap.xml") >
      scoreSitemapUrl("https://x.gov/sitemap-pages.xml"),
  );
  assert.ok(
    scoreSitemapUrl("https://x.gov/sitemap-images.xml") < 0,
    "an image sitemap is not a list of articles",
  );
  assert.ok(
    scoreSitemapUrl("https://x.gov/sitemap-press.xml", "/press") >
      scoreSitemapUrl("https://x.gov/sitemap-blog.xml", "/press"),
    "the section that was pasted is what was asked for",
  );
});

test("a plain sitemap still builds a feed, with headlines read from the pages", async () => {
  const found = await sitemapSource(S, { sectionPath: "/notices", limit: 10 });

  assert.ok(found, "the section's entries live in the plain sitemap");
  assert.equal(found!.headlines, false, "a plain sitemap carries no headlines");
  assert.deepEqual(
    found!.articles.map((article) => article.link),
    [`${S}/notices/dredging-consultation-2026`, `${S}/notices/quay-closure-notice`],
    "newest first, and the undated entry is dropped rather than placed at random",
  );
});

test("sitemaps are read out of robots.txt, where a site advertises them", () => {
  const found = sitemapsInRobots(
    "User-agent: *\nDisallow: /x\n\nSitemap: /a.xml\nsitemap:  https://e.gov/b.xml\n",
    "https://e.gov/robots.txt",
  );
  assert.deepEqual(found, ["https://e.gov/a.xml", "https://e.gov/b.xml"]);
});

test("both kinds of sitemap document parse, namespaced or not", () => {
  const index = parseSitemap(
    `<?xml version="1.0"?><sitemapindex><sitemap><loc>/a.xml</loc>
     <lastmod>2026-09-01</lastmod></sitemap></sitemapindex>`,
    "https://e.gov/sitemap.xml",
  );
  assert.equal(index.kind, "index");
  assert.deepEqual(index.kind === "index" && index.sitemaps[0], {
    loc: "https://e.gov/a.xml",
    lastmod: "2026-09-01",
  });

  const urlset = parseSitemap(
    `<urlset xmlns:news="http://www.google.com/schemas/sitemap-news/0.9">
      <url><loc>https://e.gov/news/a-story-here</loc>
        <news:news><news:title><![CDATA[A story &amp; more]]></news:title>
          <news:publication_date>2026-09-10T09:00:00Z</news:publication_date></news:news>
      </url></urlset>`,
    "https://e.gov/",
  );
  assert.equal(urlset.kind, "urlset");
  assert.equal(urlset.kind === "urlset" && urlset.entries[0].title, "A story & more");
});

test("section pages and undated entries are not articles", () => {
  const articles = articlesFromSitemap([
    { loc: "https://e.gov/", lastmod: "2026-09-10" },
    { loc: "https://e.gov/news", lastmod: "2026-09-10" },
    { loc: "https://e.gov/news/a-real-story", lastmod: "2026-09-10" },
    { loc: "https://e.gov/news/no-date-here" },
  ]);

  assert.deepEqual(
    articles.map((article) => article.link),
    ["https://e.gov/news/a-real-story"],
  );
});

test("a slug stands in for a headline until the page is read", () => {
  assert.equal(
    titleFromSlug("https://e.gov/news/harbour-works-approved-by-council"),
    "Harbour works approved by council",
  );
  assert.equal(titleFromSlug("https://e.gov/news/2026091234-quay-closure"), "Quay closure");
  assert.equal(titleFromSlug("https://e.gov/news/notice.html"), "Notice");
  assert.equal(titleFromSlug("not a url"), "");
});
