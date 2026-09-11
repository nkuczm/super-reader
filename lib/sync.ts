import { getSql, ensureSchema } from "./db";
import { hashCode, newSyncCode } from "./sync-code";
import { mergeSaved } from "./saved";
import type { SavedArticle, SavedRemoval } from "./saved";

export type SyncPayload = {
  feeds: unknown[];
  read?: string[];
  /**
   * Bookmarks, and the un-saves that must outlive a device that still holds
   * the article. Unlike the rest of this document these are merged rather
   * than replaced — see lib/saved.ts for why.
   */
  saved?: SavedArticle[];
  savedRemovals?: SavedRemoval[];
  /**
   * The API-key vault, encrypted in the browser before it ever reaches here.
   * The server stores these bytes and cannot read them: it has no passphrase,
   * and this deployment is public, so anything it could read would be readable
   * by whoever holds the URL.
   */
  vault?: unknown;
  /**
   * When this data last changed, on the device that changed it. The rule is
   * "most recent change wins" rather than "last write wins": a device that has
   * been closed for a week must not overwrite what happened since, however
   * long after the fact it reconnects.
   */
  updatedAt?: number;
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

export class StaleWrite extends Error {
  constructor(readonly current: SyncRecord) {
    super("This device's copy is older than what is already synced.");
    this.name = "StaleWrite";
  }
}

/**
 * Most recent change wins. A write carrying an older change time than the one
 * already stored is refused, and the caller is handed what is there instead —
 * which is what a device that has been away needs anyway.
 *
 * Two devices editing within the same moment still resolve by whichever
 * change is stamped later; the cost of that is one side's edit, not the list.
 */
export async function writeSync(
  code: string,
  payload: SyncPayload,
): Promise<SyncRecord | null> {
  const existing = await readSync(code);
  if (existing) {
    const theirs = Number(existing.payload?.updatedAt ?? 0);
    const ours = Number(payload.updatedAt ?? 0);
    if (theirs > ours) throw new StaleWrite(existing);
  }

  // Bookmarks are merged into what is stored, not swapped for it. Two
  // devices can each add something between syncs, and whichever pushes
  // second would otherwise delete the other's — the stamps say which
  // arrangement of the feed list is newer, but they cannot say that one
  // device's bookmarks matter less.
  const stored = existing?.payload ?? { feeds: [] };
  const bookmarks = mergeSaved(
    { saved: payload.saved ?? [], removals: payload.savedRemovals ?? [] },
    { saved: stored.saved ?? [], removals: stored.savedRemovals ?? [] },
  );
  const merged: SyncPayload = {
    ...payload,
    saved: bookmarks.saved,
    savedRemovals: bookmarks.removals,
  };

  await ensureSchema();
  const sql = getSql();
  const rows = await sql`
    UPDATE feed_syncs
    SET payload = ${JSON.stringify(merged)}::jsonb, updated_at = now()
    WHERE code_hash = ${hashCode(code)}
    RETURNING updated_at
  `;
  if (rows.length === 0) return null;
  return {
    payload: merged,
    updatedAt: new Date(rows[0].updated_at).toISOString(),
  };
}
