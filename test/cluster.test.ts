import test from "node:test";
import assert from "node:assert/strict";
import { normalizeTitle, tokensOf, clusterStories } from "../lib/cluster";

test("strips the furniture outlets attach to their own headlines", () => {
  assert.equal(
    normalizeTitle("Opinion | Trump Eyes Pickaxe Mountain, Again"),
    "trump eyes pickaxe mountain again",
  );
  assert.equal(
    normalizeTitle("Analysis: Why the bond selloff matters - The Verge"),
    "why the bond selloff matters",
  );
  // Two layers of prefix, which syndicated copy really does carry.
  assert.equal(normalizeTitle("Live updates: Opinion | Fed cuts"), "fed cuts");
  assert.equal(normalizeTitle("Zelensky’s plan"), "zelenskys plan");
});

test("drops words that say nothing about which story it is", () => {
  // "the", "says", "will", "report", "new" carry nothing; the initials of
  // "U.S." fall out as single letters.
  assert.deepEqual(tokensOf("The U.S. says it will report on the new missiles"), [
    "missile",
  ]);
});

test("groups the same story told by different outlets", () => {
  const stories = [
    { id: "1", outlet: "wsj", title: "Iran Is Producing Ballistic Missiles Again" },
    { id: "2", outlet: "reuters", title: "Iran restarts ballistic missile production, intelligence finds" },
    { id: "3", outlet: "bbc", title: "Iran producing ballistic missiles again, officials say" },
    { id: "4", outlet: "wsj", title: "Best High-Yield Savings Accounts for September" },
    { id: "5", outlet: "ft", title: "Oracle posts higher profit on cloud strength" },
  ];
  const clusters = clusterStories(stories);
  const iran = clusters.find((c) => c.members.some((m) => m.id === "1"))!;
  assert.deepEqual(iran.members.map((m) => m.id).sort(), ["1", "2", "3"]);
  // The unrelated pair stayed apart rather than being swept into one blob.
  assert.equal(clusters.length, 3);
});

test("keeps different stories about the same subject apart", () => {
  const stories = [
    { id: "a", outlet: "wsj", title: "Fed cuts rates by a quarter point" },
    { id: "b", outlet: "cnbc", title: "Federal Reserve cuts interest rates a quarter point" },
    { id: "c", outlet: "wsj", title: "Fed nominee faces Senate questions on independence" },
  ];
  const clusters = clusterStories(stories);
  const withA = clusters.find((c) => c.members.some((m) => m.id === "a"))!;
  assert.equal(withA.members.some((m) => m.id === "c"), false);
});

test("a cluster keeps its key as members come and go", () => {
  const one = clusterStories([
    { id: "1", title: "Houthis sweep toward strategic Bab al-Mandeb" },
    { id: "2", title: "Houthi forces advance on Bab al-Mandeb chokepoint" },
  ]);
  const two = clusterStories([
    { id: "2", title: "Houthi forces advance on Bab al-Mandeb chokepoint" },
    { id: "3", title: "Houthis take Mokha, nearing Bab al-Mandeb" },
    { id: "9", title: "Unrelated: cricket scores" },
  ]);
  const keyOne = one[0].key;
  const keyTwo = two.find((c) => c.members.some((m) => m.id === "2"))!.key;
  assert.equal(keyOne, keyTwo);
});

test("scales to a realistic corpus without going quadratic", () => {
  // 3,000 headlines is a day of the whole panel; the blocking step is what
  // makes this finish, so a regression here shows up as a timeout.
  const stories = Array.from({ length: 3000 }, (_, i) => ({
    id: String(i),
    title: `Story number ${i} about ${["markets", "iran", "ai", "court"][i % 4]} and subject ${i % 700}`,
  }));
  const started = Date.now();
  const clusters = clusterStories(stories);
  assert.ok(clusters.length > 100, "should not collapse everything into one");
  assert.ok(Date.now() - started < 5000, `took ${Date.now() - started}ms`);
});
