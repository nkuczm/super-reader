import test from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { PGlite } from "@electric-sql/pglite";
import { setSqlForTesting, type Sql } from "../lib/db";
import {
  accountForSession,
  createSession,
  endSession,
  ensureAccountSchema,
  isLinkedCode,
  linkSyncCode,
  listVersions,
  readSubjects,
  readVersion,
  thinVersions,
  upsertAccount,
  writeSubjects,
  type SubjectsDoc,
} from "../lib/accounts";

let db: PGlite;
process.env.DATA_KEY = randomBytes(32).toString("base64");
process.env.AUTH_SECRET = randomBytes(32).toString("base64");

test.before(async () => {
  db = new PGlite();
  const sql: Sql = async (strings, ...values) => {
    const text = strings.reduce((acc, part, i) => acc + part + (i < values.length ? `$${i + 1}` : ""), "");
    return (await db.query(text, values as any[])).rows as Record<string, any>[];
  };
  setSqlForTesting(sql);
  await ensureAccountSchema();
  await upsertAccount({ id: "g-1", email: "me@example.com", name: "Me" }, "refresh-secret");
});

test.after(async () => {
  setSqlForTesting(null);
  await db.close();
});

const doc = (name: string, quote: string, at: number): SubjectsDoc => ({
  notes: [{ id: name, name, at, entries: [{ id: `${name}-q`, kind: "quote", text: quote, link: "https://a.com/x", articleTitle: "X", at }] }],
  noteRemovals: [],
  boards: {},
});

test("a session finds its account, and ends", async () => {
  const { token } = await createSession("g-1");
  assert.equal((await accountForSession(token))?.email, "me@example.com");
  assert.equal(await accountForSession("not-a-token"), null);
  await endSession(token);
  assert.equal(await accountForSession(token), null);
});

test("writing is stored encrypted, and two devices' writes merge", async () => {
  await writeSubjects("g-1", doc("phone", "A secret research quote", 1));
  await writeSubjects("g-1", doc("laptop", "Another quote", 2));
  const { doc: stored } = await readSubjects("g-1");
  assert.deepEqual(stored.notes.map((n) => n.id).sort(), ["laptop", "phone"]);

  const raw = await db.query("SELECT payload FROM subject_store");
  assert.doesNotMatch(JSON.stringify(raw.rows), /secret research quote/, "nothing readable at rest");
  const refresh = await db.query("SELECT refresh_token FROM accounts");
  assert.doesNotMatch(JSON.stringify(refresh.rows), /refresh-secret/);
});

test("saves close together are one version; restoring an old one works", async () => {
  const before = (await listVersions("g-1")).length;
  await writeSubjects("g-1", doc("burst", "one", 3));
  await writeSubjects("g-1", doc("burst2", "two", 4));
  assert.equal((await listVersions("g-1")).length, before, "a burst of saves folds into the latest version");

  const [latest] = await listVersions("g-1");
  const version = await readVersion("g-1", latest.id);
  assert.ok(version?.notes.some((n) => n.id === "burst2"));
  assert.equal(await readVersion("g-1", "1; DROP TABLE accounts"), null, "ids are checked");
  assert.equal(await readVersion("someone-else", latest.id), null, "another account cannot read it");
});

test("past thirty days, one version per day is kept", async () => {
  await db.query("DELETE FROM subject_versions");
  for (const [day, hour] of [[40, 9], [40, 15], [40, 20], [35, 10], [2, 9], [2, 12]] as const) {
    await db.query(
      // From the start of a day, not from now: "now + 20 hours" crosses
      // midnight late in the day and splits one day's saves across two.
      `INSERT INTO subject_versions (account_id, saved_at, payload) VALUES ('g-1', date_trunc('day', now()) - interval '${day} days' + interval '${hour} hours', 'x')`,
    );
  }
  await thinVersions("g-1");
  const left = await db.query<{ n: number }>("SELECT count(*)::int AS n FROM subject_versions");
  assert.equal(left.rows[0].n, 4, "two old days keep one each; recent ones all stay");
});

test("the first device's sync code is the account's, handed to every later device", async () => {
  assert.equal(await linkSyncCode("g-1", "code-from-laptop"), "code-from-laptop");
  assert.equal(await linkSyncCode("g-1", "code-from-phone"), "code-from-laptop");
  assert.equal(await linkSyncCode("g-1", null), "code-from-laptop");
  assert.ok(await isLinkedCode("code-from-laptop"));
  assert.equal(await isLinkedCode("code-from-phone"), false);
});
