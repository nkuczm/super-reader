import test from "node:test";
import assert from "node:assert/strict";
import { coverageOf, inWindow, referenceOf } from "../lib/coverage";
import { combine } from "../lib/harvest";

const NOW = Date.parse("2026-09-14T12:00:00Z");
const HOUR = 3600_000;

const at = (hoursAgo: number, id = `s${hoursAgo}`) => ({
  link: `https://paper.example/2026/09/14/${id}`,
  publishedAt: new Date(NOW - hoursAgo * HOUR).toISOString(),
});

test("the window is what counts, not the pile", () => {
  const articles = [at(1), at(10), at(100), at(1000)];
  assert.equal(inWindow(articles, 48, NOW).length, 2);
});

test("an undated item sits out of the measurement rather than inflating it", () => {
  const undated = { link: "https://paper.example/a/undated-piece" };
  assert.equal(inWindow([undated, at(1)], 48, NOW).length, 1);
});

test("a story dated in the future is not counted as coverage", () => {
  const ahead = {
    link: "https://paper.example/a/embargoed",
    publishedAt: new Date(NOW + 48 * HOUR).toISOString(),
  };
  assert.equal(inWindow([ahead], 48, NOW).length, 0);
});

test("a full news sitemap is treated as the truth about the window", () => {
  const sitemap = Array.from({ length: 40 }, (_, i) => at(i, `sm${i}`));
  const found = sitemap.slice(0, 20);
  const reference = referenceOf(sitemap, found, 48, NOW);
  assert.equal(reference.basis, "news sitemap");
  assert.equal(reference.count, 40);
});

test("a thin sitemap does not get to define the window", () => {
  // The Verge case: 17 in the sitemap, far more in the feed. Believing the
  // sitemap there would score the feed at over 100% and hide real losses.
  const sitemap = Array.from({ length: 5 }, (_, i) => at(i, `sm${i}`));
  const everything = Array.from({ length: 40 }, (_, i) => at(i, `all${i}`));
  const reference = referenceOf(sitemap, everything, 48, NOW);
  assert.equal(reference.basis, "every route combined");
  assert.equal(reference.count, 40);
});

test("recall is the fraction of the window caught, not the count returned", () => {
  const published = Array.from({ length: 20 }, (_, i) => at(i, `p${i}`));

  // One route returns a huge pile, nearly all of it older than the window.
  const archive = [...published.slice(0, 2), ...Array.from({ length: 300 }, (_, i) => at(500 + i, `old${i}`))];
  // The other returns a modest number, all of it current.
  const current = published.slice(0, 16);

  const report = coverageOf([...archive, ...current], { archive, current }, {
    hours: 48,
    now: NOW,
    sitemap: published,
  });

  const byName = Object.fromEntries(report.byRoute.map((r) => [r.route, r]));
  assert.ok(
    byName.current.recall > byName.archive.recall,
    `the smaller, current route covers more: ${byName.current.recall} vs ${byName.archive.recall}`,
  );
  assert.equal(byName.archive.caught, 2, "300 old articles count for nothing here");
  assert.equal(report.published, 20);
});

test("a route that finds nothing others miss is reported as duplicating work", () => {
  const published = Array.from({ length: 10 }, (_, i) => at(i, `p${i}`));
  const report = coverageOf(published, { feed: published, mirror: published }, {
    hours: 48,
    now: NOW,
    sitemap: published,
  });
  for (const route of report.byRoute) {
    assert.equal(route.only, 0, `${route.route} should be contributing nothing unique`);
    assert.equal(route.recall, 1);
  }
});

test("a route earns its keep by what only it caught", () => {
  const shared = Array.from({ length: 8 }, (_, i) => at(i, `p${i}`));
  const extra = [at(3, "only-here"), at(4, "also-only-here")];
  const report = coverageOf([...shared, ...extra], { feed: shared, sitemap: [...shared, ...extra] }, {
    hours: 48,
    now: NOW,
    sitemap: [...shared, ...extra],
  });
  const sitemapRoute = report.byRoute.find((r) => r.route === "sitemap")!;
  assert.equal(sitemapRoute.only, 2);
  assert.equal(report.recall, 1, "together they caught the whole window");
});

test("stories lost between collection and the final list are counted", () => {
  const published = Array.from({ length: 10 }, (_, i) => at(i, `p${i}`));
  // The final list is missing two that a route did find — a filter ate them.
  const report = coverageOf(published.slice(0, 8), { feed: published }, {
    hours: 48,
    now: NOW,
    sitemap: published,
  });
  assert.equal(report.lostToFiltering, 2);
  assert.equal(report.recall, 0.8);
});

test("nothing published in the window is reported honestly, not as perfect", () => {
  const report = coverageOf([], {}, { hours: 48, now: NOW });
  assert.equal(report.published, 0);
  assert.equal(report.recall, 0);
});

/* ---------- merging records of the same story ---------- */

test("the union of two thin records is a whole one", () => {
  const fromSitemap = {
    id: "a",
    link: "https://paper.example/a/story",
    title: "The full headline as the desk wrote it",
    publishedAt: "2026-09-14T08:00:00Z",
  };
  const fromFeed = {
    id: "b",
    link: "https://paper.example/a/story",
    title: "The full headline",
    summary: "Several sentences of real prose about the story.",
    image: "https://paper.example/i.jpg",
  };
  const merged = combine(fromSitemap, fromFeed);
  assert.equal(merged.title, "The full headline as the desk wrote it", "the fuller headline wins");
  assert.equal(merged.summary, "Several sentences of real prose about the story.");
  assert.equal(merged.image, "https://paper.example/i.jpg");
  assert.equal(merged.publishedAt, "2026-09-14T08:00:00Z", "the date survives the record without one");
});

test("an empty field never overwrites a real one", () => {
  const good = { id: "a", link: "https://x.example/a", title: "A real headline here", summary: "Real." };
  const empty = { id: "b", link: "https://x.example/a", title: "" };
  assert.equal(combine(good, empty).title, "A real headline here");
  assert.equal(combine(empty, good).title, "A real headline here");
});

test("the earliest publication date wins over a later touch", () => {
  // Sitemaps report lastmod, which moves every time a story is edited.
  const first = { id: "a", link: "https://x.example/a", title: "T", publishedAt: "2026-09-14T06:00:00Z" };
  const touched = { id: "a", link: "https://x.example/a", title: "T", publishedAt: "2026-09-14T11:00:00Z" };
  assert.equal(combine(touched, first).publishedAt, "2026-09-14T06:00:00Z");
  assert.equal(combine(first, touched).publishedAt, "2026-09-14T06:00:00Z");
});
