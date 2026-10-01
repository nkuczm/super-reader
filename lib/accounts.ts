/**
 * Google accounts, their sessions, and the writing that belongs to them.
 *
 * Subjects and notes are the part of the reader that is the person's own
 * work, so they no longer ride on a sync code — a code is a bearer secret, and
 * anyone holding it could read them. Once someone signs in with Google, their
 * subjects live here: keyed to the account, encrypted at rest (lib/secure.ts),
 * readable only through a signed-in session. Feeds, bookmarks and the rest
 * still sync by code, and the code is linked to the account so every device
 * that signs in picks it up.
 *
 * Every write is merged into what is stored (the same merge sync uses, so two
 * devices never overwrite each other) and kept as a version: every save for
 * thirty days, then one per day for good.
 */

import { getSql, ensureSchema as ensureSyncSchema } from "./db";
import { open, openJson, randomToken, seal, sealJson, sha256 } from "./secure";
import { hashCode } from "./sync-code";
import { mergeNotes, type Note, type NoteRemoval } from "./notes";
import { mergeBoards, type Boards } from "./subjects";

export type Account = {
  id: string;
  email: string;
  name?: string;
  picture?: string;
};

export type SubjectsDoc = {
  notes: Note[];
  noteRemovals: NoteRemoval[];
  boards: Boards;
};

export const SESSION_COOKIE = "sr_session";
export const SESSION_DAYS = 60;
/** Versions closer together than this are folded into one. */
export const VERSION_GAP_MS = 2 * 60 * 1000;
export const KEEP_EVERY_VERSION_DAYS = 30;

let ready: Promise<void> | null = null;

export function ensureAccountSchema() {
  if (!ready) {
    ready = (async () => {
      await ensureSyncSchema();
      const sql = getSql();
      await sql`
        CREATE TABLE IF NOT EXISTS accounts (
          id              TEXT PRIMARY KEY,
          email           TEXT NOT NULL,
          name            TEXT,
          picture         TEXT,
          refresh_token   TEXT,
          drive_folder    TEXT,
          sync_code       TEXT,
          sync_code_hash  TEXT,
          created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
          updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
        )
      `;
      await sql`CREATE INDEX IF NOT EXISTS accounts_sync_code_hash ON accounts (sync_code_hash)`;
      await sql`
        CREATE TABLE IF NOT EXISTS sessions (
          token_hash  TEXT PRIMARY KEY,
          account_id  TEXT NOT NULL,
          expires_at  TIMESTAMPTZ NOT NULL,
          created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
        )
      `;
      await sql`
        CREATE TABLE IF NOT EXISTS subject_store (
          account_id  TEXT PRIMARY KEY,
          payload     TEXT NOT NULL,
          updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
        )
      `;
      await sql`
        CREATE TABLE IF NOT EXISTS subject_versions (
          id          BIGSERIAL PRIMARY KEY,
          account_id  TEXT NOT NULL,
          saved_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
          payload     TEXT NOT NULL
        )
      `;
      await sql`CREATE INDEX IF NOT EXISTS subject_versions_account ON subject_versions (account_id, saved_at DESC)`;
      await sql`
        CREATE TABLE IF NOT EXISTS subject_backups (
          account_id  TEXT NOT NULL,
          subject_id  TEXT NOT NULL,
          file_id     TEXT,
          signature   TEXT,
          backed_at   TIMESTAMPTZ,
          PRIMARY KEY (account_id, subject_id)
        )
      `;
    })().catch((error) => {
      ready = null;
      throw error;
    });
  }
  return ready;
}

/* ------------------------------------------------------------------------ */
/* Accounts and sessions                                                     */
/* ------------------------------------------------------------------------ */

export async function upsertAccount(
  account: Account,
  refreshToken?: string,
): Promise<void> {
  await ensureAccountSchema();
  const sql = getSql();
  const sealedRefresh = refreshToken ? seal(refreshToken) : null;
  await sql`
    INSERT INTO accounts (id, email, name, picture, refresh_token)
    VALUES (${account.id}, ${account.email}, ${account.name ?? null}, ${account.picture ?? null}, ${sealedRefresh})
    ON CONFLICT (id) DO UPDATE SET
      email = EXCLUDED.email,
      name = EXCLUDED.name,
      picture = EXCLUDED.picture,
      refresh_token = COALESCE(EXCLUDED.refresh_token, accounts.refresh_token),
      updated_at = now()
  `;
}

