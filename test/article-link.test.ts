import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { articleOnPage, articleSectionPath, isPerStoryFeed, looksLikeArticlePath } from "../lib/article-link";
import { discover } from "../lib/discover";

test("an address reads as one story only when it clearly is one", () => {
  for (const url of [
    "https://news.stanford.edu/stories/2026/10/bladder-cancer-urine-test-research",
    "https://www.theverge.com/2026/10/9/24123456/apple-ipad",
    "https://example.com/tech/2026-10-09/chips-shortage-ends",
    "https://blog.example.com/why-we-rebuilt-our-search-from-scratch",
    "https://example.com/world/europe-floods-leave-thousands-homeless-12345678",
  ]) assert.equal(looksLikeArticlePath(url), true, url);
  for (const url of [
    "https://example.com/tech",
    "https://example.com/news/politics",
    "https://example.com/blog",
    "https://example.com/sections/climate-and-energy",
    "https://example.com/",
  ]) assert.equal(looksLikeArticlePath(url), false, url);
});

test("a story's section is the path above it, dates and containers taken off", () => {
  assert.equal(articleSectionPath("https://example.com/tech/2026/10/09/chips-shortage-ends"), "/tech");
  assert.equal(articleSectionPath("https://example.com/news/science/space/moon-landing-delayed"), "/news/science/space");
  assert.equal(articleSectionPath("https://news.stanford.edu/stories/2026/10/bladder-cancer-urine-test-research"), "");
  assert.equal(articleSectionPath("https://www.theverge.com/2026/10/9/24123456/apple-ipad"), "");
  assert.equal(articleSectionPath("https://example.com/p/why-we-rebuilt-search"), "");
  assert.equal(articleSectionPath("https://example.com/why-we-rebuilt-search"), "");
});

test("the page's own markup says whether it is a story", () => {
  const ld = `<script type="application/ld+json">{"@context":"https://schema.org","@type":["NewsArticle"],"headline":"x"}</script><title>Chips &amp; more</title>`;
  assert.deepEqual(articleOnPage(ld, "https://example.com/tech/chips"), { title: "Chips & more", section: undefined });
  const og = `<meta property="og:type" content="article"><meta property="article:published_time" content="2026-10-09"><meta property="og:title" content="A headline"><meta property="article:section" content="Tech">`;
  assert.deepEqual(articleOnPage(og, "https://example.com/tech/x"), { title: "A headline", section: "Tech" });
  // og:type on a section front, with no date and a section-shaped address, is not enough.
  assert.equal(articleOnPage(`<meta property="og:type" content="article"><title>Tech</title>`, "https://example.com/tech"), null);
  assert.equal(articleOnPage(`<script type="application/ld+json">{"@type":"WebPage"}</script>`, "https://example.com/tech"), null);
});

test("a story's comment feed is not the outlet's feed", () => {
  assert.equal(isPerStoryFeed("https://example.com/2026/10/story-slug/feed/", "https://example.com/2026/10/story-slug/"), true);
  assert.equal(isPerStoryFeed("https://example.com/comments/feed/", "https://example.com/2026/10/story-slug/"), true);
  assert.equal(isPerStoryFeed("https://example.com/feed/", "https://example.com/2026/10/story-slug/"), false);
});

/* ---- discovery, against a small local site ---- */

const rss = (title: string, base: string, n = 3) =>
  `<?xml version="1.0"?><rss version="2.0"><channel><title>${title}</title><link>${base}</link>` +
  Array.from({ length: n }, (_, i) => `<item><title>${title} story ${i + 1}</title><link>${base}/item-${i + 1}</link><pubDate>Thu, 0${i + 1} Oct 2026 10:00:00 GMT</pubDate><description>Body ${i + 1}</description></item>`).join("") +
  `</channel></rss>`;
