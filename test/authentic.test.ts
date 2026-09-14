import test from "node:test";
import assert from "node:assert/strict";
import { judge, keepArticles, titleKey } from "../lib/authentic";

const site = "https://example.com";

test("a dated slug with a real headline is an article", () => {
  const verdict = judge(
    {
      title: "Senate passes the tariff bill after a long night",
      link: "https://example.com/politics/2026/09/14/senate-passes-tariff-bill",
      publishedAt: "2026-09-14T00:00:00Z",
    },
    { origin: site, from: "scrape" },
  );
  assert.ok(verdict.keep, verdict.reasons.join("; "));
});

test("the front page is never a story", () => {
  const verdict = judge({ title: "Example News", link: "https://example.com/" }, { origin: site });
  assert.equal(verdict.keep, false);
  assert.match(verdict.reasons[0], /front page/);
});

test("a tag page is how the site files things", () => {
  const verdict = judge(
    { title: "Climate coverage", link: "https://example.com/tag/climate" },
    { origin: site },
  );
  assert.equal(verdict.keep, false);
  assert.match(verdict.reasons[0], /files things/);
});

test("a dated story under a section word survives", () => {
  // /news/2026/09/14/... has "news" in it and is plainly a story.
  const verdict = judge(
    {
      title: "Flood defences hold through the worst of the storm",
      link: "https://example.com/archive/2026/09/14/flood-defences-hold",
      publishedAt: "2026-09-14T00:00:00Z",
    },
    { origin: site, from: "sitemap" },
  );
  assert.ok(verdict.keep, verdict.reasons.join("; "));
});

test("navigation furniture is refused by its own words", () => {
  for (const title of ["Subscribe", "Sign in", "More", "Advertisement"]) {
    const verdict = judge(
      { title, link: "https://example.com/section/thing-here-now" },
      { origin: site },
    );
    assert.equal(verdict.keep, false, `${title} was kept`);
    assert.match(verdict.reasons[0], /button/);
  }
});

test("a feed item is trusted where a scraped link would not be", () => {
  const thin = { title: "A short one", link: "https://example.com/x-y" };
  assert.equal(judge(thin, { origin: site, from: "scrape" }).keep, false);
  assert.ok(
    judge(thin, { origin: site, from: "feed" }).keep,
    "the publisher put it in their feed, so it is an article",
  );
});

test("an off-site link is doubted but not refused outright", () => {
  const syndicated = {
    title: "Wire copy that ran in both papers today",
    link: "https://otherpaper.com/2026/09/14/wire-copy-that-ran",
    publishedAt: "2026-09-14T00:00:00Z",
  };
  const verdict = judge(syndicated, { origin: site, from: "feed" });
  assert.ok(verdict.keep, "syndication is real");
  assert.match(verdict.reasons.join(" "), /somewhere other than/);
});

test("a subdomain is the same publisher", () => {
  const verdict = judge(
    {
      title: "A long enough headline about something",
      link: "https://www.example.com/2026/09/14/a-long-enough-headline",
    },
    { origin: "https://example.com", from: "sitemap" },
  );
  assert.equal(
    verdict.reasons.some((reason) => /somewhere other than/.test(reason)),
    false,
  );
});

test("the same headline twice is one story", () => {
  const items = [
    { title: "Central bank holds rates steady again", link: "https://example.com/a/central-bank-holds-rates" },
    { title: "Central bank holds rates steady again", link: "https://example.com/b/central-bank-holds-rates-2" },
  ];
  const { kept, dropped } = keepArticles(items, { origin: site, from: "feed" });
  assert.equal(kept.length, 1);
  assert.match(dropped[0].why, /twice/);
});

test("two short headlines that happen to match are left alone", () => {
  // Four words is the floor: "Markets rise" is not evidence of duplication.
  const items = [
    { title: "Markets rise", link: "https://example.com/a/markets-rise-today-story" },
    { title: "Markets rise", link: "https://example.com/b/markets-rise-again-story" },
  ];
  assert.equal(keepArticles(items, { origin: site, from: "feed" }).kept.length, 2);
});

test("what was dropped is reported, not silently discarded", () => {
  const items = [
    { title: "A perfectly ordinary headline about the budget", link: "https://example.com/2026/09/14/budget-headline" },
    { title: "Subscribe", link: "https://example.com/subscribe" },
    { title: "Climate", link: "https://example.com/tag/climate" },
  ];
  const { kept, dropped } = keepArticles(items, { origin: site, from: "scrape" });
  assert.equal(kept.length, 1);
  assert.equal(dropped.length, 2);
  assert.ok(dropped.every((entry) => entry.why.length > 0));
});

test("titles differing only in punctuation share a key", () => {
  assert.equal(
    titleKey("The Fed’s Next Move — Explained"),
    titleKey("The Feds Next Move Explained"),
  );
});
