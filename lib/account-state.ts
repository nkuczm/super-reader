/**
 * What a signed-in person's devices share — feeds, read marks, places in
 * articles, bookmarks, pasted stories, highlights, team list, shared
 * settings — kept with their Google account. Sync codes are retired: signed
 * in, nothing is reached by a code any more.
 *
 * It is the same document, merged by the same rules (lib/sync-doc.ts), with
 * the same history of earlier feed lists — stored under a key derived from
 * the account and known only to the server. A key from an account id can
 * never be a valid sync code (codes are exactly twenty characters), so it
 * cannot be reached through the old code routes either.
 *
 * A device that had a code brings it once, on signing in: what that code
 * holds is folded into the account, and the device forgets the code.
 */

import { getSql, ensureSchema } from "./db";
import { hashCode, isValidCode } from "./sync-code";
import { ensureAccountSchema, writeSubjects } from "./accounts";
import { open } from "./secure";
import { detachWriting, listSyncVersions, readSync, readSyncVersion, writeSync, type SyncRecord } from "./sync";
import { PARTS, partStamp, type SyncPayload } from "./sync-doc";
import { addInboxItem, readInbox, setSubjectIndex } from "./inbox";
import { addSpend, listSpend } from "./spend-ledger";
import { unionFeeds, unionRead, unionTeams, cleanFeeds, sanitizeTeams } from "./feed-merge";

/** The server-side key an account's shared things are stored under. */
export const accountKey = (accountId: string) => `account-${accountId}`;

function withoutWriting(payload: SyncPayload): SyncPayload {
  const { notes: _n, noteRemovals: _r, boards: _b, ...rest } = payload;
  void _n;
  void _r;
  void _b;
  return rest as SyncPayload;
}

/** The account's store, made on first use from the code the account was once tied to, if any. */
async function ensureStore(accountId: string) {
  await ensureSchema();
  await ensureAccountSchema();
  const sql = getSql();
  const key = hashCode(accountKey(accountId));
  const held = await sql`SELECT 1 FROM feed_syncs WHERE code_hash = ${key}`;
  if (held[0]) return;
  let seed: SyncPayload = { feeds: [] };
  const linked = await sql`SELECT sync_code FROM accounts WHERE id = ${accountId}`;
  const sealed = linked[0]?.sync_code;
  if (sealed) {
    try {
      const old = await readSync(open(String(sealed)));
      if (old) seed = withoutWriting(old.payload);
    } catch {
      /* start empty; the devices bring what they hold */
    }
  }
  await sql`
    INSERT INTO feed_syncs (code_hash, payload) VALUES (${key}, ${JSON.stringify(seed)}::jsonb)
    ON CONFLICT (code_hash) DO NOTHING
  `;
}

export async function readAccountState(accountId: string): Promise<SyncRecord> {
  await ensureStore(accountId);
  const record = (await readSync(accountKey(accountId)))!;
  return { ...record, payload: withoutWriting(record.payload) };
}

export async function writeAccountState(accountId: string, payload: SyncPayload): Promise<SyncRecord> {
  await ensureStore(accountId);
  const record = (await writeSync(accountKey(accountId), withoutWriting(payload)))!;
  return { ...record, payload: withoutWriting(record.payload) };
}

export const listAccountVersions = (accountId: string) => listSyncVersions(accountKey(accountId));
export const readAccountVersion = (accountId: string, id: string) => readSyncVersion(accountKey(accountId), id);

/**
 * Fold an old sync code into the account, once, as a device that had it
 * signs in. Its feeds, teams and read marks join the account's (nothing is
 * replaced); bookmarks and the rest merge as always; its writing moves to
 * the account's subjects; anything waiting in its extension inbox, and its
 * AI spending, come along. A code that belongs to a different account is
 * left alone.
 */
export async function adoptCode(accountId: string, code: string): Promise<boolean> {
  if (!isValidCode(code)) return false;
  await ensureStore(accountId);
  const sql = getSql();
  const other = await sql`SELECT 1 FROM accounts WHERE sync_code_hash = ${hashCode(code)} AND id <> ${accountId} LIMIT 1`;
  if (other[0]) return false;
  const old = await readSync(code);
  if (!old) return false;

  const writing = await detachWriting(code);
  if (writing.notes.length || Object.keys(writing.boards).length) {
    await writeSubjects(accountId, writing, { reason: "moved from sync code" });
  }

  const mine = (await readSync(accountKey(accountId)))!.payload;
  const theirs = old.payload;
  // Dated past anything the account holds, or a list stamped by a device
  // whose clock runs ahead would win over the union and drop the code's half.
  const now = Math.max(Date.now(), ...PARTS.map((part) => partStamp(mine, part) + 1));
  const feeds = unionFeeds(cleanFeeds(mine.feeds), cleanFeeds(theirs.feeds));
  const teams = unionTeams(sanitizeTeams(mine.teams ?? []), sanitizeTeams(theirs.teams ?? []));
  const read = unionRead(mine.read ?? [], theirs.read ?? []);
  await writeSync(accountKey(accountId), {
    ...withoutWriting(theirs),
    feeds,
    teams,
    read,
    ...(mine.vault ?? theirs.vault ? { vault: mine.vault ?? theirs.vault } : {}),
    stamps: { feeds: now, teams: now, read: now, ...(mine.vault ? {} : { vault: now }) },
    updatedAt: now,
  });

  const inbox = await readInbox(code);
  for (const item of inbox.items) await addInboxItem(accountKey(accountId), item);
  if (inbox.subjects.length) await setSubjectIndex(accountKey(accountId), inbox.subjects);
  const spent = await listSpend(code);
  if (spent.length) await addSpend(accountKey(accountId), spent);
  return true;
}
