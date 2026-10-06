import { neon } from "@neondatabase/serverless";
import { record } from "./db-meter";

/** A minimal query interface so tests can run against a local Postgres. */
export type Sql = (
  strings: TemplateStringsArray,
  ...values: unknown[]
) => Promise<Record<string, any>[]>;

let override: Sql | null = null;

/** Used by tests to point the storage layer at an embedded Postgres. */
export function setSqlForTesting(sql: Sql | null) {
  override = sql;
  ready = null;
}

export function databaseUrl() {
  return (
    process.env.POSTGRES_URL ??
    process.env.DATABASE_URL ??
    process.env.POSTGRES_PRISMA_URL ??
    null
  );
}

export function isConfigured() {
  return override !== null || databaseUrl() !== null;
}

export function getSql(): Sql {
  if (override) return override;
  const url = databaseUrl();
  if (!url) {
    throw new Error(
      "Sync is not configured: this deployment has no database connected.",
    );
  }
  const raw = neon(url) as unknown as Sql;
  // Every query is counted (lib/db-meter.ts): what went in, what came back, how long it took.
  return async (strings, ...values) => {
    const start = Date.now();
    const rows = await raw(strings, ...values);
    let sent = strings.reduce((n, s) => n + s.length, 0);
    for (const v of values) sent += typeof v === "string" ? v.length : JSON.stringify(v ?? null).length;
    record(sent, JSON.stringify(rows).length, Date.now() - start);
    return rows;
  };
}

let ready: Promise<void> | null = null;

/**
 * Create the table on first use. One small table keeps the whole feature
 * self-contained — no migration tooling for a single-document store.
 */
export function ensureSchema() {
  if (!ready) {
    const sql = getSql();
    ready = (async () => {
      await sql`
        CREATE TABLE IF NOT EXISTS feed_syncs (
          code_hash  TEXT PRIMARY KEY,
          payload    JSONB NOT NULL,
          updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
          created_at TIMESTAMPTZ NOT NULL DEFAULT now()
        )
      `;
      // Earlier feed lists, kept before anything is taken away (lib/sync.ts).
      await sql`
        CREATE TABLE IF NOT EXISTS sync_versions (
          id         BIGSERIAL PRIMARY KEY,
          code_hash  TEXT NOT NULL,
          saved_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
          folders    INT NOT NULL DEFAULT 0,
          sources    INT NOT NULL DEFAULT 0,
          teams      INT NOT NULL DEFAULT 0,
          payload    JSONB NOT NULL
        )
      `;
      await sql`CREATE INDEX IF NOT EXISTS sync_versions_code ON sync_versions (code_hash, id DESC)`;
    })().catch((error) => {
      // Let the next request retry rather than caching a failure forever.
      ready = null;
      throw error;
    });
  }
  return ready;
}
