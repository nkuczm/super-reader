/**
 * The library's rows (lib/library.ts): one per bookmark, pasted story and
 * highlight, keyed by account, kind and key, encrypted at rest like the
 * subjects. A write replaces a row only with a newer change of it. Every
 * write takes a fresh number from one sequence, so "what changed since I
 * last looked" is a single range read.
 */

import { getSql } from "./db";
import { ensureAccountSchema } from "./accounts";
import { openJson, sealJson } from "./secure";
import { cleanItem, itemId, type LibraryItem } from "./library";

let ready: Promise<void> | null = null;

export function ensureLibrarySchema() {
  ready ??= (async () => {
    await ensureAccountSchema();
    const sql = getSql();
    await sql`CREATE SEQUENCE IF NOT EXISTS account_items_seq`;
    await sql`
      CREATE TABLE IF NOT EXISTS account_items (
        account_id  TEXT NOT NULL,
        kind        TEXT NOT NULL,
        key         TEXT NOT NULL,
        at          BIGINT NOT NULL,
        seq         BIGINT NOT NULL DEFAULT nextval('account_items_seq'),
        payload     TEXT NOT NULL,
        PRIMARY KEY (account_id, kind, key)
      )
    `;
    await sql`CREATE INDEX IF NOT EXISTS account_items_by_seq ON account_items (account_id, seq)`;
  })().catch((error) => {
    ready = null;
    throw error;
  });
  return ready;
}

/** Store a device's changed items; each replaces the account's copy only if it is newer. Answers with how many were taken. */
export async function writeLibrary(accountId: string, incoming: unknown[]): Promise<number> {
  await ensureLibrarySchema();
  // One row per item: the newest change of each, should a batch carry two.
  const items = new Map<string, LibraryItem>();
  for (const value of incoming) {
    const item = cleanItem(value);
    if (!item) continue;
    const held = items.get(itemId(item));
    if (!held || item.at > held.at) items.set(itemId(item), item);
  }
  if (!items.size) return 0;
  const list = [...items.values()];
  const rows = await getSql()`
    INSERT INTO account_items (account_id, kind, key, at, payload)
    SELECT ${accountId}, t.kind, t.key, t.at, t.payload
    FROM UNNEST(
      ${list.map((i) => i.kind)}::text[],
      ${list.map((i) => i.key)}::text[],
      ${list.map((i) => i.at)}::bigint[],
      ${list.map((i) => sealJson(i.data))}::text[]
    ) AS t(kind, key, at, payload)
    ON CONFLICT (account_id, kind, key) DO UPDATE
      SET at = EXCLUDED.at, payload = EXCLUDED.payload, seq = nextval('account_items_seq')
      WHERE account_items.at < EXCLUDED.at
    RETURNING 1
  `;
  return rows.length;
}

/** An answer stays well inside what a function may return; the device asks again from the cursor. */
const PAGE_ROWS = 400;
const PAGE_BYTES = 2_500_000;

/** Items changed after `since` (all of them without), oldest change first, a page at a time. */
export async function readLibrary(
  accountId: string,
  since: string | null,
): Promise<{ items: LibraryItem[]; cursor: string | null; more: boolean }> {
  await ensureLibrarySchema();
  const after = since && /^\d{1,18}$/.test(since) ? since : "0";
  const rows = await getSql()`
    SELECT kind, key, at, seq, payload FROM account_items
    WHERE account_id = ${accountId} AND seq > ${after}
    ORDER BY seq
    LIMIT ${PAGE_ROWS}
  `;
  const items: LibraryItem[] = [];
  let bytes = 0;
  let cursor: string | null = since && /^\d{1,18}$/.test(since) ? since : null;
  let cut = false;
  for (const row of rows) {
    const payload = String(row.payload);
    if (items.length && bytes + payload.length > PAGE_BYTES) {
      cut = true;
      break;
    }
    items.push({ kind: row.kind, key: row.key, at: Number(row.at), data: openJson(payload) });
    bytes += payload.length;
    cursor = String(row.seq);
  }
  return { items, cursor, more: cut || rows.length === PAGE_ROWS };
}
