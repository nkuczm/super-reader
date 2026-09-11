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
import { buildPulsePayload, PULSE_SHAPE } from "./pulse";
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
      // Added after the table shipped, so it is a separate statement rather
      // than a column in the CREATE above: an existing deployment's table is
      // never recreated.
      await sql`ALTER TABLE corpus_reddit ADD COLUMN IF NOT EXISTS title TEXT`;
      await sql`CREATE INDEX IF NOT EXISTS corpus_reddit_seen ON corpus_reddit (seen_at DESC)`;
      await sql`
        CREATE TABLE IF NOT EXISTS corpus_pulse (
          id          TEXT PRIMARY KEY,
          payload     JSONB NOT NULL,
          built_at    TIMESTAMPTZ NOT NULL DEFAULT now()
        )
      `;
      await sql`
        CREATE TABLE IF NOT EXISTS corpus_sources (
          id          TEXT PRIMARY KEY,
          ok          BOOLEAN NOT NULL,
          items       INTEGER,
          error       TEXT,
          fails       INTEGER NOT NULL DEFAULT 0,
          last_ok_at  TIMESTAMPTZ,
          checked_at  TIMESTAMPTZ NOT NULL DEFAULT now()
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
          INSERT INTO corpus_reddit (url, subreddit, weight, slot, title)
          VALUES (
            ${canonicalUrl(hit.url)}, ${hit.subreddit}, ${hit.weight}, ${hit.slot},
            ${hit.title ?? null}
          )
          ON CONFLICT (url, subreddit) DO UPDATE SET
            slot  = LEAST(corpus_reddit.slot, EXCLUDED.slot),
            title = COALESCE(NULLIF(corpus_reddit.title, ''), EXCLUDED.title)
        `,
      ),
    );
  }
  return hits.length;
}

/**
 * What each panel source did, the last time it was asked.
 *
 * Breadth is a count of newsrooms, so a panel feed that quietly stops
 * answering does not produce an error anyone sees — it lowers every score by
 * a little and keeps doing so. Recording the outcome per source is what makes
 * that visible: a feed with a growing failure count and a last-success time
 * from three days ago has rotted, and the directory entry needs fixing rather
 * than the ranking being mistrusted.
 *
 * `fails` counts consecutive failures, so one timeout reads differently from
 * a feed that has been gone all week.
 */
export async function recordSourceHealth(
  entries: { id: string; ok: boolean; items?: number; error?: string }[],
) {
  if (entries.length === 0) return;
  await ensureCorpusSchema();
  const sql = getSql();

  await Promise.all(
    entries.map(
      (entry) => sql`
        INSERT INTO corpus_sources (id, ok, items, error, fails, last_ok_at, checked_at)
        VALUES (
          ${entry.id}, ${entry.ok}, ${entry.items ?? null}, ${entry.error ?? null},
          ${entry.ok ? 0 : 1}, ${entry.ok ? new Date().toISOString() : null}, now()
        )
        ON CONFLICT (id) DO UPDATE SET
          ok         = EXCLUDED.ok,
          items      = EXCLUDED.items,
          error      = EXCLUDED.error,
          fails      = CASE WHEN EXCLUDED.ok THEN 0 ELSE corpus_sources.fails + 1 END,
          last_ok_at = CASE WHEN EXCLUDED.ok THEN now() ELSE corpus_sources.last_ok_at END,
          checked_at = now()
      `,
    ),
  );
}

export type SourceHealth = {
  id: string;
  ok: boolean;
  items?: number;
  error?: string;
  fails: number;
  lastOkAt?: string;
  checkedAt: string;
};

/** Every panel source's last outcome, the most broken first. */
export async function sourceHealth(): Promise<SourceHealth[]> {
  await ensureCorpusSchema();
  const sql = getSql();
  const rows = await sql`
    SELECT id, ok, items, error, fails, last_ok_at, checked_at
    FROM corpus_sources
    ORDER BY fails DESC, id
  `;
  return rows.map((row) => ({
    id: String(row.id),
    ok: Boolean(row.ok),
    items: row.items == null ? undefined : Number(row.items),
    error: row.error ? String(row.error) : undefined,
    fails: Number(row.fails),
    lastOkAt: row.last_ok_at ? new Date(row.last_ok_at).toISOString() : undefined,
    checkedAt: new Date(row.checked_at).toISOString(),
  }));
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

/**
 * Mark the built ranking as stale, so the next read rebuilds it.
 *
 * Without this a sweep's new stories sit unused until the cache expires —
 * most visible on an empty corpus, where the first sweep would land and the
 * app would still say it had nothing for another ten minutes.
 */
export async function invalidatePulse() {
  const sql = getSql();
  await sql`UPDATE corpus_pulse SET built_at = 'epoch' WHERE id = 'current'`;
}

/** Drop what has aged out. Cheap, and keeps the table from growing forever. */
export async function pruneCorpus() {
  const sql = getSql();
  await sql`DELETE FROM corpus_stories WHERE seen_at < now() - make_interval(days => ${RETAIN_DAYS})`;
  await sql`DELETE FROM corpus_reddit  WHERE seen_at < now() - make_interval(days => ${RETAIN_DAYS})`;
}

/**
 * Recent headlines, newest first — for auditing what clustering did with
 * them. Clustering quality is the whole feature, and it can only be judged
 * against real headlines, so there has to be a way to look at them.
 */
export async function sampleHeadlines(limit = 200) {
  await ensureCorpusSchema();
  const sql = getSql();
  const rows = await sql`
    SELECT title, newsroom FROM corpus_stories
    ORDER BY seen_at DESC, url LIMIT ${Math.min(limit, 500)}
  `;
  return rows.map((row) => ({ title: String(row.title), newsroom: String(row.newsroom) }));
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
    SELECT url, subreddit, weight, slot, title
    FROM corpus_reddit
    WHERE seen_at > now() - make_interval(hours => ${hours})
    LIMIT 20000
  `;
  return rows.map((row) => ({
    url: String(row.url),
    subreddit: String(row.subreddit),
    weight: Number(row.weight) as 1 | 2 | 3,
    slot: Number(row.slot),
    title: row.title ? String(row.title) : undefined,
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
      const payload = cached.payload as PulsePayload;
      const age = Date.now() - new Date(cached.built_at).getTime();
      // A cache built by an older build may not carry the fields this one
      // reads, and it outlives the deploy that wrote it.
      const current = payload?.shape === PULSE_SHAPE;
      if (current && age < PULSE_TTL_MS) return payload;
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
