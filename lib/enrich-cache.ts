/**
 * What gap-filling found for an article, kept so it is only ever found once.
 *
 * Enrichment is the slow part of a refresh: a feed that ships no images sends
 * lib/enrich.ts off to fetch fifteen article pages, and until this existed it
 * did that again on every refresh and threw the answer away. An article's
 * og:image and og:description do not change after publication, so the second
 * refresh should cost nothing.
 *
 * Storage is the Postgres the pulse already uses, and it is optional in the
 * same way: a deployment with no database configured gets every call as a
 * no-op and behaves exactly as it did before.
 */

import { getSql, isConfigured } from "./db";

export type Enrichment = {
  summary?: string;
  image?: string;
  publishedAt?: string;
};

/**
 * A page that gave us nothing is worth remembering too — it is the 9-second
 * timeout that hurts, and re-paying it every refresh for the same dead link
 * is the worst case. Kept briefly rather than forever, so a site that was
 * merely having a bad morning is tried again.
 */
const MISS_TTL = "6 hours";
const HIT_TTL = "30 days";

let ready: Promise<void> | null = null;

export function ensureEnrichSchema() {
  if (!ready) {
    const sql = getSql();
    ready = (async () => {
      await sql`
        CREATE TABLE IF NOT EXISTS enrich_cache (
          url          TEXT PRIMARY KEY,
          summary      TEXT,
          image        TEXT,
          published_at TEXT,
          fetched_at   TIMESTAMPTZ NOT NULL DEFAULT now()
        )
      `;
      await sql`
        CREATE INDEX IF NOT EXISTS enrich_cache_fetched ON enrich_cache (fetched_at)
      `;
    })().catch((error) => {
      // Let the next request retry rather than caching a failure forever.
      ready = null;
      throw error;
    });
  }
  return ready;
}

/**
 * What is already known about these URLs. Absent from the map means "never
 * looked"; present with empty fields means "looked, and the page had nothing".
 */
export async function readEnriched(
  urls: string[],
): Promise<Map<string, Enrichment>> {
  const found = new Map<string, Enrichment>();
  if (urls.length === 0 || !isConfigured()) return found;

  try {
    await ensureEnrichSchema();
    const sql = getSql();
    const rows = await sql`
      SELECT url, summary, image, published_at
      FROM enrich_cache
      WHERE url = ANY(${urls})
        AND fetched_at > now() - (
          CASE WHEN summary IS NULL AND image IS NULL AND published_at IS NULL
               THEN ${MISS_TTL}::interval
               ELSE ${HIT_TTL}::interval
          END
        )
    `;
    for (const row of rows) {
      found.set(String(row.url), {
        summary: row.summary ?? undefined,
        image: row.image ?? undefined,
        publishedAt: row.published_at ?? undefined,
      });
    }
  } catch {
    // The cache is an optimisation. A database that is down or unreachable
    // must cost a slow refresh, never a failed one.
  }
  return found;
}

/** Record what gap-filling found, so the next refresh does not go looking. */
export async function writeEnriched(
  entries: { url: string; found: Enrichment }[],
): Promise<number> {
  if (entries.length === 0 || !isConfigured()) return 0;

  try {
    await ensureEnrichSchema();
    const sql = getSql();
    let written = 0;
    // Batched the way the corpus writes are: one statement per row is too
    // many round trips, one statement for hundreds hits the parameter limit.
    for (let i = 0; i < entries.length; i += 25) {
      await Promise.all(
        entries.slice(i, i + 25).map(async ({ url, found }) => {
          await sql`
            INSERT INTO enrich_cache (url, summary, image, published_at, fetched_at)
            VALUES (
              ${url}, ${found.summary ?? null}, ${found.image ?? null},
              ${found.publishedAt ?? null}, now()
            )
            ON CONFLICT (url) DO UPDATE SET
              summary      = EXCLUDED.summary,
              image        = EXCLUDED.image,
              published_at = EXCLUDED.published_at,
              fetched_at   = now()
          `;
          written += 1;
        }),
      );
    }
    return written;
  } catch {
    return 0;
  }
}
