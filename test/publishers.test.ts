import test from "node:test";
import assert from "node:assert/strict";
import { parseBundle } from "../lib/bundle";
import { knownFeedFor, WSJ_CHOICES, repairSources } from "../lib/publishers";
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
    assert.ok(parseBundle(known.feedUrl), `${input} should carry every section`);
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
  // The whole paper is every section — it used to be the world desk under the
  // paper's name, which is how markets, business and tech went missing.
  const feeds = parseBundle(known!.feedUrl);
  assert.ok(feeds && feeds.length >= 8, "the paper is a bundle of its sections");
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

test("the paper is saved as the paper, not as the first feed read", async () => {
  // The preview builds its metadata from whichever section answered first.
  // Saving that would quietly follow that one section for ever — which is the
  // bug this whole bundle exists to fix, reintroduced one layer down.
  const { discover } = await import("../lib/discover");
  const original = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = String(input);
    const slug = url.split("/").pop();
    return new Response(
      `<?xml version="1.0"?><rss version="2.0"><channel><title>WSJ.com: ${slug}</title>
       <link>https://www.wsj.com</link><description>${slug}</description>
       <item><title>A ${slug} story</title><link>https://www.wsj.com/${slug}/story-1234</link>
       <pubDate>Sun, 13 Sep 2026 10:00:00 GMT</pubDate></item></channel></rss>`,
      { status: 200, headers: { "content-type": "application/rss+xml" } },
    );
  }) as typeof fetch;

  try {
    const result = await discover("wsj");
    assert.ok(parseBundle(result.feedUrl), `saved ${result.feedUrl}, expected the bundle`);
    assert.equal(result.title, "The Wall Street Journal");
    // Every section contributed, and each story arrived once.
    assert.ok(result.articles.length >= 8, `expected a story per section, got ${result.articles.length}`);
  } finally {
    globalThis.fetch = original;
  }
});

test("recognises the Associated Press however it is asked for", () => {
  for (const input of [
    "ap",
    "AP",
    "AP News",
    "apnews",
    "apnews.com",
    "Associated Press",
    "the associated press",
    "https://apnews.com",
    "https://www.apnews.com/hub/politics",
    "https://apnews.com/article/some-story-0123456789",
    // The hosts that used to serve AP's feeds.
    "https://hosted.ap.org/dynamic/fronts/HOME",
    "https://feeds.apnews.com/rss/apf-topnews",
  ]) {
    const known = knownFeedFor(input);
    assert.ok(known, `should recognise ${input}`);
    assert.equal(known.title, "AP News");
    assert.equal(known.siteUrl, "https://apnews.com");
    assert.equal(known.faviconHost, "apnews.com");
    // The feed is Google's, so sitemap collection must not be aimed at it.
    assert.equal(known.scope, "section");
    assert.match(known.feedUrl, /^https:\/\/news\.google\.com\/rss\/search\?q=site%3Aapnews\.com/);
  }
});

test("repairs a stored source whose feed has since died", () => {
  // What a device saved back when these hosts worked.
  const stored = [
    { feedUrl: "https://apnews.com/rss/apf-topnews", title: "AP Top News", favicon: "old" },
    { feedUrl: "https://feeds.a.dj.com/rss/RSSMarketsMain.xml", title: "WSJ Markets" },
    { feedUrl: "https://feeds.bbci.co.uk/news/rss.xml", title: "BBC News" },
  ];
  const fixed = repairSources(stored);

  assert.match(fixed[0].feedUrl, /news\.google\.com/);
  assert.equal(fixed[0].title, "AP News");
  assert.equal(fixed[1].feedUrl, "https://feeds.content.dowjones.io/public/rss/RSSMarketsMain");
  // A feed that still works is left exactly as it was.
  assert.deepEqual(fixed[2], stored[2]);
});

test("repairs an AP source built from a Bing search", () => {
  const fixed = repairSources([
    { feedUrl: "https://www.bing.com/news/search?q=site%3Aapnews.com&format=RSS", title: "AP" },
  ]);
  assert.match(fixed[0].feedUrl, /news\.google\.com/);
  // A Bing search for anything else is left alone: it is a working feed and
  // there is no measured better route for it.
  const other = [
    { feedUrl: "https://www.bing.com/news/search?q=semiconductors&format=RSS", title: "Chips" },
  ];
  assert.equal(repairSources(other), other);
});

test("leaves a list with nothing to repair identical", () => {
  const stored = [{ feedUrl: "https://www.theguardian.com/uk/rss", title: "The Guardian" }];
  // Same array, not a copy: a load that changes nothing must not read as an
  // edit and get stamped and pushed to the other devices.
  assert.equal(repairSources(stored), stored);
});

test("a repaired AP feed is the one the directory offers", () => {
  const ap = OUTLETS.find((outlet) => outlet.id === "ap-wire");
  assert.ok(ap);
  assert.equal(ap.feedUrl, knownFeedFor("Associated Press")?.feedUrl);
  // Ordered by the clock, so it says nothing about what AP led with.
  assert.equal(ap.front, undefined);
});
