import { getSql, ensureSchema } from "./db";
import { hashCode, newSyncCode } from "./sync-code";
import { isLinkedCode, type SubjectsDoc } from "./accounts";
import { feedsSummary, losesSomething, mergeSyncDocs, versionOf, type SyncPayload } from "./sync-doc";

export { MAX_PAYLOAD_BYTES } from "./sync-doc";
export type { SyncPayload } from "./sync-doc";

export type SyncRecord = {
  payload: SyncPayload;
  updatedAt: string;
  /** The code is tied to a Google account: subjects live there, and only a signed-in device sees them. */
  inAccount?: boolean;
};

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
  const payload = rows[0].payload as SyncPayload;
  const inAccount = await isLinkedCode(code);
  if (inAccount) withoutWriting(payload);
  return {
    payload,
    updatedAt: new Date(rows[0].updated_at).toISOString(),
    ...(inAccount ? { inAccount: true } : {}),
  };
}

/**
 * Merge a device's copy into what is stored. Nothing is refused: the feed
 * list, read marks, team list and vault each go to whichever side changed
 * that part last, and everything else is the union of both (lib/sync-doc.ts).
 * What is now held comes back, so the device can take the parts it was
 * behind on.
 *
 * Before a change takes a folder, a source, a team or the vault away — and
 * otherwise every half hour of changes — the previous feed list is kept as a
 * version, so a list overwritten by mistake can be brought back.
 */
export async function writeSync(
  code: string,
  payload: SyncPayload,
): Promise<SyncRecord | null> {
  const existing = await readSync(code);
  if (!existing) return null;
  const stored = existing.payload;
  const merged = mergeSyncDocs(payload, stored);
  // A code tied to a Google account carries no writing: subjects and notes
  // live with the account (lib/accounts.ts), where a code alone cannot reach
  // them. Anything an older device still sends is dropped, not stored.
  if (existing.inAccount) withoutWriting(merged);

  await ensureSchema();
  const sql = getSql();
  await keepVersion(code, stored, merged);
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
    ...(existing.inAccount ? { inAccount: true } : {}),
  };
}

/* ---------- versions of the feed list ---------- */

/** Changes that take nothing away are kept at most this often. */
export const VERSION_EVERY_MS = 30 * 60 * 1000;
const VERSION_KEEP_DAYS = 400;

async function keepVersion(code: string, before: SyncPayload, after: SyncPayload) {
  const was = versionOf(before);
  if (!was.feeds.length && !was.teams.length && was.vault === undefined) return;
  if (JSON.stringify(was) === JSON.stringify(versionOf(after))) return;
  const sql = getSql();
  const codeHash = hashCode(code);
  if (!losesSomething(before, after)) {
    const last = await sql`SELECT saved_at FROM sync_versions WHERE code_hash = ${codeHash} ORDER BY id DESC LIMIT 1`;
    if (last[0] && Date.now() - new Date(last[0].saved_at).getTime() < VERSION_EVERY_MS) return;
  }
  const { folders, sources } = feedsSummary(was.feeds);
  await sql`
    INSERT INTO sync_versions (code_hash, folders, sources, teams, payload)
    VALUES (${codeHash}, ${folders}, ${sources}, ${was.teams.length}, ${JSON.stringify(was)}::jsonb)
  `;
  await sql`DELETE FROM sync_versions WHERE code_hash = ${codeHash} AND saved_at < now() - make_interval(days => ${VERSION_KEEP_DAYS})`;
}

export type SyncVersion = { id: string; savedAt: string; folders: number; sources: number; teams: number };

/** Earlier feed lists for a code, newest first. */
export async function listSyncVersions(code: string, limit = 100): Promise<SyncVersion[]> {
  await ensureSchema();
  const rows = await getSql()`
    SELECT id, saved_at, folders, sources, teams FROM sync_versions
    WHERE code_hash = ${hashCode(code)} ORDER BY id DESC LIMIT ${limit}
  `;
  return rows.map((r) => ({
    id: String(r.id),
    savedAt: new Date(r.saved_at).toISOString(),
    folders: Number(r.folders),
    sources: Number(r.sources),
    teams: Number(r.teams),
  }));
}

/** One earlier feed list: its folders and sources, teams, and vault. */
export async function readSyncVersion(code: string, id: string): Promise<ReturnType<typeof versionOf> | null> {
  if (!/^\d{1,18}$/.test(id)) return null;
  await ensureSchema();
  const rows = await getSql()`SELECT payload FROM sync_versions WHERE code_hash = ${hashCode(code)} AND id = ${id}`;
  return rows[0] ? (rows[0].payload as ReturnType<typeof versionOf>) : null;
}

function withoutWriting(payload: SyncPayload) {
  delete payload.notes;
  delete payload.noteRemovals;
  delete payload.boards;
}

/**
 * Move the writing out of a sync document, for an account that has just been
 * linked to its code. Returns what was there so it can be merged into the
 * account; the sync document keeps everything else.
 */
export async function detachWriting(code: string): Promise<SubjectsDoc> {
  await ensureSchema();
  const sql = getSql();
  const rows = await sql`SELECT payload FROM feed_syncs WHERE code_hash = ${hashCode(code)}`;
  const payload = (rows[0]?.payload ?? {}) as SyncPayload;
  const writing: SubjectsDoc = {
    notes: payload.notes ?? [],
    noteRemovals: payload.noteRemovals ?? [],
    boards: payload.boards ?? {},
  };
  if (rows[0]) {
    withoutWriting(payload);
    await sql`
      UPDATE feed_syncs SET payload = ${JSON.stringify(payload)}::jsonb
      WHERE code_hash = ${hashCode(code)}
    `;
  }
  return writing;
}
