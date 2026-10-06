/**
 * What AI runs have cost, kept per sync code so every device on it counts
 * toward one total. Records carry token counts and an estimated cost — never
 * a key, a prompt or a reply. Each run has its own id, so a device sending its
 * history twice adds nothing.
 */

import { ensureSchema, getSql } from "./db";
import { hashCode } from "./sync-code";
import { isActivity, type SpendRecord } from "./spend";

const MAX_KEPT = 5000;

let ready: Promise<void> | null = null;
async function ensureLedger() {
  await ensureSchema();
  if (!ready) {
    ready = (async () => {
      await getSql()`
        CREATE TABLE IF NOT EXISTS spend_ledger (
          code_hash TEXT NOT NULL,
          id        TEXT NOT NULL,
          at        BIGINT NOT NULL,
          record    JSONB NOT NULL,
          PRIMARY KEY (code_hash, id)
        )
      `;
    })().catch((error) => {
      ready = null;
      throw error;
    });
  }
  return ready;
}

/** Only what a spend record should hold, whatever was sent. */
function clean(r: Partial<SpendRecord>): SpendRecord | null {
  if (!r || typeof r.id !== "string" || !r.id || typeof r.at !== "number") return null;
  const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : 0);
  return {
    id: r.id.slice(0, 80),
    device: typeof r.device === "string" ? r.device.slice(0, 40) : undefined,
    at: r.at,
    provider: r.provider === "openai" ? "openai" : "anthropic",
    model: typeof r.model === "string" ? r.model.slice(0, 80) : "unknown",
    input: num(r.input),
    output: num(r.output),
    cost: typeof r.cost === "number" && Number.isFinite(r.cost) && r.cost >= 0 ? r.cost : null,
    subject: typeof r.subject === "string" ? r.subject.slice(0, 120) : undefined,
    ...(isActivity(r.activity) ? { activity: r.activity } : {}),
  };
}

export async function addSpend(code: string, records: Partial<SpendRecord>[]) {
  await ensureLedger();
  const sql = getSql();
  const key = hashCode(code);
  for (const raw of records.slice(0, 2000)) {
    const r = clean(raw);
    if (!r) continue;
    await sql`
      INSERT INTO spend_ledger (code_hash, id, at, record) VALUES (${key}, ${r.id!}, ${r.at}, ${JSON.stringify(r)}::jsonb)
      ON CONFLICT (code_hash, id) DO NOTHING
    `;
  }
}

export async function listSpend(code: string): Promise<SpendRecord[]> {
  await ensureLedger();
  const rows = await getSql()`
    SELECT record FROM spend_ledger WHERE code_hash = ${hashCode(code)} ORDER BY at DESC LIMIT ${MAX_KEPT}
  `;
  return rows.map((row) => row.record as SpendRecord).reverse();
}
