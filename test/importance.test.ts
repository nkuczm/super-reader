import test from "node:test";
import assert from "node:assert/strict";
import { scoreCluster, importanceBand } from "../lib/importance";
import type { ClusterEvidence, StoryEvidence } from "../lib/importance";

const NOW = Date.UTC(2026, 8, 11, 12, 0, 0);
const hoursAgo = (h: number) => NOW - h * 3_600_000;

function story(over: Partial<StoryEvidence> & { newsroom: string }): StoryEvidence {
  return { tier: 1, position: 5, front: false, seenAt: hoursAgo(3), ...over };
}

test("many newsrooms outrank one newsroom's own lead story", () => {
  const wide: ClusterEvidence = {
    key: "wide",
    stories: ["AP", "Reuters", "NYT", "BBC", "NPR", "CNN", "Guardian"].map((n) =>
      story({ newsroom: n, position: 3 }),
    ),
  };
  const single: ClusterEvidence = {
    key: "single",
    stories: [story({ newsroom: "NYT", position: 0, front: true })],
  };
  const a = scoreCluster(wide, NOW);
  const b = scoreCluster(single, NOW);
  assert.ok(a.score > b.score, `${a.score} should beat ${b.score}`);
  assert.equal(a.newsrooms, 7);
  assert.match(a.reasons[0], /7 newsrooms/);
});

test("one newsroom in two sections is still one newsroom", () => {
  const twice = scoreCluster(
    {
      key: "k",
      stories: [
        story({ newsroom: "The Wall Street Journal", position: 1 }),
        story({ newsroom: "The Wall Street Journal", position: 4 }),
      ],
    },
    NOW,
  );
  const once = scoreCluster(
    { key: "k", stories: [story({ newsroom: "The Wall Street Journal", position: 1 })] },
    NOW,
  );
  assert.equal(twice.newsrooms, 1);
  assert.equal(twice.parts.breadth, once.parts.breadth);
});

test("a front page lead outranks the same position in a section timeline", () => {
  const front = scoreCluster(
    { key: "a", stories: [story({ newsroom: "BBC News", position: 0, front: true })] },
    NOW,
  );
  const section = scoreCluster(
    { key: "b", stories: [story({ newsroom: "BBC News", position: 0, front: false })] },
    NOW,
  );
  assert.ok(front.parts.placement > section.parts.placement * 2);
  assert.match(front.reasons.join(" "), /leading BBC News/);
});

test("tiers matter: specialist sites agreeing is not the country stopping", () => {
  const majors = scoreCluster(
    {
      key: "a",
      stories: ["AP", "NYT", "BBC", "NPR"].map((n) => story({ newsroom: n, tier: 1 })),
    },
    NOW,
  );
  const trade = scoreCluster(
    {
      key: "b",
      stories: ["Grist", "Canary Media", "Heatmap News", "Carbon Brief"].map((n) =>
        story({ newsroom: n, tier: 3 }),
      ),
    },
    NOW,
  );
  assert.ok(majors.score > trade.score, `${majors.score} vs ${trade.score}`);
});

test("reader engagement counts, from subreddits or from comment counts", () => {
  const base = { key: "k", stories: [story({ newsroom: "Ars Technica", tier: 2 })] };
  const bare = scoreCluster(base, NOW);
  const discussed = scoreCluster(
    {
      ...base,
      reddit: [
        { subreddit: "technology", weight: 1, position: 0 },
        { subreddit: "programming", weight: 2, position: 3 },
      ],
    },
    NOW,
  );
  const commented = scoreCluster(
    {
      key: "k",
      stories: [story({ newsroom: "Hacker News", tier: 3, comments: 800 })],
    },
    NOW,
  );
  assert.ok(discussed.score > bare.score);
  assert.match(discussed.reasons.join(" "), /2 subreddits, top on r\/technology/);
  assert.match(commented.reasons.join(" "), /800 comments/);
});

test("the same breadth arriving fast beats the same breadth over days", () => {
  const newsrooms = ["AP", "Reuters", "NYT", "BBC", "NPR"];
  const fast = scoreCluster(
    { key: "a", stories: newsrooms.map((n) => story({ newsroom: n, seenAt: hoursAgo(2) })) },
    NOW,
  );
  const slow = scoreCluster(
    { key: "b", stories: newsrooms.map((n) => story({ newsroom: n, seenAt: hoursAgo(72) })) },
    NOW,
  );
  assert.ok(fast.score > slow.score, `${fast.score} vs ${slow.score}`);
  assert.match(fast.reasons.join(" "), /picked up fast/);
});

test("bands are strict enough to mean something", () => {
  // A routine single-outlet section item must not read as important.
  const routine = scoreCluster(
    { key: "k", stories: [story({ newsroom: "Engadget", tier: 3, position: 12 })] },
    NOW,
  );
  assert.equal(importanceBand(routine.score), "quiet");

  // The day's story: wires, front pages, and people arguing about it.
  const huge = scoreCluster(
    {
      key: "k",
      stories: ["AP", "Reuters", "NYT", "BBC", "NPR", "CNN", "Guardian", "WaPo", "Al Jazeera"].map(
        (n, i) => story({ newsroom: n, position: i % 3, front: true, seenAt: hoursAgo(4) }),
      ),
      reddit: [
        { subreddit: "news", weight: 1, position: 0 },
        { subreddit: "worldnews", weight: 1, position: 1 },
        { subreddit: "politics", weight: 1, position: 2 },
      ],
    },
    NOW,
  );
  assert.equal(importanceBand(huge.score), "major");
  assert.ok(huge.score >= 75, `expected a high score, got ${huge.score}`);
});
