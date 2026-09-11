import test from "node:test";
import assert from "node:assert/strict";
import { canonicalUrl, buildPulsePayload, rankAgainstPulse } from "../lib/pulse";
import type { CorpusStory } from "../lib/pulse";

const NOW = Date.UTC(2026, 8, 11, 12, 0, 0);

function story(over: Partial<CorpusStory> & { url: string; title: string; newsroom: string }): CorpusStory {
  return {
    outletId: over.newsroom.toLowerCase(),
    tier: 1,
    slot: 2,
    front: true,
    seenAt: NOW - 2 * 3_600_000,
    ...over,
  };
}

test("collapses the same article arriving by different routes", () => {
  const routes = [
    "https://www.wsj.com/world/iran-missiles-5538af12?mod=rss_worldnews",
    "http://wsj.com/world/iran-missiles-5538af12",
    "https://www.wsj.com/world/iran-missiles-5538af12?utm_source=reddit&utm_medium=social",
    "https://www.wsj.com/world/iran-missiles-5538af12/#comments",
  ];
  const canonical = new Set(routes.map(canonicalUrl));
  assert.equal(canonical.size, 1, [...canonical].join("\n"));
  assert.equal([...canonical][0], "https://wsj.com/world/iran-missiles-5538af12");
  // A query that selects content is not tracking and has to survive.
  assert.equal(
    canonicalUrl("https://example.com/story?id=42&utm_source=x"),
    "https://example.com/story?id=42",
  );
});

test("builds a ranking from what the panel ran", () => {
  const stories: CorpusStory[] = [
    story({ url: "https://apnews.com/a", title: "Iran restarts ballistic missile production", newsroom: "AP", slot: 0 }),
    story({ url: "https://reuters.com/b", title: "Iran resumes ballistic missile production, intelligence says", newsroom: "Reuters", slot: 1 }),
    story({ url: "https://bbc.com/c", title: "Iran producing ballistic missiles again", newsroom: "BBC News", slot: 2 }),
    story({ url: "https://nytimes.com/d", title: "Iran is producing ballistic missiles again, officials say", newsroom: "The New York Times", slot: 1 }),
    // A one-outlet item with nothing behind it: no entry, so no claim.
    story({ url: "https://engadget.com/e", title: "The best USB-C cables we tested this year", newsroom: "Engadget", tier: 3, slot: 14, front: false }),
  ];
  const payload = buildPulsePayload(stories, [], NOW);

  assert.equal(payload.storyCount, 5);
  assert.equal(payload.clusters.length, 1);
  const [top] = payload.clusters;
  assert.equal(top.newsrooms.length, 4);
  // Four newsrooms on their front pages is "big"; "major" is reserved for a
  // story the whole panel is leading with.
  assert.equal(top.band, "big");
  assert.equal(top.urls.length, 4);
  // The best-placed copy represents the cluster.
  assert.equal(top.link, "https://apnews.com/a");
});

test("a single outlet plus a community discussion still ranks", () => {
  const payload = buildPulsePayload(
    [story({ url: "https://404media.co/x", title: "Leaked documents show the scanner network", newsroom: "404 Media", tier: 3, front: false, slot: 3 })],
    [
      { url: "https://404media.co/x", subreddit: "technology", weight: 1, slot: 0 },
      { url: "https://404media.co/x", subreddit: "privacy", weight: 3, slot: 4 },
    ],
    NOW,
  );
  assert.equal(payload.clusters.length, 1);
  assert.match(payload.clusters[0].reasons.join(" "), /2 subreddits, top on r\/technology/);
});

test("an aggregator's copy is not an independent newsroom", () => {
  // Hacker News carrying a blog post is one source, not two, so this needs
  // its comment count to be worth an entry at all.
  const quiet = buildPulsePayload(
    [
      story({ url: "https://blog.example.com/p", title: "A very specific database trick", newsroom: "Example Blog", tier: 3, front: false }),
      story({ url: "https://news.ycombinator.com/item?id=1", title: "A very specific database trick", newsroom: "Hacker News", tier: 3 }),
    ],
    [],
    NOW,
  );
  assert.equal(quiet.clusters.length, 0);
});

test("matches a reader's articles by URL, then by headline", () => {
  const payload = buildPulsePayload(
    [
      story({ url: "https://apnews.com/a", title: "Iran restarts ballistic missile production", newsroom: "AP", slot: 0 }),
      story({ url: "https://reuters.com/b", title: "Iran resumes ballistic missile production, intelligence says", newsroom: "Reuters", slot: 1 }),
      story({ url: "https://bbc.com/c", title: "Iran producing ballistic missiles again", newsroom: "BBC News" }),
    ],
    [],
    NOW,
  );

  const ranked = rankAgainstPulse(payload, [
    // The exact article, arriving with a tracking parameter.
    { id: "1", link: "https://apnews.com/a?utm_source=feed", title: "Iran restarts ballistic missile production" },
    // A source nobody in the panel follows, covering the same event.
    { id: "2", link: "https://obscure-defence-blog.example/iran", title: "Iran has resumed production of ballistic missiles" },
    // Unrelated: no score at all rather than a made-up one.
    { id: "3", link: "https://example.com/cats", title: "How to train a cat to use a door" },
  ]);

  assert.deepEqual(
    ranked.map((r) => [r.id, r.via]),
    [["1", "url"], ["2", "headline"]],
  );
  assert.equal(ranked[0].key, ranked[1].key);
  assert.equal(ranked[0].newsrooms, 3);
});
