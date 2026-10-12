import test from "node:test";
import assert from "node:assert/strict";
import { groupStories } from "../lib/story-groups";
import { aboutTopic, trendingTopics } from "../lib/trending";

const NOW = Date.parse("2026-10-12T20:00:00Z");
const HOUR = 3_600_000;
let n = 0;
const story = (title: string, sourceId: string, hoursAgo = 1, extra: Record<string, unknown> = {}) => ({
  id: `s${++n}`,
  title,
  sourceId,
  link: `https://${sourceId}.example/${n}`,
  publishedAt: new Date(NOW - hoursAgo * HOUR).toISOString(),
  ...extra,
});

test("the same story from several outlets is one row, where its first copy stood", () => {
  const list = [
    story("Iran restarts ballistic missile production, intelligence finds", "reuters"),
    story("Iran Is Producing Ballistic Missiles Again", "wsj"),
    story("Apple unveils new iPad Pro with M6 chip", "verge"),
    story("Iran producing ballistic missiles again, US officials say", "nyt"),
    story("Local library extends weekend hours", "patch"),
  ];
  const groups = groupStories(list, { now: NOW });
  assert.deepEqual(groups.map((group) => group.map((s) => s.sourceId)), [
    ["reuters", "wsj", "nyt"],
    ["verge"],
    ["patch"],
  ]);
});

test("the ranking's own cluster groups stories whose headlines do not match", () => {
  const list = [
    story("Fed holds rates steady", "wsj"),
    story("Powell signals patience as inflation cools", "ft"),
    story("Unrelated story about gardens", "bbc"),
  ];
  const keys = new Map([[list[0].id, "fed-rate"], [list[1].id, "fed-rate"]]);
  const groups = groupStories(list, { now: NOW, keyOf: (s) => keys.get(s.id) });
  assert.deepEqual(groups.map((g) => g.length), [2, 1]);
});

test("headlines a week apart are not matched as one story", () => {
  const list = [
    story("Gaza ceasefire talks resume in Cairo", "bbc", 2),
    story("Gaza ceasefire talks resume in Cairo after pause", "guardian", 24 * 9),
  ];
  assert.equal(groupStories(list, { now: NOW }).length, 2);
});

test("a copy with a picture leads its row", () => {
  const list = [
    story("Iran restarts ballistic missile production, intelligence finds", "reuters"),
    story("Iran Is Producing Ballistic Missiles Again", "wsj", 1, { image: "https://x/y.jpg" }),
  ];
  const [group] = groupStories(list, { now: NOW, prefer: (s) => Boolean((s as { image?: string }).image) });
  assert.equal(group[0].sourceId, "wsj");
  assert.equal(group.length, 2);
});

test("trending topics are what several outlets are writing about now", () => {
  const list = [
    story("Supreme Court hears challenge to tariff powers", "nyt", 2),
    story("Supreme Court weighs limits on president's tariff authority", "wsj", 3),
    story("Justices skeptical in Supreme Court tariff case", "ap", 4),
    story("Nobel Prize in economics goes to crisis researchers", "ft", 5),
    story("Economics Nobel Prize awarded for work on financial crises", "bbc", 6),
    story("Local bakery wins award", "patch", 2),
    story("Hurricane Melissa strengthens near Jamaica", "cnn", 1),
    story("Hurricane Melissa: Jamaica braces for landfall", "bbc", 2),
    // Older stories set the baseline.
    ...Array.from({ length: 30 }, (_, i) => story(`Archive story number ${i} about assorted matters`, `old${i % 5}`, 24 * 5)),
  ];
  const topics = trendingTopics(list, { now: NOW });
  const labels = topics.map((topic) => topic.label);
  assert.ok(labels.includes("Supreme Court"), labels.join(", "));
  assert.ok(labels.some((label) => /Nobel/.test(label)), labels.join(", "));
  assert.ok(labels.some((label) => /Melissa|Hurricane/.test(label)), labels.join(", "));
  // One chip per story: not "Supreme Court" and "Court" and "Supreme".
  assert.equal(labels.filter((label) => /Supreme|Court/.test(label)).length, 1, labels.join(", "));
  assert.ok(!labels.includes("Bakery"), "one outlet's story is not a trend");
  const court = topics.find((topic) => topic.label === "Supreme Court")!;
  assert.equal(court.sources, 3);
  assert.equal(list.filter((s) => aboutTopic(s.title, court.key)).length, 3);
});

test("one outlet repeating a word is not a trend", () => {
  const list = Array.from({ length: 6 }, (_, i) => story(`Live: Gaza updates hour ${i}`, "liveblog", 1));
  assert.deepEqual(trendingTopics(list, { now: NOW }), []);
});

test("what the whole feed is about is not a topic within it", () => {
  const list = [
    ...Array.from({ length: 40 }, (_, i) => story(`AI model ${i} does something clever`, `src${i % 6}`, 1 + (i % 3) * 30)),
    story("OpenAI and Microsoft renegotiate partnership", "verge", 2),
    story("Microsoft, OpenAI agree new partnership terms", "ft", 3),
  ];
  const labels = trendingTopics(list, { now: NOW }).map((topic) => topic.label);
  assert.ok(!labels.includes("AI"), labels.join(", "));
  assert.ok(labels.some((label) => /OpenAI|Microsoft|Partnership/.test(label)), labels.join(", "));
});