export async function createSession(accountId: string): Promise<{ token: string; expires: Date }> {
  await ensureAccountSchema();
  const sql = getSql();
  const token = randomToken(32);
  const expires = new Date(Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000);
  await sql`
    INSERT INTO sessions (token_hash, account_id, expires_at)
    VALUES (${sha256(token)}, ${accountId}, ${expires.toISOString()})
  `;
  // Old sessions are cleared as new ones are made; nothing else needs a cron.
  await sql`DELETE FROM sessions WHERE expires_at < now()`;
  return { token, expires };
}

export async function accountForSession(token: string | null): Promise<Account | null> {
  if (!token) return null;
  await ensureAccountSchema();
  const sql = getSql();
  const rows = await sql`
    SELECT a.id, a.email, a.name, a.picture
    FROM sessions s JOIN accounts a ON a.id = s.account_id
    WHERE s.token_hash = ${sha256(token)} AND s.expires_at > now()
    LIMIT 1
  `;
  const row = rows[0];
  return row ? { id: row.id, email: row.email, name: row.name ?? undefined, picture: row.picture ?? undefined } : null;
}

export async function endSession(token: string | null) {
  if (!token) return;
  await ensureAccountSchema();
  await getSql()`DELETE FROM sessions WHERE token_hash = ${sha256(token)}`;
}

export async function refreshTokenFor(accountId: string): Promise<string | null> {
  await ensureAccountSchema();
  const rows = await getSql()`SELECT refresh_token FROM accounts WHERE id = ${accountId}`;
  const sealed = rows[0]?.refresh_token;
  return sealed ? open(sealed) : null;
}

export async function driveFolderFor(accountId: string): Promise<string | null> {
  await ensureAccountSchema();
  const rows = await getSql()`SELECT drive_folder FROM accounts WHERE id = ${accountId}`;
  return rows[0]?.drive_folder ?? null;
}

export async function setDriveFolder(accountId: string, folder: string) {
  await getSql()`UPDATE accounts SET drive_folder = ${folder} WHERE id = ${accountId}`;
}

/* ------------------------------------------------------------------------ */
/* Linking a sync code                                                       */
/* ------------------------------------------------------------------------ */

/**
 * Tie a device's sync code to the account, or hand back the one already tied.
 *
 * The first device to sign in brings its code, and from then on every device
 * that signs in is given that code, so the feeds follow the person. A device
 * arriving with a different code adopts the account's (its own feeds merge in
 * through the ordinary sync when it connects).
 */
export class CodeTakenError extends Error {
  constructor() {
    super("That sync code belongs to another Google account.");
  }
}

export async function linkSyncCode(accountId: string, code: string | null): Promise<string | null> {
  await ensureAccountSchema();
  const sql = getSql();
  const rows = await sql`SELECT sync_code FROM accounts WHERE id = ${accountId}`;
  const existing = rows[0]?.sync_code ? open(rows[0].sync_code) : null;
  if (existing) return existing;
  if (!code) return null;
  // A code already tied to someone else's account is theirs; it is not
  // something another sign-in can claim by knowing it.
  const taken = await sql`SELECT 1 FROM accounts WHERE sync_code_hash = ${hashCode(code)} AND id <> ${accountId} LIMIT 1`;
  if (taken.length > 0) throw new CodeTakenError();
  await sql`
    UPDATE accounts SET sync_code = ${seal(code)}, sync_code_hash = ${hashCode(code)}, updated_at = now()
    WHERE id = ${accountId}
  `;
  return code;
}

/** Whether a sync code belongs to an account — whose writing it then may not carry. */
export async function isLinkedCode(code: string): Promise<boolean> {
  const codeHash = hashCode(code);
  await ensureAccountSchema();
  const rows = await getSql()`SELECT 1 FROM accounts WHERE sync_code_hash = ${codeHash} LIMIT 1`;
  return rows.length > 0;
}

/* ------------------------------------------------------------------------ */
/* Subjects: the store, merged writes, versions                              */
/* ------------------------------------------------------------------------ */

export const EMPTY_DOC: SubjectsDoc = { notes: [], noteRemovals: [], boards: {} };

export async function readSubjects(accountId: string): Promise<{ doc: SubjectsDoc; updatedAt: string | null }> {
  await ensureAccountSchema();
  const rows = await getSql()`SELECT payload, updated_at FROM subject_store WHERE account_id = ${accountId}`;
  if (!rows[0]) return { doc: EMPTY_DOC, updatedAt: null };
  return { doc: openJson<SubjectsDoc>(rows[0].payload), updatedAt: String(rows[0].updated_at) };
}

export function mergeDocs(mine: SubjectsDoc, theirs: SubjectsDoc): SubjectsDoc {
  const notes = mergeNotes(
    { notes: mine.notes ?? [], removals: mine.noteRemovals ?? [] },
    { notes: theirs.notes ?? [], removals: theirs.noteRemovals ?? [] },
  );
  return { notes: notes.notes, noteRemovals: notes.removals, boards: mergeBoards(mine.boards ?? {}, theirs.boards ?? {}) };
}

