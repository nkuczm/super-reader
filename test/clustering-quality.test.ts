import test from "node:test";
import assert from "node:assert/strict";
import { clusterStories } from "../lib/cluster";
import { buildPulsePayload } from "../lib/pulse";
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
    const expected = new Set((group as string[][]).map(([newsroom]) => newsroom));
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

test("names a mixed cluster by what its members share", () => {
  // Real cluster from the live panel. Trump's convention speech promised
  // $5,000 cheques and made the case for the Iran war, and newsrooms wrote
  // it up as one, the other, or both — so the grouping is defensible while
  // the label is not free: taking the best-placed copy titled the whole
  // thing "$5,000 'Dividend' Offer" while it held Iran war coverage. The
  // title has to describe what the cluster actually holds.
  const members = [
    ["The Atlantic", "Does Trump Want Republicans to Win the Midterms?"],
    ["TIME", "Trump Promises End to Iran War After Midterms"],
    ["TIME", "Trump Promises $5,000 Dividend if Republicans Win Both House and Senate"],
    ["Financial Times", "Trump promises $5,000 ‘dividend’ for US voters if Republicans win midterms"],
    ["CBS News", "Trump pitches $5,000 payments, but only if GOP wins House and Senate"],
    ["The Wall Street Journal", "Trump’s Top Advisers Confront Possibility That Iran War Lasts Through End of Term"],
    ["BBC News", "Iran war won't end until after crucial November elections, says Trump"],
    ["The Washington Post", "Trump makes case for Iran war, promises $5,000 payouts if GOP wins midterms"],
    ["The New York Times", "Some Republicans Balk at Trump’s $5,000 ‘Dividend’ Offer"],
    ["The New York Times", "Trump’s Midterm Pitch Clouded by Iran War and Canada Tariffs"],
    ["The New York Times", "Trump Floats $5,000 ‘Trump Dividend’ Checks if Republicans Win the Midterms"],
  ];

  const payload = buildPulsePayload(
    members.map(([newsroom, title], index) => ({
      url: `https://example.com/${index}`,
      title,
      newsroom,
      outletId: newsroom.toLowerCase(),
      tier: 1 as const,
      // The Atlantic's commentary is the best-placed copy, which is exactly
      // how a cluster ends up labelled by an outlier.
      slot: newsroom === "The Atlantic" ? 0 : index + 3,
      front: newsroom === "The Atlantic",
      seenAt: Date.now() - 3_600_000,
    })),
    [],
  );

  const cluster = payload.clusters[0];
  assert.ok(cluster, "the speech coverage clustered");
  // Whatever the grouping, the title must be about the thing most of the
  // cluster is about — the promise — and not the lone commentary headline.
  assert.notEqual(cluster.title, "Does Trump Want Republicans to Win the Midterms?");
  assert.match(cluster.title, /5,000|dividend|payments|payouts/i);
});
