import test from "node:test";
import assert from "node:assert/strict";
import { clusterStories } from "../lib/cluster";
import {
  SAME_STORY,
  DIFFERENT_STORIES,
  KNOWN_LIMITS,
  allHeadlines,
} from "./fixtures/headlines.mjs";

/**
 * Clustering judged against real headlines rather than invented ones.
 *
 * The corpus is every fixture headline at once, which is how it works in
 * production: a day's output from many newsrooms, where the wrong merge is
 * always available.
 */
function clusterFixture() {
  const corpus = allHeadlines();
  const clusters = clusterStories(corpus);
  const keyOf = new Map<string, string>();
  for (const cluster of clusters) {
    for (const member of cluster.members) keyOf.set(member.id, cluster.key);
  }
  const titleOf = new Map(corpus.map((story) => [story.id, story.title]));
  return { corpus, clusters, keyOf, titleOf };
}

test("copies of one story end up as one story", () => {
  const { corpus, keyOf, titleOf } = clusterFixture();
  const failures: string[] = [];

  for (const label of Object.keys(SAME_STORY)) {
    const ids = corpus.filter((story) => story.label === label).map((story) => story.id);
    const keys = new Set(ids.map((id) => keyOf.get(id)));
    if (keys.size !== 1) {
      failures.push(
        `${label} split into ${keys.size}:\n` +
          ids.map((id) => `    [${keyOf.get(id)}] ${titleOf.get(id)}`).join("\n"),
      );
    }
  }

  assert.equal(failures.length, 0, `\n${failures.join("\n")}`);
});

test("never merges two stories in a way that invents coverage", () => {
  // The strict test, and the one that matters: a false merge is harmful when
  // it adds a newsroom that did not cover that story, because the score is
  // built on how many newsrooms did. Two pieces from the *same* newsroom
  // ending up together cannot overstate anything — it is one newsroom either
  // way — so those are counted separately below rather than failed here.
  const { corpus, keyOf, titleOf } = clusterFixture();
  const byId = new Map(corpus.map((story) => [story.id, story]));
  const failures: string[] = [];

  for (const label of Object.keys(DIFFERENT_STORIES)) {
    const ids = corpus
      .filter((story) => story.id.startsWith(`diff-${label}-`))
      .map((story) => story.id);
    for (let i = 0; i < ids.length; i++) {
      for (let j = i + 1; j < ids.length; j++) {
        if (keyOf.get(ids[i]) !== keyOf.get(ids[j])) continue;
        const [a, b] = [byId.get(ids[i])!, byId.get(ids[j])!];
        if (a.outlet === b.outlet) continue;
        failures.push(
          `${label}: merged across newsrooms\n    ${a.outlet}: ${titleOf.get(ids[i])}\n    ${b.outlet}: ${titleOf.get(ids[j])}`,
        );
      }
    }
  }

  assert.equal(failures.length, 0, `\n${failures.join("\n")}`);
});

test("keeps same-newsroom over-merging to a known, small amount", () => {
  // A running dispute reported repeatedly by one specialist does end up
  // grouped: SCOTUSblog's Missouri filings, days apart, read alike enough to
  // join. It costs nothing in score terms and it is the price of the
  // threshold that gets the cross-newsroom merges right — but it should not
  // grow silently, so it is pinned.
  const { corpus, keyOf } = clusterFixture();
  const byId = new Map(corpus.map((story) => [story.id, story]));
  let merges = 0;

  for (const label of Object.keys(DIFFERENT_STORIES)) {
    const ids = corpus
      .filter((story) => story.id.startsWith(`diff-${label}-`))
      .map((story) => story.id);
    for (let i = 0; i < ids.length; i++) {
      for (let j = i + 1; j < ids.length; j++) {
        if (keyOf.get(ids[i]) !== keyOf.get(ids[j])) continue;
        if (byId.get(ids[i])!.outlet === byId.get(ids[j])!.outlet) merges += 1;
      }
    }
  }

  assert.ok(merges <= 8, `same-newsroom over-merges rose to ${merges}`);
});

test("a story's cluster never gains a newsroom that did not cover it", () => {
  // The metric the score actually rests on. Breadth is "how many newsrooms
  // ran this", so the way clustering can lie is by putting a newsroom into a
  // story it never covered — which is what the TIFF photo gallery did to the
  // convention coverage. Extra pieces from a newsroom already in the cluster
  // change nothing about that count, so they are not failures here.
  const { corpus, clusters, titleOf } = clusterFixture();
  const byId = new Map(corpus.map((story) => [story.id, story]));
  const failures: string[] = [];

  for (const [label, group] of Object.entries(SAME_STORY)) {
    const expected = new Set(group.map(([newsroom]: [string, string]) => newsroom));
    const ids = corpus.filter((story) => story.label === label).map((story) => story.id);
    const cluster = clusters.find((entry) =>
      entry.members.some((member) => member.id === ids[0]),
    )!;

    for (const member of cluster.members) {
      const newsroom = byId.get(member.id)!.outlet;
      if (expected.has(newsroom)) continue;
      failures.push(
        `${label} gained ${newsroom}, which covered something else:\n    ${titleOf.get(member.id)}`,
      );
    }
  }

  assert.equal(failures.length, 0, `\n${failures.join("\n")}`);
});

test("records the stories headlines alone cannot join", () => {
  // Not an aspiration test: it pins what the matcher currently cannot do, so
  // the cost is visible and a future improvement shows up here. Each of
  // these is a real story whose breadth is undercounted as a result. See
  // KNOWN_LIMITS for why each one resists matching.
  const { corpus, keyOf } = clusterFixture();
  for (const label of Object.keys(KNOWN_LIMITS)) {
    const ids = corpus
      .filter((story) => story.id.startsWith(`limit-${label}-`))
      .map((story) => story.id);
    const keys = new Set(ids.map((id) => keyOf.get(id)));
    assert.ok(
      keys.size > 1,
      `${label} now clusters — move it into SAME_STORY and keep it there`,
    );
  }
});