/**
 * Merge a device's copy into the stored one, save it, and record a version.
 * Returns the merged document, which the device takes as the new truth.
 */
export async function writeSubjects(
  accountId: string,
  incoming: SubjectsDoc,
  options: { reason?: string; replace?: boolean } = {},
): Promise<{ doc: SubjectsDoc; changed: boolean }> {
  await ensureAccountSchema();
  const sql = getSql();
  const { doc: stored } = await readSubjects(accountId);
  // A restore replaces rather than merges; everything else merges.
  const merged = options.replace ? incoming : mergeDocs(incoming, stored);
  const changed = JSON.stringify(merged) !== JSON.stringify(stored);
  if (!changed) return { doc: merged, changed: false };

  const sealed = sealJson(merged);
  await sql`
    INSERT INTO subject_store (account_id, payload, updated_at)
    VALUES (${accountId}, ${sealed}, now())
    ON CONFLICT (account_id) DO UPDATE SET payload = EXCLUDED.payload, updated_at = now()
  `;
  await recordVersion(accountId, sealed);
  return { doc: merged, changed: true };
}

/**
 * Keep a version. Saves a couple of minutes apart are separate versions;
 * closer than that, the latest version is updated in place, so a burst of
 * typing is one version rather than hundreds.
 */
async function recordVersion(accountId: string, sealed: string) {
  const sql = getSql();
  const latest = await sql`
    SELECT id, saved_at FROM subject_versions WHERE account_id = ${accountId}
    ORDER BY saved_at DESC LIMIT 1
  `;
  const recent = latest[0] && Date.now() - new Date(latest[0].saved_at).getTime() < VERSION_GAP_MS;
  if (recent) {
    await sql`UPDATE subject_versions SET payload = ${sealed}, saved_at = now() WHERE id = ${latest[0].id}`;
  } else {
    await sql`INSERT INTO subject_versions (account_id, payload) VALUES (${accountId}, ${sealed})`;
  }
  await thinVersions(accountId);
}

/** Older than thirty days, keep the last version of each day; never delete the newest. */
export async function thinVersions(accountId: string) {
  const sql = getSql();
  await sql`
    DELETE FROM subject_versions v
    WHERE v.account_id = ${accountId}
      AND v.saved_at < now() - (${KEEP_EVERY_VERSION_DAYS} || ' days')::interval
      AND EXISTS (
        SELECT 1 FROM subject_versions w
        WHERE w.account_id = v.account_id
          AND date_trunc('day', w.saved_at) = date_trunc('day', v.saved_at)
          AND w.saved_at > v.saved_at
      )
  `;
}

export async function listVersions(accountId: string, limit = 200): Promise<{ id: string; savedAt: string }[]> {
  await ensureAccountSchema();
  const rows = await getSql()`
    SELECT id, saved_at FROM subject_versions WHERE account_id = ${accountId}
    ORDER BY saved_at DESC LIMIT ${limit}
  `;
  return rows.map((row) => ({ id: String(row.id), savedAt: new Date(row.saved_at).toISOString() }));
}

export async function readVersion(accountId: string, id: string): Promise<SubjectsDoc | null> {
  await ensureAccountSchema();
  if (!/^\d+$/.test(id)) return null;
  const rows = await getSql()`
    SELECT payload FROM subject_versions WHERE account_id = ${accountId} AND id = ${id}
  `;
  return rows[0] ? openJson<SubjectsDoc>(rows[0].payload) : null;
}

/* ------------------------------------------------------------------------ */
/* Backups to Google Docs: what was last written where                       */
/* ------------------------------------------------------------------------ */

export async function backupState(accountId: string, subjectId: string) {
  await ensureAccountSchema();
  const rows = await getSql()`
    SELECT file_id, signature, backed_at FROM subject_backups
    WHERE account_id = ${accountId} AND subject_id = ${subjectId}
  `;
  const row = rows[0];
  return row
    ? { fileId: row.file_id as string | null, signature: row.signature as string | null, backedAt: row.backed_at ? new Date(row.backed_at).getTime() : 0 }
    : { fileId: null, signature: null, backedAt: 0 };
}

export async function recordBackup(accountId: string, subjectId: string, fileId: string, signature: string) {
  await getSql()`
    INSERT INTO subject_backups (account_id, subject_id, file_id, signature, backed_at)
    VALUES (${accountId}, ${subjectId}, ${fileId}, ${signature}, now())
    ON CONFLICT (account_id, subject_id) DO UPDATE SET
      file_id = EXCLUDED.file_id, signature = EXCLUDED.signature, backed_at = now()
  `;
}
