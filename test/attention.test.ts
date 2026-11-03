import test from "node:test";
import assert from "node:assert/strict";
import {
  cleanAssessment,
  earlierStories,
  knownForDays,
  livesScale,
  needsCheck,
  noveltyFactor,
  noveltyLabel,
  revise,
  scoreOf,
  stakesLabel,
  worldStakes,
  type Assessment,
} from "../lib/attention";

const base: Assessment = {
  summary: "",
  kind: "news",
  realizedLives: 0,
  potentialLives: 0,
  probability: 0,
  stakesWhy: "",
  field: "Politics",
  fieldClass: "knowledge",
  fieldSignificance: 0,
  fieldWhy: "",
  novelty: "new",
  whatsNew: "",
  knownFrom: [],
  knownFor: "fresh",
  fundamental: false,
};
const story = (over: Partial<Assessment>) => ({ ...base, ...over });

test("lives on a scale of tens: one life is 2, a hundred is 4, a billion is capped at 10", () => {
  assert.equal(livesScale(0), 0);
  assert.equal(livesScale(1), 2);
  assert.equal(livesScale(100), 4);
  assert.equal(livesScale(1e12), 10);
});

test("a shooting that happened outranks a war that might, which outranks a shooting that might", () => {
  const shooting = scoreOf(story({ realizedLives: 12 }));
  const possibleWar = scoreOf(story({ potentialLives: 100_000, probability: 0.05 }));
  const possibleShooting = scoreOf(story({ potentialLives: 20, probability: 0.2 }));
  assert.ok(shooting.attention > possibleWar.attention, `${shooting.attention} > ${possibleWar.attention}`);
  assert.ok(possibleWar.attention > possibleShooting.attention, `${possibleWar.attention} > ${possibleShooting.attention}`);
  assert.equal(possibleShooting.attention, 0);
});

test("a blitz of coverage on one day takes nothing away from any report of it", () => {
  const first = scoreOf(story({ realizedLives: 5_000, novelty: "new" }));
  // The twentieth outlet that afternoon, adding nothing: still the day's news.
  const twentieth = scoreOf(story({ realizedLives: 5_000, novelty: "rehash", knownDays: 0.4 }));
  assert.equal(twentieth.attention, first.attention);
  assert.equal(noveltyLabel({ novelty: "rehash", knownFor: "fresh", knownDays: 0.4 }), "Fresh");
});

test("what was already known days or years before is worth less, the older the less", () => {
  const fresh = scoreOf(story({ realizedLives: 5_000, novelty: "rehash", knownDays: 1 })).attention;
  const week = scoreOf(story({ realizedLives: 5_000, novelty: "rehash", knownDays: 6 })).attention;
  const month = scoreOf(story({ realizedLives: 5_000, novelty: "rehash", knownDays: 25 })).attention;
  const saturated = scoreOf(story({ realizedLives: 5_000, novelty: "rehash", knownFor: "years" })).attention;
  assert.ok(fresh > week && week > month && month > saturated, `${fresh} > ${week} > ${month} > ${saturated}`);
  assert.ok(saturated < fresh / 5);
});

test("new information on an older story keeps most of its weight; a small detail, some", () => {
  assert.equal(noveltyFactor({ novelty: "development", knownFor: "weeks", knownDays: 20 }), 0.85);
  assert.equal(noveltyFactor({ novelty: "new", knownFor: "weeks", knownDays: 20 }), 1);
  assert.equal(noveltyFactor({ novelty: "minor", knownFor: "days", knownDays: 10 }), 0.51);
  assert.equal(noveltyFactor({ novelty: "rehash", knownFor: "days", knownDays: 10 }), 0.3);
});

