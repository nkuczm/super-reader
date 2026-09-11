/**
 * Storage for the story corpus.
 *
 * The corpus is shared, not per-reader: "how many newsrooms ran this" is a
 * fact about the press, so it is swept once for the whole deployment and
 * every reader is ranked against the same picture. It lives in the same
 * Postgres the sync codes use — see lib/db.ts — and is created on first use
 * rather than through migration tooling, to match how that table is managed.
 *
 * Nothing here is per-person: a row is a published article and where it sat
 * on a public site. Reader activity is never recorded.
 */

import { ensureSchema as ensureSyncSchema, getSql, isConfigured } from "./db";
import { buildPulsePayload } from "./pulse";
import type { CorpusRedditHit, CorpusStory, PulsePayload } from "./pulse";
import { canonicalUrl } from "./pulse";

export { isConfigured as corpusAvailable };

/** How far back a sweep's rows stay interesting. */
export const WINDOW_HOURS = 48;
/** Rows older than this are dropped: the corpus is a window, not an archive. */
const RETAIN_DAYS = 10;
/** How long a built ranking is served before it is rebuilt. */
export const PULSE_TTL_MS = 10 * 60 * 1000;

let ready: Promise<void> | null = null;

export function ensureCorpusSchema() {
  if (!ready) {
    const sql = getSql();
    ready = (async () => {
      await ensureSyncSchema();
      await sql`
        CREATE TABLE IF NOT EXISTS corpus_stories (
          url          TEXT PRIMARY KEY,
          title        TEXT NOT NULL,
          newsroom     TEXT NOT NULL,
          outlet_id    TEXT NOT NULL,
          tier         SMALLINT NOT NULL,
          slot         SMALLINT NOT NULL,
          front        BOOLEAN NOT NULL DEFAULT false,
          comments     INTEGER,
          published_at TIMESTAMPTZ,
          seen_at      TIMESTAMPTZ NOT NULL DEFAULT now()
        )
      `;
      await sql`CREATE INDEX IF NOT EXISTS corpus_stories_seen ON corpus_stories (seen_at DESC)`;
      await sql`
        CREATE TABLE IF NOT EXISTS corpus_reddit (
          url       TEXT NOT NULL,
          subreddit TEXT NOT NULL,
          weight    SMALLINT NOT NULL,
          slot      SMALLINT NOT NULL,
          seen_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
          PRIMARY KEY (url, subreddit)
        )
      `;
      await sql`CREATE INDEX IF NOT EXISTS corpus_reddit_seen ON corpus_reddit (seen_at DESC)`;
      await sql`
        CREATE TABLE IF NOT EXISTS corpus_pulse (
          id          TEXT PRIMARY KEY,
          payload     JSONB NOT NULL,
          built_at    TIMESTAMPTZ NOT NULL DEFAULT now()
        )
      `;
      await sql`
        CREATE TABLE IF NOT EXISTS corpus_sweeps (
          slice   TEXT PRIMARY KEY,
          ran_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
          note    TEXT
        )
      `;
    })().catch((error) => {
      ready = null;
      throw error;
    });
  }
  return ready;
}

/**
 * Record what a sweep saw.
 *
 * An article can turn up in several of an outlet's feeds and in several
 * sweeps. The row keeps the *best* evidence rather than the latest: the
 * highest placement it ever reached, whether it was ever on a front page,
 * the most comments seen, and the earliest sighting — which is what the
 * velocity signal is measured from.
 */
export async function recordStories(stories: CorpusStory[]) {
  if (stories.length === 0) return 0;
  await ensureCorpusSchema();
  const sql = getSql();

  let written = 0;
  // Small batches: one statement per row is too many round trips, and one
  // statement for hundreds of rows hits the driver's parameter limit.
  for (let i = 0; i < stories.length; i += 25) {
    const batch = stories.slice(i, i + 25);
    await Promise.all(
      batch.map(async (story) => {
        await sql`
          INSERT INTO corpus_stories
            (url, title, newsroom, outlet_id, tier, slot, front, comments, published_at, seen_at)
          VALUES (
            ${canonicalUrl(story.url)}, ${story.title}, ${story.newsroom}, ${story.outletId},
            ${story.tier}, ${story.slot}, ${story.front}, ${story.comments ?? null},
            ${story.publishedAt ?? null}, ${new Date(story.seenAt).toISOString()}
          )
          ON CONFLICT (url) DO UPDATE SET
            slot     = LEAST(corpus_stories.slot, EXCLUDED.slot),
            front    = corpus_stories.front OR EXCLUDED.front,
            comments = GREATEST(COALESCE(corpus_stories.comments, 0), COALESCE(EXCLUDED.comments, 0)),
            seen_at  = LEAST(corpus_stories.seen_at, EXCLUDED.seen_at),
            title    = COALESCE(NULLIF(corpus_stories.title, ''), EXCLUDED.title)
        `;
        written += 1;
      }),
    );
  }
  return written;
}

