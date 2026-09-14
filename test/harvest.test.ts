import test from "node:test";
import assert from "node:assert/strict";
import { augment, sharedPathPrefix } from "../lib/harvest";
import type { Article } from "../lib/types";

const article = (link: string, title = "A headline of a reasonable length"): Article => ({
  id: link,
  link,
  title,
  publishedAt: new Date().toISOString(),
});

test("a section feed reports the beat it covers", () => {
  const beat = [
    article("https://bbc.example/news/technology/a-chip-story-here"),
    article("https://bbc.example/news/technology/b-phone-story-here"),
    article("https://bbc.example/news/technology/c-ai-story-here"),
    article("https://bbc.example/news/technology/d-net-story-here"),
  ];
  assert.equal(sharedPathPrefix(beat), "/news/technology");
});

test("a feed spread across the site constrains nothing", () => {
  const paper = [
    article("https://paper.example/world/a-story-about-things"),
    article("https://paper.example/markets/b-story-about-things"),
    article("https://paper.example/tech/c-story-about-things"),
    article("https://paper.example/opinion/d-story-about-things"),
  ];
  assert.equal(sharedPathPrefix(paper), "/");
});

test("a date is not a section", () => {
  const dated = [
    article("https://paper.example/2026/09/14/a-story-about-things"),
    article("https://paper.example/2026/09/14/b-story-about-things"),
    article("https://paper.example/2026/09/13/c-story-about-things"),
    article("https://paper.example/2026/09/13/d-story-about-things"),
  ];
  assert.equal(sharedPathPrefix(dated), "/");
});

test("too few stories is not enough to infer a beat from", () => {
  const two = [
    article("https://paper.example/tech/a-story-about-things"),
    article("https://paper.example/tech/b-story-about-things"),
  ];
  assert.equal(sharedPathPrefix(two), "/", "two in a folder is a coincidence");
});

/* ---------- augmentation, with the network stubbed ---------- */

const SITEMAP = `<?xml version="1.0"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"
        xmlns:news="http://www.google.com/schemas/sitemap-news/0.9">
  <url><loc>https://paper.example/news/technology/only-in-the-sitemap</loc>
    <news:news><news:title>Only in the sitemap, a real headline</news:title>
    <news:publication_date>${new Date().toISOString()}</news:publication_date></news:news></url>
  <url><loc>https://paper.example/sport/a-match-report-filed-late</loc>
    <news:news><news:title>A match report filed late tonight</news:title>
    <news:publication_date>${new Date().toISOString()}</news:publication_date></news:news></url>
  <url><loc>https://paper.example/news/technology/in-both-places</loc>
    <news:news><news:title>In both places, the fuller headline</news:title>
    <news:publication_date>${new Date().toISOString()}</news:publication_date></news:news></url>
</urlset>`;

function stubFetch(routes: Record<string, string>) {
  const real = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = String(input);
    const body = routes[url];
    if (body === undefined) {
      return new Response("not found", { status: 404, statusText: "Not Found" });
    }
    return new Response(body, { status: 200, headers: { "content-type": "application/xml" } });
  }) as typeof fetch;
  return () => { globalThis.fetch = real; };
}

test("the sitemap fills in what the feed had dropped", async () => {
  const restore = stubFetch({
    "https://paper.example/robots.txt": "Sitemap: https://paper.example/sitemaps/news.xml\n",
    "https://paper.example/sitemaps/news.xml": SITEMAP,
  });
  try {
    const feed = [
      article("https://paper.example/news/technology/in-both-places", "In both places"),
      article("https://paper.example/news/technology/w-from-the-feed-only"),
      article("https://paper.example/news/technology/x-from-the-feed-only"),
      article("https://paper.example/news/technology/y-from-the-feed-only"),
    ];
    const result = await augment(feed, { origin: "https://paper.example" });
    const links = result.articles.map((a) => a.link);

    assert.ok(
      links.includes("https://paper.example/news/technology/only-in-the-sitemap"),
      "the story the feed had already dropped is collected",
    );
    assert.equal(result.added, 1);
    assert.equal(
      links.filter((l) => l.endsWith("in-both-places")).length,
      1,
      "a story in both routes arrives once",
    );
  } finally {
    restore();
  }
});

test("a section source is not widened into the whole paper", async () => {
  const restore = stubFetch({
    "https://paper.example/robots.txt": "Sitemap: https://paper.example/sitemaps/news.xml\n",
    "https://paper.example/sitemaps/news.xml": SITEMAP,
  });
  try {
    const techOnly = [
      article("https://paper.example/news/technology/a-story-about-chips"),
      article("https://paper.example/news/technology/b-story-about-phones"),
      article("https://paper.example/news/technology/c-story-about-models"),
      article("https://paper.example/news/technology/d-story-about-cables"),
    ];
    const result = await augment(techOnly, { origin: "https://paper.example" });
    assert.equal(
      result.articles.some((a) => a.link.includes("/sport/")),
      false,
      "the sports desk does not belong to a technology source",
    );
    assert.ok(result.articles.some((a) => a.link.endsWith("only-in-the-sitemap")));
  } finally {
    restore();
  }
});

test("the richer headline survives the merge", async () => {
  const restore = stubFetch({
    "https://paper.example/robots.txt": "Sitemap: https://paper.example/sitemaps/news.xml\n",
    "https://paper.example/sitemaps/news.xml": SITEMAP,
  });
  try {
    const feed = [
      article("https://paper.example/news/technology/in-both-places", "In both places"),
      article("https://paper.example/news/technology/w-from-the-feed-only"),
      article("https://paper.example/news/technology/x-from-the-feed-only"),
      article("https://paper.example/news/technology/y-from-the-feed-only"),
    ];
    const result = await augment(feed, { origin: "https://paper.example" });
    const both = result.articles.find((a) => a.link.endsWith("in-both-places"));
    assert.equal(both?.title, "In both places, the fuller headline");
  } finally {
    restore();
  }
});

test("a site with no sitemap loses nothing", async () => {
  const restore = stubFetch({});
  try {
    const feed = [article("https://quiet.example/a-post-about-something")];
    const result = await augment(feed, { origin: "https://quiet.example" });
    assert.equal(result.articles.length, 1);
    assert.equal(result.added, 0);
    assert.equal(result.coverage.basis, "every route combined");
  } finally {
    restore();
  }
});

test("a source with no site at all still refreshes", async () => {
  const feed = [article("https://x.example/a-post-about-something")];
  const result = await augment(feed, {});
  assert.equal(result.articles.length, 1);
});

test("a publisher with opaque article paths defeats prefix inference", () => {
  // The BBC files every story at /news/articles/<id>, so its technology feed
  // and its site-wide feed look identical here. This is why scope is recorded
  // when a source is added rather than inferred at refresh time: inferring it
  // filled a BBC Technology source with football.
  const bbcTech = [
    article("https://www.bbc.co.uk/news/articles/c7v48vp31mdo"),
    article("https://www.bbc.co.uk/news/articles/cwyzp47py48o"),
    article("https://www.bbc.co.uk/news/articles/c1kx0gyje9wo"),
    article("https://www.bbc.co.uk/news/articles/cq635037g18o"),
  ];
  assert.equal(
    sharedPathPrefix(bbcTech),
    "/news/articles",
    "the shared path says nothing about which desk this is",
  );
});
