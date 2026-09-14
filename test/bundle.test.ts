import test from "node:test";
import assert from "node:assert/strict";
import { bundleOf, isBundle, mergeBundled, parseBundle } from "../lib/bundle";
import { knownFeedFor } from "../lib/publishers";
import { canonicalUrl } from "../lib/url";

const DJ = "https://feeds.content.dowjones.io/public/rss/";

test("a bundle carries its feeds and gives them back", () => {
  const feeds = [`${DJ}RSSWorldNews`, `${DJ}RSSMarketsMain`];
  const url = bundleOf(feeds);
  assert.ok(isBundle(url));
  assert.deepEqual(parseBundle(url), feeds);
});

test("an ordinary feed is not a bundle", () => {
  assert.equal(parseBundle("https://example.com/rss"), null);
  assert.equal(isBundle("https://example.com/rss"), false);
  assert.equal(parseBundle("api:courtlistener?q=x"), null);
});

test("a bundle survives feed URLs with queries and separators in them", () => {
  const feeds = ["https://example.com/rss?a=1|2&b=3", "https://example.com/atom"];
  assert.deepEqual(parseBundle(bundleOf(feeds)), feeds);
});

test("the same story from two sections arrives once", () => {
  // A markets piece runs in the business feed too, with its own tracking tag.
  const markets = [
    { link: "https://www.wsj.com/finance/a-story-1234?mod=rss_markets", title: "A story" },
    { link: "https://www.wsj.com/finance/another-5678?mod=rss_markets", title: "Another" },
  ];
  const business = [
    { link: "https://www.wsj.com/finance/a-story-1234?mod=rss_business", title: "A story" },
    { link: "https://www.wsj.com/business/third-9012?mod=rss_business", title: "Third" },
  ];

  const merged = mergeBundled([markets, business], canonicalUrl);
  assert.deepEqual(merged.map((a) => a.title), ["A story", "Another", "Third"]);
});

test("a bundle is capped", () => {
  const many = Array.from({ length: 40 }, (_, i) => ({
    link: `https://example.com/${i}`,
  }));
  assert.equal(mergeBundled([many], canonicalUrl, 10).length, 10);
});

/* ---------- what the WSJ resolves to ---------- */

test("the whole paper is every section, not the world desk", () => {
  // The case reported: latest-headlines is where the newsroom files
  // everything, and it used to resolve to World News under the paper's name.
  const latest = knownFeedFor("https://www.wsj.com/news/latest-headlines?mod=nav_left_section");
  assert.ok(latest);
  assert.equal(latest.title, "The Wall Street Journal");
  assert.equal(latest.scope, "site");

  const feeds = parseBundle(latest.feedUrl);
  assert.ok(feeds, "the whole paper is a bundle of feeds");
  assert.ok(feeds.length >= 8, `expected every section, got ${feeds.length}`);
  for (const section of ["RSSWorldNews", "RSSMarketsMain", "WSJcomUSBusiness", "RSSWSJD", "RSSOpinion"]) {
    assert.ok(
      feeds.some((feed) => feed.endsWith(section)),
      `${section} is missing from the paper`,
    );
  }
});

test("wsj.com and the paper's name mean the same thing", () => {
  const byName = knownFeedFor("WSJ");
  const byHost = knownFeedFor("https://www.wsj.com");
  assert.equal(byName?.feedUrl, byHost?.feedUrl);
  assert.ok(isBundle(byName!.feedUrl));
});

test("a section is still just that section", () => {
  const markets = knownFeedFor("https://www.wsj.com/finance");
  assert.equal(markets?.feedUrl, `${DJ}RSSMarketsMain`);
  assert.equal(markets?.scope, "section");
  assert.equal(markets?.title, "WSJ · Markets");

  // Pasted straight from the feed host, too.
  const direct = knownFeedFor(`${DJ}RSSOpinion`);
  assert.equal(direct?.feedUrl, `${DJ}RSSOpinion`);
  assert.equal(direct?.scope, "section");
});

test("a single WSJ story means the paper it came from", () => {
  const story = knownFeedFor(
    "https://www.wsj.com/articles/some-headline-abc123?mod=hp_lead_pos1",
  );
  assert.ok(isBundle(story!.feedUrl), "a story is not a section, so it is the paper");
});

test("other publishers are left to ordinary discovery", () => {
  assert.equal(knownFeedFor("https://www.nytimes.com"), null);
  assert.equal(knownFeedFor("abliteration.ai/blog"), null);
});
