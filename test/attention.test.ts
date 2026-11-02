import test from "node:test";
import assert from "node:assert/strict";
import {
  cleanAssessment,
  earlierStories,
  livesScale,
  needsCheck,
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

test("the thousandth telling of a big story is worth little attention", () => {
  const first = scoreOf(story({ realizedLives: 5_000, novelty: "new" }));
  const again = scoreOf(story({ realizedLives: 5_000, novelty: "rehash" }));
  assert.ok(again.attention < first.attention / 5);
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