export async function recordRedditHits(hits: CorpusRedditHit[]) {
  if (hits.length === 0) return 0;
  await ensureCorpusSchema();
  const sql = getSql();
  for (let i = 0; i < hits.length; i += 25) {
    await Promise.all(
      hits.slice(i, i + 25).map(
        (hit) => sql`
          INSERT INTO corpus_reddit (url, subreddit, weight, slot)
          VALUES (${canonicalUrl(hit.url)}, ${hit.subreddit}, ${hit.weight}, ${hit.slot})
          ON CONFLICT (url, subreddit) DO UPDATE SET
            slot = LEAST(corpus_reddit.slot, EXCLUDED.slot)
        `,
      ),
    );
  }
  return hits.length;
}

export async function noteSweep(slice: string, note: string) {
  await ensureCorpusSchema();
  const sql = getSql();
  await sql`
    INSERT INTO corpus_sweeps (slice, ran_at, note)
    VALUES (${slice}, now(), ${note})
    ON CONFLICT (slice) DO UPDATE SET ran_at = now(), note = EXCLUDED.note
  `;
}

export async function lastSweeps() {
  await ensureCorpusSchema();
  const sql = getSql();
  const rows = await sql`SELECT slice, ran_at, note FROM corpus_sweeps ORDER BY ran_at DESC`;
  return rows.map((row) => ({
    slice: String(row.slice),
    ranAt: new Date(row.ran_at).toISOString(),
    note: row.note ? String(row.note) : undefined,
  }));
}

/** Drop what has aged out. Cheap, and keeps the table from growing forever. */
export async function pruneCorpus() {
  const sql = getSql();
  await sql`DELETE FROM corpus_stories WHERE seen_at < now() - make_interval(days => ${RETAIN_DAYS})`;
  await sql`DELETE FROM corpus_reddit  WHERE seen_at < now() - make_interval(days => ${RETAIN_DAYS})`;
}

async function recentStories(hours: number): Promise<CorpusStory[]> {
  const sql = getSql();
  const rows = await sql`
    SELECT url, title, newsroom, outlet_id, tier, slot, front, comments, seen_at
    FROM corpus_stories
    WHERE seen_at > now() - make_interval(hours => ${hours})
    ORDER BY seen_at DESC
    LIMIT 20000
  `;
  return rows.map((row) => ({
    url: String(row.url),
    title: String(row.title),
    newsroom: String(row.newsroom),
    outletId: String(row.outlet_id),
    tier: Number(row.tier) as 1 | 2 | 3,
    slot: Number(row.slot),
    front: Boolean(row.front),
    comments: row.comments == null ? undefined : Number(row.comments),
    seenAt: new Date(row.seen_at).getTime(),
  }));
}

async function recentReddit(hours: number): Promise<CorpusRedditHit[]> {
  const sql = getSql();
  const rows = await sql`
    SELECT url, subreddit, weight, slot
    FROM corpus_reddit
    WHERE seen_at > now() - make_interval(hours => ${hours})
    LIMIT 20000
  `;
  return rows.map((row) => ({
    url: String(row.url),
    subreddit: String(row.subreddit),
    weight: Number(row.weight) as 1 | 2 | 3,
    slot: Number(row.slot),
  }));
}

/**
 * The current ranking, rebuilt at most every PULSE_TTL_MS.
 *
 * Clustering the whole corpus takes long enough that doing it per reader
 * would be the slowest thing in the app, so the built payload is cached in
 * the database — shared across serverless instances, which an in-process
 * cache would not be.
 */
export async function readPulse({ force = false } = {}): Promise<PulsePayload> {
  await ensureCorpusSchema();
  const sql = getSql();

  if (!force) {
    const [cached] = await sql`
      SELECT payload, built_at FROM corpus_pulse WHERE id = 'current'
    `;
    if (cached) {
      const age = Date.now() - new Date(cached.built_at).getTime();
      if (age < PULSE_TTL_MS) return cached.payload as PulsePayload;
    }
  }

  const [stories, reddit] = await Promise.all([
    recentStories(WINDOW_HOURS),
    recentReddit(WINDOW_HOURS),
  ]);
  const payload = buildPulsePayload(stories, reddit);

  await sql`
    INSERT INTO corpus_pulse (id, payload, built_at)
    VALUES ('current', ${JSON.stringify(payload)}::jsonb, now())
    ON CONFLICT (id) DO UPDATE SET payload = EXCLUDED.payload, built_at = now()
  `;
  return payload;
}
