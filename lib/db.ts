import { neon } from "@neondatabase/serverless";

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
  return neon(url) as unknown as Sql;
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
    })().catch((error) => {
      // Let the next request retry rather than caching a failure forever.
      ready = null;
      throw error;
    });
  }
  return ready;
}