const page = (head: string, body = "") =>
  `<!doctype html><html><head>${head}</head><body><nav><a href="/tech">Tech</a><a href="/about">About</a></nav><article><p>${"Words. ".repeat(80)}</p></article>` +
  `<aside>${Array.from({ length: 8 }, (_, i) => `<a href="/tech/2026/10/0${i}/related-story-number-${i}-here">Related story number ${i} here</a>`).join("")}</aside>${body}</body></html>`;

const PORT = 8794;
const BASE = `http://127.0.0.1:${PORT}`;
let server: http.Server;
/** A site behind a bot check: every path, robots.txt and feeds included, answers 403. */
let walled: http.Server;
const WALLED = 8795;

test.before(async () => {
  server = http.createServer((req, res) => {
    const url = req.url ?? "/";
    const send = (status: number, type: string, body: string) => { res.writeHead(status, { "content-type": type }); res.end(body); };
    if (url === "/rss") return send(200, "application/rss+xml", rss("Example Times", BASE));
    if (url === "/tech/feed") return send(200, "application/rss+xml", rss("Example Times · Tech", `${BASE}/tech`));
    if (url.startsWith("/tech/2026/10/09/chips-shortage-ends")) {
      return send(200, "text/html", page(
        `<title>Chips shortage ends</title><meta property="og:type" content="article"><meta property="article:published_time" content="2026-10-09T10:00:00Z">` +
        `<meta property="og:title" content="Chips shortage ends"><link rel="alternate" type="application/rss+xml" href="${BASE}/tech/2026/10/09/chips-shortage-ends/comments/feed">`,
      ));
    }
    if (url.startsWith("/stories/2026/10/council-approves-rezoning-plan")) {
      return send(200, "text/html", page(`<title>Council approves rezoning</title><script type="application/ld+json">{"@type":"NewsArticle","headline":"Council approves rezoning"}</script>`));
    }
    return send(404, "text/html", "<title>Not found</title>");
  });
  await new Promise<void>((resolve) => server.listen(PORT, "127.0.0.1", resolve));
  walled = http.createServer((_req, res) => {
    res.writeHead(403, { "content-type": "text/html" });
    res.end("<title>Just a moment...</title>");
  });
  await new Promise<void>((resolve) => walled.listen(WALLED, "127.0.0.1", resolve));
});
test.after(() => {
  server.close();
  walled.close();
});

test("a story in a section with a feed gives the section's feed, never a scrape of the story page", async () => {
  const r = await discover(`${BASE}/tech/2026/10/09/chips-shortage-ends`);
  assert.equal(r.kind, "feed");
  assert.equal(r.scope, "section");
  assert.equal(r.feedUrl, `${BASE}/tech/feed`);
  assert.equal(r.title, "Example Times · Tech");
  assert.deepEqual(r.fromArticle, { url: `${BASE}/tech/2026/10/09/chips-shortage-ends`, title: "Chips shortage ends" });
  assert.ok(!r.articles.some((a) => /Related story/.test(a.title)), "the related-stories rail is not the source");
});

test("asking for the whole site from a story gives the outlet's feed", async () => {
  const r = await discover(`${BASE}/tech/2026/10/09/chips-shortage-ends`, 12, "site");
  assert.equal(r.feedUrl, `${BASE}/rss`);
  assert.equal(r.scope, "site");
  assert.ok(r.fromArticle);
});

test("a story filed under a plain container gives the outlet's feed", async () => {
  const r = await discover(`${BASE}/stories/2026/10/council-approves-rezoning-plan`);
  assert.equal(r.feedUrl, `${BASE}/rss`);
  assert.equal(r.scope, "site");
  assert.equal(r.fromArticle?.title, "Council approves rezoning");
});

test("a story on a site that refuses the app says so, rather than scraping anything", async () => {
  await assert.rejects(
    discover(`http://127.0.0.1:${WALLED}/stories/2026/10/bladder-cancer-urine-test-research`),
    /one story.*refused the app's requests \(403\)/,
  );
});