test("how long a story was known comes from the evidence, the longest of it", () => {
  const publishedAt = "2026-11-03T12:00:00Z";
  const earlier = [{ id: "E1", publishedAt: "2026-10-29T12:00:00Z" }, { id: "E2", publishedAt: "2026-11-03T08:00:00Z" }];
  // Only the earlier stories that carried its main point count.
  assert.equal(knownForDays({ knownFrom: ["E2"], knownFor: "fresh", novelty: "rehash" }, { publishedAt, earlier }), 0.2);
  assert.equal(knownForDays({ knownFrom: ["E1", "E2"], knownFor: "fresh", novelty: "rehash" }, { publishedAt, earlier }), 5);
  // The panel's first sighting dates a repeat, not a new development of a running story.
  assert.equal(knownForDays({ knownFrom: [], knownFor: "fresh", novelty: "rehash" }, { publishedAt, earlier, coverage: { firstSeenHoursBefore: 30 } }), 1.3);
  assert.equal(knownForDays({ knownFrom: [], knownFor: "fresh", novelty: "development" }, { publishedAt, earlier, coverage: { firstSeenHoursBefore: 30 } }), 0);
  // A web check's first report, and the model's sense of a settled idea.
  assert.equal(knownForDays({ knownFrom: [], knownFor: "fresh", novelty: "rehash" }, { publishedAt, earlier, firstReported: "2026-10-30" }), 3);
  assert.equal(knownForDays({ knownFrom: [], knownFor: "years", novelty: "rehash" }, { publishedAt, earlier }), 730);
});

test("a unique story about a new film is new, and still not important", () => {
  const film = scoreOf(story({ kind: "other", field: "Film", fieldClass: "entertainment", fieldSignificance: 6, novelty: "new" }));
  assert.ok(film.attention <= 10, String(film.attention));
});

test("a landmark paper in its field counts, without pretending lives are at stake", () => {
  const paper = scoreOf(story({ kind: "research", field: "Philosophy of mind", fieldSignificance: 9, novelty: "new" }));
  assert.equal(paper.led, "field");
  assert.equal(paper.world, 0);
  assert.ok(paper.attention >= 40, String(paper.attention));
});

test("only a very important news event is checked against recent reporting", () => {
  assert.equal(needsCheck(story({ realizedLives: 12 })), false);
  assert.equal(needsCheck(story({ realizedLives: 2_000 })), true);
  assert.equal(needsCheck(story({ kind: "research", realizedLives: 2_000 })), false);
});

test("what the check found replaces what was assumed", () => {
  const before = story({ potentialLives: 1_000_000, probability: 0.3, novelty: "new" });
  const after = revise(before, { probability: 0.02, novelty: "development" });
  assert.ok(worldStakes(after) < worldStakes(before));
  assert.equal(after.novelty, "development");
  assert.equal(stakesLabel(after), "Up to 1 million at stake, 2% likely");
  assert.equal(stakesLabel(story({ realizedLives: 12 })), "About 12 lives affected");
});

test("earlier stories are the reader's own, before this one, and on the same thing", () => {
  const target = { title: "Iran restarts ballistic missile production, officials say", link: "https://a.example/iran", publishedAt: "2026-10-30T12:00:00Z" };
  const pool = [
    { title: "Iran restarts ballistic missile production, officials say", link: "https://a.example/iran" },
    { title: "Iran producing ballistic missiles again, intelligence finds", link: "https://b.example/1", publishedAt: "2026-10-29T08:00:00Z", outlet: "WSJ" },
    { title: "Iran ballistic missile production resumes after strikes", link: "https://c.example/2", publishedAt: "2026-11-01T08:00:00Z" },
    { title: "Apple unveils a new iPad", link: "https://d.example/3", publishedAt: "2026-10-29T08:00:00Z" },
  ];
  const found = earlierStories(target, pool);
  assert.deepEqual(found.map((e) => [e.id, e.link]), [["E1", "https://b.example/1"]]);
  assert.equal(found[0].outlet, "WSJ");
});

test("a model's answer is made safe before it is used", () => {
  const clean = cleanAssessment(
    { kind: "war", realizedLives: -4, probability: 7, fieldSignificance: 12.6, novelty: "huge", knownFrom: ["E1", "E9", 3], fieldClass: "x" },
    new Set(["E1"]),
  )!;
  assert.equal(clean.kind, "other");
  assert.equal(clean.realizedLives, 0);
  assert.equal(clean.probability, 1);
  assert.equal(clean.fieldSignificance, 10);
  assert.equal(clean.novelty, "minor");
  assert.equal(clean.fieldClass, "knowledge");
  assert.deepEqual(clean.knownFrom, ["E1"]);
  assert.equal(cleanAssessment(null, new Set()), null);
});
