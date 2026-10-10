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
 * thirty days, then one per day for good. History is stored as changes, with
 * a whole snapshot now and then, and each picture is stored once.
 */

import { getSql, ensureSchema as ensureSyncSchema } from "./db";
import { open, openJson, randomToken, seal, sealJson, sha256 } from "./secure";
import { hashCode } from "./sync-code";
import { mergeNotes, type Note, type NoteRemoval } from "./notes";
import { mergeBoards, type Boards } from "./subjects";
import { keysLost, mergePrefs, type AccountPrefs } from "./prefs-merge";

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
        CREATE TABLE IF NOT EXISTS subject_changes (
          id          BIGSERIAL PRIMARY KEY,
          account_id  TEXT NOT NULL,
          saved_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
          kind        TEXT NOT NULL,
          payload     TEXT NOT NULL
        )
      `;
      await sql`CREATE INDEX IF NOT EXISTS subject_changes_account ON subject_changes (account_id, id)`;
      await sql`
        CREATE TABLE IF NOT EXISTS subject_images (
          account_id  TEXT NOT NULL,
          hash        TEXT NOT NULL,
          data        TEXT NOT NULL,
          PRIMARY KEY (account_id, hash)
        )
      `;
      await sql`
        CREATE TABLE IF NOT EXISTS account_prefs (
          account_id  TEXT PRIMARY KEY,
          payload     TEXT NOT NULL,
          updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
        )
      `;
      await sql`
        CREATE TABLE IF NOT EXISTS account_prefs_versions (
          id          BIGSERIAL PRIMARY KEY,
          account_id  TEXT NOT NULL,
          saved_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
          payload     TEXT NOT NULL
        )
      `;
      await sql`CREATE INDEX IF NOT EXISTS account_prefs_versions_account ON account_prefs_versions (account_id, id DESC)`;
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

/*
 * Pictures are kept once. A picture in a board box is stored in its own row,
 * by the SHA-256 of its data URL, and everywhere else — the current copy,
 * every change, every snapshot — carries only `sr-img:<hash>` in its place.
 * Devices keep the pictures they have and fetch only ones they lack.
 */
export const IMAGE_REF = "sr-img:";
export const isImageRef = (v: unknown): v is string => typeof v === "string" && v.startsWith(IMAGE_REF) && /^[0-9a-f]{64}$/.test(v.slice(IMAGE_REF.length));

export class MissingImages extends Error {
  constructor(readonly hashes: string[]) {
    super("Some pictures referred to are not stored yet.");
    this.name = "MissingImages";
  }
}

/** The document with each inline picture swapped for its reference, and the pictures themselves. */
export function splitImages(doc: SubjectsDoc): { doc: SubjectsDoc; images: Map<string, string>; refs: Set<string> } {
  const images = new Map<string, string>();
  const refs = new Set<string>();
  const boards: Boards = {};
  for (const [subject, board] of Object.entries(doc.boards ?? {})) {
    const next: Record<string, unknown> = {};
    for (const [id, item] of Object.entries(board ?? {})) {
      const image = (item as { image?: unknown })?.image;
      if (typeof image === "string" && image.startsWith("data:")) {
        const hash = sha256(image);
        images.set(hash, image);
        next[id] = { ...item, image: IMAGE_REF + hash };
      } else {
        if (isImageRef(image)) refs.add(image.slice(IMAGE_REF.length));
        next[id] = item;
      }
    }
    boards[subject] = next as Boards[string];
  }
  return { doc: { ...doc, boards }, images, refs };
}

async function storeImages(accountId: string, images: Map<string, string>) {
  const sql = getSql();
  for (const [hash, data] of images) {
    await sql`
      INSERT INTO subject_images (account_id, hash, data) VALUES (${accountId}, ${hash}, ${seal(data)})
      ON CONFLICT (account_id, hash) DO NOTHING
    `;
  }
}

/**
 * Pictures sent ahead of the change that uses them, so a save never has to
 * carry several at once (a request has a size limit, and a save over it
 * would never get through). Each is checked against its hash and must be a
 * picture.
 */
export async function storePictures(accountId: string, pictures: Record<string, unknown>): Promise<string[]> {
  await ensureAccountSchema();
  const ok = new Map<string, string>();
  for (const [hash, data] of Object.entries(pictures)) {
    if (/^[0-9a-f]{64}$/.test(hash) && typeof data === "string" && data.startsWith("data:image/") && sha256(data) === hash) ok.set(hash, data);
  }
  await storeImages(accountId, ok);
  return [...ok.keys()];
}

/** Which of these pictures the account does not hold. */
async function missingImages(accountId: string, hashes: string[]): Promise<string[]> {
  if (!hashes.length) return [];
  const rows = await getSql()`SELECT hash FROM subject_images WHERE account_id = ${accountId} AND hash = ANY(${hashes})`;
  const have = new Set(rows.map((r) => String(r.hash)));
  return hashes.filter((h) => !have.has(h));
}

/** A response stays well inside what a function may return; the device asks again for the rest. */
export const PICTURES_PER_RESPONSE_BYTES = 3 * 1024 * 1024;

/** The pictures themselves, by hash, for a device that lacks them — as many as fit in one response, always at least one. */
export async function readImages(accountId: string, hashes: string[]): Promise<Record<string, string>> {
  await ensureAccountSchema();
  const wanted = hashes.filter((h) => /^[0-9a-f]{64}$/.test(h)).slice(0, 50);
  if (!wanted.length) return {};
  const rows = await getSql()`SELECT hash, data FROM subject_images WHERE account_id = ${accountId} AND hash = ANY(${wanted})`;
  const out: Record<string, string> = {};
  let bytes = 0;
  for (const r of rows) {
    const data = open(String(r.data));
    if (bytes > 0 && bytes + data.length > PICTURES_PER_RESPONSE_BYTES) break;
    out[String(r.hash)] = data;
    bytes += data.length;
  }
  return out;
}

/**
 * The document with its picture references filled back in (for a Google Docs
 * backup, or a preview). With a budget, pictures past it are left out.
 */
export async function inlineImages(accountId: string, doc: SubjectsDoc, budget = Infinity): Promise<SubjectsDoc> {
  const { refs } = splitImages(doc);
  if (!refs.size) return doc;
  const sql = getSql();
  const rows = await sql`SELECT hash, data FROM subject_images WHERE account_id = ${accountId} AND hash = ANY(${[...refs]})`;
  const found = new Map<string, string>();
  let bytes = 0;
  for (const r of rows) {
    const data = open(String(r.data));
    if (bytes + data.length > budget) continue;
    found.set(IMAGE_REF + String(r.hash), data);
    bytes += data.length;
  }
  const boards = Object.fromEntries(Object.entries(doc.boards).map(([subject, board]) => [subject, Object.fromEntries(
    Object.entries(board).map(([id, item]) => {
      const image = (item as { image?: unknown }).image;
      return [id, isImageRef(image) ? { ...item, image: found.get(image) } : item];
    }),
  )])) as Boards;
  return { ...doc, boards };
}

/**
 * The account's current copy, pictures as references: its latest snapshot
 * with the changes after it replayed — or, for an account whose history
 * began before changes were kept, the whole copy stored then.
 */
export async function readSubjects(accountId: string): Promise<{ doc: SubjectsDoc; updatedAt: string | null; cursor: string | null }> {
  await ensureAccountSchema();
  const sql = getSql();
  const snap = await sql`
    SELECT id, payload, saved_at FROM subject_changes
    WHERE account_id = ${accountId} AND kind = 'snap'
    ORDER BY id DESC LIMIT 1
  `;
  let doc: SubjectsDoc = EMPTY_DOC;
  let updatedAt: string | null = null;
  if (snap[0]) {
    doc = openJson<SubjectsDoc>(snap[0].payload);
    updatedAt = String(snap[0].saved_at);
  } else {
    const rows = await sql`SELECT payload, updated_at FROM subject_store WHERE account_id = ${accountId}`;
    if (rows[0]) {
      // Stored before pictures were kept apart: they move out now.
      const split = splitImages(openJson<SubjectsDoc>(rows[0].payload));
      if (split.images.size) {
        await storeImages(accountId, split.images);
        await sql`UPDATE subject_store SET payload = ${sealJson(split.doc)} WHERE account_id = ${accountId}`;
      }
      doc = split.doc;
      updatedAt = String(rows[0].updated_at);
    }
  }
  const after = await sql`
    SELECT id, payload, saved_at FROM subject_changes
    WHERE account_id = ${accountId} AND kind = 'delta' AND id > ${snap[0]?.id ?? 0}
    ORDER BY id
  `;
  for (const row of after) {
    doc = mergeDocs(openJson<SubjectsDoc>(row.payload), doc, new Date(row.saved_at).getTime());
    updatedAt = String(row.saved_at);
  }
  const last = await sql`SELECT max(id) AS id FROM subject_changes WHERE account_id = ${accountId}`;
  return { doc, updatedAt, cursor: last[0]?.id != null ? String(last[0].id) : null };
}

export function mergeDocs(mine: SubjectsDoc, theirs: SubjectsDoc, now = Date.now()): SubjectsDoc {
  const notes = mergeNotes(
    { notes: mine.notes ?? [], removals: mine.noteRemovals ?? [] },
    { notes: theirs.notes ?? [], removals: theirs.noteRemovals ?? [] },
    now,
  );
  return { notes: notes.notes, noteRemovals: notes.removals, boards: mergeBoards(mine.boards ?? {}, theirs.boards ?? {}, now) };
}

/** Only what `after` has that `before` did not: changed notes, new removals, changed board items. */
export function diffDocs(before: SubjectsDoc, after: SubjectsDoc): SubjectsDoc {
  const was = new Map((before.notes ?? []).map((n) => [n.id, JSON.stringify(n)]));
  const removed = new Set((before.noteRemovals ?? []).map((r) => `${r.id}:${r.at}`));
  const boards: Boards = {};
  for (const [subject, board] of Object.entries(after.boards ?? {})) {
    const old = before.boards?.[subject] ?? {};
    const changed = Object.fromEntries(Object.entries(board).filter(([id, item]) => JSON.stringify(old[id]) !== JSON.stringify(item)));
    if (Object.keys(changed).length) boards[subject] = changed;
  }
  return {
    notes: (after.notes ?? []).filter((n) => was.get(n.id) !== JSON.stringify(n)),
    noteRemovals: (after.noteRemovals ?? []).filter((r) => !removed.has(`${r.id}:${r.at}`)),
    boards,
  };
}

const isEmpty = (d: SubjectsDoc) => !d.notes.length && !d.noteRemovals.length && !Object.keys(d.boards).length;

/** A snapshot is written after this many changes, or once the changes since the last add up to this much. */
export const SNAPSHOT_EVERY = 300;
export const SNAPSHOT_BYTES = 256 * 1024;

/**
 * Save a device's changes. A save is one small row appended: what the
 * device changed, as it sent it — nothing is read back, and the whole
 * document is never rewritten for an edit. Now and then a snapshot of the
 * whole is written so the document can be rebuilt quickly. Every save is a
 * version. A restore (`replace`) is written as a snapshot of its own.
 */
export async function writeSubjects(
  accountId: string,
  incoming: SubjectsDoc,
  options: { reason?: string; replace?: boolean } = {},
): Promise<{ doc: SubjectsDoc | null; changed: boolean; cursor: string | null }> {
  await ensureAccountSchema();
  const sql = getSql();
  const { doc: split, images, refs } = splitImages(incoming);
  const missing = await missingImages(accountId, [...refs].filter((h) => !images.has(h)));
  if (missing.length) throw new MissingImages(missing);
  await storeImages(accountId, images);

  if (options.replace) {
    const id = await insertChange(accountId, "snap", split);
    await compactChanges(accountId);
    return { doc: split, changed: true, cursor: id };
  }
  const change: SubjectsDoc = {
    notes: split.notes ?? [],
    noteRemovals: split.noteRemovals ?? [],
    boards: Object.fromEntries(Object.entries(split.boards ?? {}).filter(([, b]) => b && Object.keys(b).length)),
  };
  if (isEmpty(change)) return { doc: null, changed: false, cursor: null };

  const hasSnap = await sql`SELECT 1 FROM subject_changes WHERE account_id = ${accountId} AND kind = 'snap' LIMIT 1`;
  if (!hasSnap[0]) {
    // The first save under changes: the whole document becomes the first snapshot.
    const { doc: stored } = await readSubjects(accountId);
    const id = await insertChange(accountId, "snap", mergeDocs(change, stored));
    return { doc: null, changed: true, cursor: id };
  }
  const id = await insertChange(accountId, "delta", change);
  const since = await sql`
    SELECT count(*)::int AS n, coalesce(sum(length(payload)), 0)::bigint AS bytes,
      (SELECT length(payload) FROM subject_changes WHERE account_id = ${accountId} AND kind = 'snap' ORDER BY id DESC LIMIT 1)::bigint AS snap
    FROM subject_changes
    WHERE account_id = ${accountId} AND kind = 'delta'
      AND id > (SELECT max(id) FROM subject_changes WHERE account_id = ${accountId} AND kind = 'snap')
  `;
  // A new snapshot once the changes since the last outweigh it. A fixed
  // threshold rewrote a document of several megabytes every few saves, and
  // every one of those copies is kept for thirty days.
  if (since[0].n >= SNAPSHOT_EVERY || Number(since[0].bytes) > Math.max(SNAPSHOT_BYTES, Number(since[0].snap) || 0)) {
    const { doc: whole } = await readSubjects(accountId);
    await insertChange(accountId, "snap", whole);
    await compactChanges(accountId);
  } else {
    await slimLegacyVersions(accountId, 5);
  }
  return { doc: null, changed: true, cursor: id };
}

async function insertChange(accountId: string, kind: "snap" | "delta", doc: SubjectsDoc): Promise<string> {
  const rows = await getSql()`
    INSERT INTO subject_changes (account_id, kind, payload)
    VALUES (${accountId}, ${kind}, ${sealJson(doc)})
    RETURNING id
  `;
  return String(rows[0].id);
}

/** The document as it stood after change `id`: its snapshot, with the changes after it replayed in order. */
async function stateAt(accountId: string, id: string): Promise<SubjectsDoc | null> {
  const sql = getSql();
  const base = await sql`
    SELECT id, payload FROM subject_changes
    WHERE account_id = ${accountId} AND kind = 'snap' AND id <= ${id}
    ORDER BY id DESC LIMIT 1
  `;
  if (!base[0]) return null;
  let doc = openJson<SubjectsDoc>(base[0].payload);
  const after = await sql`
    SELECT payload, saved_at FROM subject_changes
    WHERE account_id = ${accountId} AND kind = 'delta' AND id > ${base[0].id} AND id <= ${id}
    ORDER BY id
  `;
  // Replayed as of when each was saved, so nothing expires that had not then.
  for (const row of after) doc = mergeDocs(openJson<SubjectsDoc>(row.payload), doc, new Date(row.saved_at).getTime());
  return doc;
}

/** Changes past this much (as stored) are not worth replaying: the whole document is read instead. */
export const CHANGES_BYTES = 4 * 1024 * 1024;

/**
 * Everything that changed after `since`, merged — or null when only the whole
 * document will do.
 *
 * What lies past the cursor is sized up before any of it is read. It used to
 * be read whole — up to 201 rows, snapshots and all — and only then judged
 * too much: a device that came back after a day of writing elsewhere asked
 * for more than the database will return in one answer (64 MB), the request
 * failed, its cursor never moved, and it never saw another device's writing
 * until it was reloaded (8–9 Oct 2026, 19 times).
 */
export async function changesSince(accountId: string, since: string): Promise<{ doc: SubjectsDoc; cursor: string } | null> {
  await ensureAccountSchema();
  if (!/^\d+$/.test(since)) return null;
  const sql = getSql();
  const sizes = await sql`
    SELECT id, kind, length(payload)::bigint AS bytes FROM subject_changes
    WHERE account_id = ${accountId} AND id > ${since}
    ORDER BY id LIMIT 201
  `;
  if (sizes.length > 200 || sizes.some((r) => r.kind === "snap")) return null;
  if (sizes.reduce((sum, r) => sum + Number(r.bytes), 0) > CHANGES_BYTES) return null;
  // The cursor names a change this account has (or had): a stale or foreign one gets the whole document.
  const known = await sql`SELECT 1 FROM subject_changes WHERE account_id = ${accountId} AND id <= ${since} LIMIT 1`;
  if (!known[0]) return null;
  if (!sizes.length) return { doc: EMPTY_DOC, cursor: since };
  const last = String(sizes[sizes.length - 1].id);
  const rows = await sql`
    SELECT id, kind, payload, saved_at FROM subject_changes
    WHERE account_id = ${accountId} AND id > ${since} AND id <= ${last}
    ORDER BY id
  `;
  // A snapshot written between the two reads: the whole document, as above.
  if (rows.some((r) => r.kind === "snap")) return null;
  let doc: SubjectsDoc = EMPTY_DOC;
  for (const row of rows) doc = mergeDocs(openJson<SubjectsDoc>(row.payload), doc, new Date(row.saved_at).getTime());
  return { doc, cursor: last };
}

/**
 * Past thirty days, history is kept one version per day: the day's last
 * change becomes a snapshot of the document as it then stood, and that day's
 * earlier changes go. Done a few days at a time.
 */
export async function compactChanges(accountId: string, days = 3) {
  const sql = getSql();
  const old = await sql`
    SELECT max(id) AS last FROM subject_changes
    WHERE account_id = ${accountId} AND saved_at < now() - (${KEEP_EVERY_VERSION_DAYS} || ' days')::interval
    GROUP BY date_trunc('day', saved_at)
    HAVING count(*) > 1
    ORDER BY 1 LIMIT ${days}
  `;
  for (const { last } of old) {
    const state = await stateAt(accountId, String(last));
    if (!state) continue;
    await sql`UPDATE subject_changes SET kind = 'snap', payload = ${sealJson(state)} WHERE id = ${last}`;
    await sql`
      DELETE FROM subject_changes
      WHERE account_id = ${accountId} AND id < ${last}
        AND date_trunc('day', saved_at) = (SELECT date_trunc('day', saved_at) FROM subject_changes WHERE id = ${last})
    `;
  }
  await thinVersions(accountId);
  await slimLegacyVersions(accountId);
}

/**
 * Whole versions saved before pictures were kept apart carry every picture
 * again in each of them. A few at a time, each picture moves to the shared
 * store and the version keeps only its reference — same history, a fraction
 * of the space.
 */
export async function slimLegacyVersions(accountId: string, batch = 20) {
  const sql = getSql();
  const rows = await sql`
    SELECT id, payload FROM subject_versions
    WHERE account_id = ${accountId} AND payload NOT LIKE 'slim:%'
    ORDER BY id LIMIT ${batch}
  `;
  for (const row of rows) {
    let doc: SubjectsDoc;
    try {
      doc = openJson<SubjectsDoc>(row.payload);
    } catch {
      continue;
    }
    const { doc: slim, images } = splitImages(doc);
    await storeImages(accountId, images);
    await sql`UPDATE subject_versions SET payload = ${"slim:" + sealJson(slim)} WHERE id = ${row.id}`;
  }
}

/** Older than thirty days, keep the last version of each day; never delete the newest. (Versions kept whole, from before changes.) */
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

/**
 * The versions to choose from, newest first: every save, with saves only
 * moments apart shown as one (the last of them), then the whole copies
 * kept before history was stored as changes. Ids: "c<n>" for a change.
 */
export async function listVersions(accountId: string, limit = 200): Promise<{ id: string; savedAt: string }[]> {
  await ensureAccountSchema();
  const sql = getSql();
  const changes = await sql`
    SELECT id, saved_at FROM subject_changes WHERE account_id = ${accountId}
    ORDER BY id DESC LIMIT ${limit * 20}
  `;
  const out: { id: string; savedAt: string }[] = [];
  let previous = Infinity;
  for (const row of changes) {
    const at = new Date(row.saved_at).getTime();
    if (previous - at >= VERSION_GAP_MS) out.push({ id: `c${row.id}`, savedAt: new Date(at).toISOString() });
    previous = at;
    if (out.length >= limit) return out;
  }
  const legacy = await sql`
    SELECT id, saved_at FROM subject_versions WHERE account_id = ${accountId}
    ORDER BY saved_at DESC LIMIT ${limit - out.length}
  `;
  return [...out, ...legacy.map((row) => ({ id: String(row.id), savedAt: new Date(row.saved_at).toISOString() }))];
}

export async function readVersion(accountId: string, id: string): Promise<SubjectsDoc | null> {
  await ensureAccountSchema();
  if (/^c\d+$/.test(id)) return stateAt(accountId, id.slice(1));
  if (!/^\d+$/.test(id)) return null;
  const rows = await getSql()`
    SELECT payload FROM subject_versions WHERE account_id = ${accountId} AND id = ${id}
  `;
  if (!rows[0]) return null;
  const payload = String(rows[0].payload);
  return splitImages(openJson<SubjectsDoc>(payload.startsWith("slim:") ? payload.slice(5) : payload)).doc;
}

/* ------------------------------------------------------------------------ */
/* Settings and API keys, following the account                              */
/* ------------------------------------------------------------------------ */

/**
 * Every setting, and the AI and data API keys, kept with the account so a
 * new device signs in to find them. Encrypted at rest like the subjects.
 * Each setting and key carries when it last changed, and the more recent
 * wins one by one (lib/prefs-merge.ts).
 */
export type { AccountPrefs } from "./prefs-merge";

export async function readAccountPrefs(accountId: string): Promise<AccountPrefs | null> {
  await ensureAccountSchema();
  const rows = await getSql()`SELECT payload FROM account_prefs WHERE account_id = ${accountId}`;
  return rows[0] ? openJson<AccountPrefs>(rows[0].payload) : null;
}

/** Copies that changed nothing but settings are kept at most this often. */
const PREFS_VERSION_EVERY_MS = 24 * 60 * 60 * 1000;

/**
 * Merge a device's copy in: each setting and key from whichever side changed
 * it last. Before a key is removed or replaced, or the vault replaced — and
 * otherwise once a day — what was held is kept as a version.
 */
export async function writeAccountPrefs(accountId: string, incoming: AccountPrefs): Promise<AccountPrefs> {
  const held = (await readAccountPrefs(accountId)) ?? {};
  const next = mergePrefs(incoming, held);
  if (JSON.stringify(next) === JSON.stringify(held)) return held;
  const sql = getSql();
  const hadSomething = Object.keys(held.keys ?? {}).length > 0 || held.vault !== undefined || Object.keys(held.settings ?? {}).length > 0;
  if (hadSomething) {
    const loses = keysLost(held, next).length > 0 || (held.vault !== undefined && JSON.stringify(held.vault) !== JSON.stringify(next.vault));
    let keep = loses;
    if (!keep) {
      const last = await sql`SELECT saved_at FROM account_prefs_versions WHERE account_id = ${accountId} ORDER BY id DESC LIMIT 1`;
      keep = !last[0] || Date.now() - new Date(last[0].saved_at).getTime() > PREFS_VERSION_EVERY_MS;
    }
    if (keep) await sql`INSERT INTO account_prefs_versions (account_id, payload) VALUES (${accountId}, ${sealJson(held)})`;
  }
  await sql`
    INSERT INTO account_prefs (account_id, payload, updated_at) VALUES (${accountId}, ${sealJson(next)}, now())
    ON CONFLICT (account_id) DO UPDATE SET payload = EXCLUDED.payload, updated_at = now()
  `;
  return next;
}

export type PrefsVersion = { id: string; savedAt: string; keys: string[]; settings: number; vault: boolean };

/** Earlier copies of the settings and keys, newest first — key names only, never their values. */
export async function listPrefsVersions(accountId: string, limit = 60): Promise<PrefsVersion[]> {
  await ensureAccountSchema();
  const rows = await getSql()`
    SELECT id, saved_at, payload FROM account_prefs_versions
    WHERE account_id = ${accountId} ORDER BY id DESC LIMIT ${limit}
  `;
  return rows.map((r) => {
    const prefs = openJson<AccountPrefs>(r.payload);
    return {
      id: String(r.id),
      savedAt: new Date(r.saved_at).toISOString(),
      keys: Object.keys(prefs.keys ?? {}).sort(),
      settings: Object.keys(prefs.settings ?? {}).length,
      vault: prefs.vault !== undefined,
    };
  });
}

/**
 * Bring back the keys an earlier copy held that the account no longer does
 * (or the vault, if it has none). Nothing held now is replaced; the keys come
 * back as a change made now, so every device takes them.
 */
export async function restorePrefsVersion(accountId: string, id: string): Promise<{ prefs: AccountPrefs; restored: string[] } | null> {
  if (!/^\d{1,18}$/.test(id)) return null;
  await ensureAccountSchema();
  const rows = await getSql()`SELECT payload FROM account_prefs_versions WHERE account_id = ${accountId} AND id = ${id}`;
  if (!rows[0]) return null;
  const old = openJson<AccountPrefs>(rows[0].payload);
  const held = (await readAccountPrefs(accountId)) ?? {};
  const now = Date.now();
  const restored = Object.keys(old.keys ?? {}).filter((name) => !(held.keys && name in held.keys));
  const back: AccountPrefs = {
    keys: Object.fromEntries(restored.map((name) => [name, old.keys![name]])),
    keyStamps: Object.fromEntries(restored.map((name) => [name, now])),
    ...(held.vault === undefined && old.vault !== undefined ? { vault: old.vault, vaultAt: now } : {}),
  };
  const prefs = await writeAccountPrefs(accountId, back);
  return { prefs, restored };
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
