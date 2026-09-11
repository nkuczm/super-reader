import test from "node:test";
import assert from "node:assert/strict";
import { knownFeedFor, WSJ_CHOICES } from "../lib/publishers";
import { OUTLETS, SUBREDDITS, PACKS } from "../lib/outlets";

test("recognises the WSJ however it is asked for", () => {
  for (const input of [
    "wsj",
    "WSJ",
    "wsj.com",
    "Wall Street Journal",
    "the wall street journal",
    "wall st journal",
    "https://www.wsj.com",
    "https://www.wsj.com/",
  ]) {
    const known = knownFeedFor(input);
    assert.ok(known, `should recognise ${input}`);
    assert.equal(known.title, "The Wall Street Journal");
    assert.equal(known.scope, "site");
    assert.equal(known.siteUrl, "https://www.wsj.com");
  }
});

test("maps a WSJ section to that section's feed", () => {
  const cases: [string, string][] = [
    ["https://www.wsj.com/tech", "RSSWSJD"],
    ["https://www.wsj.com/technology/ai", "RSSWSJD"],
    ["https://www.wsj.com/news/markets", "RSSMarketsMain"],
    ["https://www.wsj.com/finance", "RSSMarketsMain"],
    ["wsj.com/opinion", "RSSOpinion"],
    ["https://www.wsj.com/us-news", "RSSUSnews"],
    ["https://www.wsj.com/personal-finance/retirement", "RSSPersonalFinance"],
    ["https://www.wsj.com/lifestyle", "RSSLifestyle"],
    ["https://www.wsj.com/business", "WSJcomUSBusiness"],
  ];
  for (const [input, slug] of cases) {
    const known = knownFeedFor(input);
    assert.equal(known?.feedUrl, `https://feeds.content.dowjones.io/public/rss/${slug}`, input);
    assert.equal(known?.scope, "section", input);
  }
});

test("a single WSJ story falls back to the whole paper", () => {
  // Pasting a story is a request to follow the publisher, not to follow a
  // section named after that story's slug.
  const known = knownFeedFor(
    "https://www.wsj.com/articles/some-headline-a4f0f219?mod=rss_worldnews",
  );
  assert.equal(known?.scope, "site");
  assert.equal(known?.feedUrl, "https://feeds.content.dowjones.io/public/rss/RSSWorldNews");
});

test("rewrites the abandoned RSS host onto the live one", () => {
  // feeds.a.dj.com still answers 200, with every item dated January 2025.
  const known = knownFeedFor("https://feeds.a.dj.com/rss/RSSMarketsMain.xml");
  assert.equal(known?.feedUrl, "https://feeds.content.dowjones.io/public/rss/RSSMarketsMain");
  assert.equal(known?.title, "WSJ · Markets");

  // The live host pasted directly still gets a proper title.
  assert.equal(
    knownFeedFor("https://feeds.content.dowjones.io/public/rss/RSSOpinion")?.title,
    "WSJ · Opinion",
  );
  // An unknown Dow Jones slug is left to ordinary discovery.
  assert.equal(knownFeedFor("https://feeds.a.dj.com/rss/RSSNoSuchThing.xml"), null);
});

test("leaves everything else to ordinary discovery", () => {
  for (const input of ["nytimes.com", "journal", "r/news", "https://example.com/wsj"]) {
    assert.equal(knownFeedFor(input), null, input);
  }
});

test("every offered section resolves to a feed", () => {
  for (const choice of WSJ_CHOICES) {
    assert.equal(knownFeedFor(choice.url)?.feedUrl.endsWith(choice.slug), true, choice.url);
  }
});

test("every bundle in the directory resolves to real sources", () => {
  // Removing AP and Reuters — neither has a fetchable feed any more — left
  // the "Front pages" bundle pointing at two outlets that no longer exist,
  // so tapping it silently picked seven of the nine it claimed. A bundle
  // naming something absent is a bundle that quietly under-delivers.
  const outletIds = new Set(OUTLETS.map((outlet) => outlet.id));
  const subredditNames = new Set(SUBREDDITS.map((entry) => entry.name.toLowerCase()));

  for (const pack of PACKS) {
    assert.ok(pack.outlets.length > 0, `${pack.id} has no outlets`);
    for (const id of pack.outlets) {
      assert.ok(outletIds.has(id), `${pack.id} names a missing outlet: ${id}`);
    }
    for (const name of pack.subreddits ?? []) {
      assert.ok(
        subredditNames.has(name.toLowerCase()),
        `${pack.id} names a missing subreddit: ${name}`,
      );
    }
  }
});

test("no two directory entries claim the same id or feed", () => {
  const ids = new Set<string>();
  const feeds = new Set<string>();
  for (const outlet of OUTLETS) {
    assert.ok(!ids.has(outlet.id), `duplicate outlet id: ${outlet.id}`);
    ids.add(outlet.id);
    assert.ok(!feeds.has(outlet.feedUrl), `duplicate feed: ${outlet.feedUrl}`);
    feeds.add(outlet.feedUrl);
  }
  const names = new Set<string>();
  for (const entry of SUBREDDITS) {
    const key = entry.name.toLowerCase();
    assert.ok(!names.has(key), `duplicate subreddit: ${entry.name}`);
    names.add(key);
  }
});
