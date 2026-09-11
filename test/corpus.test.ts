import test from "node:test";
import assert from "node:assert/strict";
import { PGlite } from "@electric-sql/pglite";
import { setSqlForTesting, type Sql } from "../lib/db";
import {
  ensureCorpusSchema,
  recordStories,
  recordRedditHits,
  readPulse,
  noteSweep,
  lastSweeps,
} from "../lib/corpus";
import type { CorpusStory } from "../lib/pulse";

// The real SQL against a real Postgres, in-process — same approach as the
// sync tests, because the interesting part here is the upsert behaviour.
let db: PGlite;

test.before(async () => {
  db = new PGlite();
  const sql: Sql = async (strings, ...values) => {
    const text = strings.reduce(
      (acc, part, i) => acc + part + (i < values.length ? `$${i + 1}` : ""),
      "",
    );
    const result = await db.query(text, values as any[]);
    return result.rows as Record<string, any>[];
  };
  setSqlForTesting(sql);
  await ensureCorpusSchema();
});

test.after(async () => {
  setSqlForTesting(null);
  await db.close();
});

const NOW = Date.now();

function story(over: Partial<CorpusStory> & { url: string; title: string; newsroom: string }): CorpusStory {
  return {
    outletId: over.newsroom.toLowerCase().replace(/\W+/g, "-"),
    tier: 1,
    slot: 3,
    front: false,
    seenAt: NOW - 3600_000,
    ...over,
  };
}

test("keeps the best evidence when the same article is seen again", async () => {
  const url = "https://apnews.com/article/keeps-best";
  await recordStories([
    story({ url, title: "Senate passes the bill", newsroom: "AP", slot: 9, front: false, comments: 4 }),
  ]);
  // A later sweep finds it higher up, on a front page, with more comments —
  // and one sweep seeing it lower must not undo that.
  await recordStories([
    story({ url: `${url}?utm_source=x`, title: "Senate passes the bill", newsroom: "AP", slot: 1, front: true, comments: 60, seenAt: NOW }),
    story({ url, title: "Senate passes the bill", newsroom: "AP", slot: 15, front: false, comments: 2, seenAt: NOW }),
  ]);

  const [row] = await db.query<{ slot: number; front: boolean; comments: number; seen_at: Date }>(
    "SELECT slot, front, comments, seen_at FROM corpus_stories WHERE url = $1",
    [url],
  ).then((r) => r.rows);
  assert.equal(row.slot, 1, "keeps the highest placement it ever reached");
  assert.equal(row.front, true, "once on a front page, always on a front page");
  assert.equal(row.comments, 60, "keeps the largest comment count seen");
  // The earliest sighting is what velocity is measured from.
  assert.ok(new Date(row.seen_at).getTime() <= NOW - 3600_000 + 1000);
});

test("one row per article however its URL is dressed up", async () => {
  const rows = await db.query<{ n: number }>(
    "SELECT count(*)::int AS n FROM corpus_stories WHERE url LIKE '%keeps-best%'",
  ).then((r) => r.rows);
  assert.equal(rows[0].n, 1);
});

test("builds and caches a ranking readers can be scored against", async () => {
  await recordStories([
    story({ url: "https://apnews.com/x1", title: "Court blocks the mining permit in Nevada", newsroom: "AP", slot: 0, front: true }),
    story({ url: "https://reuters.com/x2", title: "US court blocks Nevada mining permit", newsroom: "Reuters", slot: 1, front: true }),
    story({ url: "https://bbc.com/x3", title: "Nevada mining permit blocked by court", newsroom: "BBC News", slot: 2, front: true }),
  ]);
  await recordRedditHits([
    { url: "https://apnews.com/x1", subreddit: "news", weight: 1, slot: 2 },
  ]);

  const payload = await readPulse({ force: true });
  const cluster = payload.clusters.find((c) => c.newsrooms.includes("Reuters"));
  assert.ok(cluster, "the three copies became one ranked story");
  assert.equal(cluster.newsrooms.length, 3);
  assert.match(cluster.reasons.join(" "), /3 newsrooms covering it/);

  // Cached: a second read without force returns the same build rather than
  // clustering the corpus again.
  const again = await readPulse();
  assert.equal(again.builtAt, payload.builtAt);
});

test("records what each sweep did, for checking the directory's health", async () => {
  await noteSweep("slice-0", "120 stories, 3 failed");
  await noteSweep("slice-0", "125 stories");
  const sweeps = await lastSweeps();
  const mine = sweeps.filter((sweep) => sweep.slice === "slice-0");
  assert.equal(mine.length, 1, "one row per slice, updated in place");
  assert.equal(mine[0].note, "125 stories");
});
