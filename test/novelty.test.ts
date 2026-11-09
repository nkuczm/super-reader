import test from "node:test";
import assert from "node:assert/strict";
import { discoverStories, quietPrior, type QuietStory } from "../lib/novelty";
import { buildPulsePayload, type CorpusStory } from "../lib/pulse";

const NOW = Date.parse("2026-11-09T18:00:00Z");
const hoursAgo = (h: number) => NOW - h * 3_600_000;

function quiet(partial: Partial<QuietStory> & { url: string; title: string }): QuietStory {
  return {
    newsroom: "ProPublica",
    tier: 1,
    front: true,
    slot: 1,
    newsrooms: [partial.newsroom ?? "ProPublica"],
    seenAt: hoursAgo(3),
    prior: 0.8,
    ...partial,
  };
}

function held(id: string, title: string, sourceId = "s1", hours = 2) {
  return {
    id,
    title,
    link: `https://example.com/${id}`,
    sourceId,
    publishedAt: new Date(hoursAgo(hours)).toISOString(),
  };
}

test("an editor's front page outweighs a section timeline, and shopping is not news", () => {
  const front = quietPrior({ title: "Pentagon quietly rewrote rules on drone strikes", tier: 1, front: true, slot: 0 });
  const section = quietPrior({ title: "Pentagon rewrote rules on drone strikes", tier: 3, front: false, slot: 0 });
  const deal = quietPrior({ title: "The best laptop deals to buy for 2026", tier: 1, front: true, slot: 0 });
  assert.ok(front > section, `${front} > ${section}`);
  assert.ok(deal < section, `${deal} < ${section}`);
  assert.ok(front <= 1);
});

test("the pulse keeps quiet stories and leaves out what several newsrooms ran", () => {
  const story = (url: string, title: string, newsroom: string, extra: Partial<CorpusStory> = {}): CorpusStory => ({
    url,
    title,
    newsroom,
    outletId: newsroom,
    tier: 1,
    slot: 2,
    front: true,
    seenAt: hoursAgo(4),
    ...extra,
  });
  const payload = buildPulsePayload(
    [
      story("https://a.com/1", "Federal Reserve holds interest rates steady amid inflation worries", "Reuters"),
      story("https://b.com/1", "Federal Reserve holds interest rates steady as inflation worries linger", "AP"),
      story("https://c.com/1", "Fed holds interest rates steady with inflation worries", "NPR"),
      story("https://d.com/1", "County water utility quietly skipped lead testing for years, records show", "ProPublica"),
    ],
    [],
    NOW,
  );
  const urls = (payload.quiet ?? []).map((q) => q.url);
  assert.deepEqual(urls, ["https://d.com/1"]);
  assert.equal(payload.quiet?.[0].newsrooms.length, 1);
});

test("discover picks the reader's own uncovered stories and leaves out what the press is covering", () => {
  const list = [
    held("a", "Tiny lab finds enzyme that breaks down nylon waste", "blog"),
    held("b", "Election results: what we know so far", "wire"),
  ];
  const ranking = new Map([["b", { newsrooms: 9 }]]);
  const picks = discoverStories({ held: list, quiet: [], ranking, now: NOW });
  assert.deepEqual(
    picks.map((p) => (p.kind === "held" ? p.story.id : p.story.url)),
    ["a"],
  );
  assert.match(picks[0].why, /No other outlet/);
});

test("without a ranking, a held story is only said to be alone in this feed", () => {
  const picks = discoverStories({
    held: [held("a", "Tiny lab finds enzyme that breaks down nylon waste")],
    quiet: [],
    ranking: new Map(),
    measured: false,
    now: NOW,
  });
  assert.match(picks[0].why, /None of your other sources/);
});

test("a panel story the reader already has, under another address, is not a discovery", () => {
  const list = [
    held("a", "County water utility skipped lead testing for years, records show"),
    held("c", "Water utilities and lead pipes: a new federal rule explained"),
    held("d", "City council debates lead pipe replacement budget"),
  ];
  const picks = discoverStories({
    held: list,
    quiet: [
      quiet({ url: "https://propublica.org/x", title: "County water utility quietly skipped lead testing for years, records show" }),
      quiet({ url: "https://propublica.org/y", title: "State regulators let lead pipe inventories go unfinished", newsroom: "Grist" }),
    ],
    ranking: new Map(),
    now: NOW,
  });
  const outside = picks.filter((p) => p.kind === "outside").map((p) => (p.kind === "outside" ? p.story.url : ""));
  assert.deepEqual(outside, ["https://propublica.org/y"]);
});

test("a panel story with nothing in common with the feed needs strong evidence to be shown", () => {
  const list = [held("a", "Rust compiler adds new borrow checker diagnostics"), held("b", "Rust release brings faster compile times")];
  const picks = discoverStories({
    held: list,
    quiet: [
      quiet({ url: "https://x.com/1", title: "Provincial election called early in Saskatchewan", prior: 0.5 }),
      // One word in common ("release") is a coincidence, not a shared interest.
      quiet({ url: "https://x.com/3", title: "Hostage release talks stall at border crossing", prior: 0.75, newsroom: "BBC" }),
      quiet({ url: "https://x.com/2", title: "Rust maintainers quietly drop support for older compiler targets", prior: 0.5 }),
    ],
    ranking: new Map(),
    now: NOW,
  });
  const urls = picks.filter((p) => p.kind === "outside").map((p) => (p.kind === "outside" ? p.story.url : ""));
  assert.deepEqual(urls, ["https://x.com/2"]);
});

test("no outlet fills the list, and old stories are left out", () => {
  const list = [held("a", "Courts and prisons budget hearing scheduled")];
  const many = Array.from({ length: 8 }, (_, i) =>
    quiet({ url: `https://p.org/${i}`, title: `Prison oversight report ${i} finds courts ignored complaint number ${i * 7}` }),
  );
  const old = quiet({ url: "https://p.org/old", title: "Prison courts report from last week", newsroom: "Other", seenAt: hoursAgo(100) });
  const picks = discoverStories({ held: list, quiet: [...many, old], ranking: new Map(), now: NOW });
  const outside = picks.filter((p) => p.kind === "outside");
  assert.ok(outside.length <= 3, `got ${outside.length}`);
  assert.ok(!outside.some((p) => p.kind === "outside" && p.story.url.endsWith("/old")));
});
