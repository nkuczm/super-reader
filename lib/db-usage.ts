/**
 * The database's bill, as this app causes it: per request, the bytes that
 * crossed to and from Neon, kept as one row per day, part of the app and
 * account. Neon's own dashboard has the true totals; this says where they
 * come from.
 *
 * Prices are Neon's Launch plan (neon.com/pricing, checked 6 Oct 2026).
 */

import { after } from "next/server";
import { getSql } from "./db";
import { meterStore, type Meter } from "./db-meter";

export const NEON_PRICES = {
  /** $ per CU-hour of compute. */
  compute: 0.106,
  /** $ per GB-month stored. */
  storage: 0.35,
  /** $ per GB-month of restore history. */
  history: 0.2,
  /** GB of network transfer included each month, then $ per GB. */
  transferIncluded: 500,
  transfer: 0.1,
  /** The Free plan's monthly allowance of transfer. */
  freeTransfer: 5,
} as const;

export const CATEGORY_NAME: Record<string, string> = {
  subjects: "Saving & loading subjects",
  history: "Version history & restore",
  backup: "Google Docs backups",
  sync: "Device sync (feeds, saved, read marks)",
  inbox: "Chrome extension inbox",
  team: "Teams",
  spend: "AI spending ledger",
  auth: "Sign-in & sessions",
  pulse: "News index (Pulse)",
  settings: "Settings & API keys",
  usage: "This usage page",
};

/** Count this request's database use under `category`, and store it once the response has gone. */
export function meter(category: string) {
  const m: Meter = { category, account: null, bytesIn: 0, bytesOut: 0, queries: 0, ms: 0 };
  meterStore.enterWith(m);
  try {
    after(() => meterStore.exit(() => flush(m)));
  } catch {
    /* outside a request (tests): nothing to store */
  }
}

let ready: Promise<unknown> | null = null;
function ensureUsageSchema() {
  ready ??= getSql()`
    CREATE TABLE IF NOT EXISTS db_usage (
      day        DATE NOT NULL,
      category   TEXT NOT NULL,
      account_id TEXT NOT NULL DEFAULT '',
      bytes_in   BIGINT NOT NULL DEFAULT 0,
      bytes_out  BIGINT NOT NULL DEFAULT 0,
      queries    INTEGER NOT NULL DEFAULT 0,
      ms         BIGINT NOT NULL DEFAULT 0,
      requests   INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (day, category, account_id)
    )
  `.catch((e) => {
    ready = null;
    throw e;
  });
  return ready;
}

export async function flush(m: Meter) {
  if (!m.queries) return;
  try {
    await ensureUsageSchema();
    await getSql()`
      INSERT INTO db_usage (day, category, account_id, bytes_in, bytes_out, queries, ms, requests)
      VALUES (current_date, ${m.category}, ${m.account ?? ""}, ${m.bytesIn}, ${m.bytesOut}, ${m.queries}, ${m.ms}, 1)
      ON CONFLICT (day, category, account_id) DO UPDATE SET
        bytes_in = db_usage.bytes_in + EXCLUDED.bytes_in,
        bytes_out = db_usage.bytes_out + EXCLUDED.bytes_out,
        queries = db_usage.queries + EXCLUDED.queries,
        ms = db_usage.ms + EXCLUDED.ms,
        requests = db_usage.requests + 1
    `;
  } catch {
    /* counting must never break the app */
  }
}

export type UsageRow = { category: string; name: string; bytesIn: number; bytesOut: number; queries: number; requests: number; ms: number; mine: number };
export type UsageReport = {
  since: string;
  rows: UsageRow[];
  days: { day: string; bytes: number }[];
  storage: { total: number; tables: { name: string; bytes: number }[] };
  prices: typeof NEON_PRICES;
};

/** This month so far, by part of the app; the account's own share; and what is stored now. */
export async function usageReport(accountId: string): Promise<UsageReport> {
  await ensureUsageSchema();
  const sql = getSql();
  const rows = await sql`
    SELECT category,
      sum(bytes_in)::bigint AS bytes_in, sum(bytes_out)::bigint AS bytes_out,
      sum(queries)::int AS queries, sum(requests)::int AS requests, sum(ms)::bigint AS ms,
      sum(CASE WHEN account_id = ${accountId} THEN bytes_in + bytes_out ELSE 0 END)::bigint AS mine
    FROM db_usage WHERE day >= date_trunc('month', current_date)
    GROUP BY category
  `;
  const days = await sql`
    SELECT day, sum(bytes_in + bytes_out)::bigint AS bytes FROM db_usage
    WHERE day >= date_trunc('month', current_date) GROUP BY day ORDER BY day
  `;
  const tables = await sql`
    SELECT relname AS name, pg_total_relation_size(c.oid)::bigint AS bytes
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relkind = 'r'
    ORDER BY 2 DESC
  `;
  const total = await sql`SELECT pg_database_size(current_database())::bigint AS bytes`;
  const start = new Date();
  return {
    since: new Date(start.getFullYear(), start.getMonth(), 1).toISOString().slice(0, 10),
    rows: rows
      .map((r) => ({
        category: String(r.category),
        name: CATEGORY_NAME[String(r.category)] ?? String(r.category),
        bytesIn: Number(r.bytes_in),
        bytesOut: Number(r.bytes_out),
        queries: Number(r.queries),
        requests: Number(r.requests),
        ms: Number(r.ms),
        mine: Number(r.mine),
      }))
      .sort((a, b) => b.bytesIn + b.bytesOut - (a.bytesIn + a.bytesOut)),
    days: days.map((d) => ({ day: new Date(d.day).toISOString().slice(0, 10), bytes: Number(d.bytes) })),
    storage: { total: Number(total[0]?.bytes ?? 0), tables: tables.map((t) => ({ name: String(t.name), bytes: Number(t.bytes) })) },
    prices: NEON_PRICES,
  };
}
