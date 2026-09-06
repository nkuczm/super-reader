import { getSql, ensureSchema } from "./db";
import { hashCode, newSyncCode } from "./sync-code";

export type SyncPayload = {
  feeds: unknown[];
  read?: string[];
  /**
   * The API-key vault, encrypted in the browser before it ever reaches here.
   * The server stores these bytes and cannot read them: it has no passphrase,
   * and this deployment is public, so anything it could read would be readable
   * by whoever holds the URL.
   */
  vault?: unknown;
};

export type SyncRecord = {
  payload: SyncPayload;
  updatedAt: string;
};

/** Keeps one device from filling the table with an oversized document. */
export const MAX_PAYLOAD_BYTES = 512 * 1024;

export async function createSync(): Promise<{ code: string }> {
  await ensureSchema();
  const sql = getSql();
  const code = newSyncCode();
  await sql`
    INSERT INTO feed_syncs (code_hash, payload)
    VALUES (${hashCode(code)}, ${JSON.stringify({ feeds: [] })}::jsonb)
  `;
  return { code };
}

export async function readSync(code: string): Promise<SyncRecord | null> {
  await ensureSchema();
  const sql = getSql();
  const rows = await sql`
    SELECT payload, updated_at
    FROM feed_syncs
    WHERE code_hash = ${hashCode(code)}
  `;
  if (rows.length === 0) return null;
  return {
    payload: rows[0].payload as SyncPayload,
    updatedAt: new Date(rows[0].updated_at).toISOString(),
  };
}

/**
 * Last write wins. Devices pull on load and on focus, so conflicting edits
 * need two devices changing feeds in the same moment; the cost of that is one
 * side's change, not the whole list.
 */
export async function writeSync(
  code: string,
  payload: SyncPayload,
): Promise<SyncRecord | null> {
  await ensureSchema();
  const sql = getSql();
  const rows = await sql`
    UPDATE feed_syncs
    SET payload = ${JSON.stringify(payload)}::jsonb, updated_at = now()
    WHERE code_hash = ${hashCode(code)}
    RETURNING updated_at
  `;
  if (rows.length === 0) return null;
  return {
    payload,
    updatedAt: new Date(rows[0].updated_at).toISOString(),
  };
}
