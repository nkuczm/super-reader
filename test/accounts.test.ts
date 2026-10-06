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
  changesSince,
  compactChanges,
  slimLegacyVersions,
  inlineImages,
  MissingImages,
  readImages,
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

const PNG = "data:image/png;base64," + "A".repeat(5000);
const box = (subject: string, id: string, at: number, extra: Record<string, unknown> = {}): SubjectsDoc => ({
  notes: [],
  noteRemovals: [],
  boards: { [subject]: { [id]: { id, kind: "box", html: "", at, ...extra } as never } },
});

test("history is stored as changes: a small edit stores a small row, and every version rebuilds exactly", async () => {
  await upsertAccount({ id: "g-2", email: "two@example.com" }, "r");
  await writeSubjects("g-2", doc("s1", "first", 1));
  for (let i = 0; i < 5; i++) await writeSubjects("g-2", box("s1", `b${i}`, 10 + i, { html: `<p>${i}</p>` }));
  const rows = await db.query<{ kind: string; n: number }>("SELECT kind, count(*)::int AS n FROM subject_changes WHERE account_id = 'g-2' GROUP BY kind ORDER BY kind");
  assert.deepEqual(rows.rows, [{ kind: "delta", n: 5 }, { kind: "snap", n: 1 }]);
  const ids = (await db.query<{ id: string }>("SELECT id FROM subject_changes WHERE account_id = 'g-2' ORDER BY id")).rows.map((r) => String(r.id));
  const third = await readVersion("g-2", `c${ids[2]}`);
  assert.deepEqual(Object.keys(third!.boards.s1).sort(), ["b0", "b1"], "a version holds exactly what was there then");
  const latest = await readVersion("g-2", `c${ids[ids.length - 1]}`);
  assert.deepEqual(latest, (await readSubjects("g-2")).doc);
  // Sending the whole document again changes nothing and records nothing.
  const again = await writeSubjects("g-2", (await readSubjects("g-2")).doc);
  assert.equal(again.changed, false);
});

test("a device catches up by reading only the changes after its cursor", async () => {
  const { cursor } = await readSubjects("g-2");
  await writeSubjects("g-2", box("s1", "late", 50, { html: "<p>late</p>" }));
  const since = await changesSince("g-2", cursor!);
  assert.deepEqual(Object.keys(since!.doc.boards.s1), ["late"]);
  assert.deepEqual((await changesSince("g-1", cursor!))?.doc.boards, {}, "another account sees none of these changes");
  assert.equal(await changesSince("g-2", "1; DROP TABLE accounts"), null, "a malformed cursor gets the whole copy instead");
});

test("a picture is stored once, sent once, and comes back by reference", async () => {
  await writeSubjects("g-2", box("s1", "pic", 60, { image: PNG }));
  await writeSubjects("g-2", box("s1", "pic2", 61, { image: PNG }));
  const n = await db.query<{ n: number }>("SELECT count(*)::int AS n FROM subject_images WHERE account_id = 'g-2'");
  assert.equal(n.rows[0].n, 1);
  const { doc: stored } = await readSubjects("g-2");
  const ref = (stored.boards.s1.pic as { image?: string }).image!;
  assert.match(ref, /^sr-img:[0-9a-f]{64}$/);
  const changes = await db.query<{ n: number }>("SELECT max(length(payload))::int AS n FROM subject_changes WHERE account_id = 'g-2' AND kind = 'delta'");
  assert.ok(changes.rows[0].n < 2000, "no change row carries the picture");
  const hash = ref.slice("sr-img:".length);
  assert.equal((await readImages("g-2", [hash]))[hash], PNG);
  assert.deepEqual(await readImages("g-1", [hash]), {}, "pictures belong to their account");
  const full = await inlineImages("g-2", stored);
  assert.equal((full.boards.s1.pic2 as { image?: string }).image, PNG);
  // A reference to a picture the account does not have is refused, so it can be sent whole.
  await assert.rejects(writeSubjects("g-2", box("s1", "ghost", 70, { image: "sr-img:" + "0".repeat(64) })), MissingImages);
});

test("past thirty days, a day's changes become one snapshot of how that day ended", async () => {
  await upsertAccount({ id: "g-3", email: "three@example.com" }, "r");
  await writeSubjects("g-3", doc("s", "a", 1));
  await writeSubjects("g-3", box("s", "x", 2));
  await writeSubjects("g-3", box("s", "y", 3));
  await writeSubjects("g-3", box("s", "z", 4));
  await db.query("UPDATE subject_changes SET saved_at = date_trunc('day', now()) - interval '40 days' + (id % 10) * interval '1 minute' WHERE account_id = 'g-3' AND id < (SELECT max(id) FROM subject_changes WHERE account_id = 'g-3')");
  const before = await db.query<{ id: string }>("SELECT max(id) AS id FROM subject_changes WHERE account_id = 'g-3' AND saved_at < now() - interval '30 days'");
  const endOfDay = await readVersion("g-3", `c${before.rows[0].id}`);
  await compactChanges("g-3");
  const left = await db.query<{ kind: string }>("SELECT kind FROM subject_changes WHERE account_id = 'g-3' ORDER BY id");
  assert.deepEqual(left.rows.map((r) => r.kind), ["snap", "delta"]);
  assert.deepEqual(await readVersion("g-3", `c${before.rows[0].id}`), endOfDay, "the day's last version is unchanged");
  assert.ok((await readSubjects("g-3")).doc.boards.s.z, "and the newest still rebuilds");
});

test("old whole versions give up their pictures to the shared store, and read back the same", async () => {
  await upsertAccount({ id: "g-4", email: "four@example.com" }, "r");
  const { sealJson } = await import("../lib/secure");
  const old: SubjectsDoc = { ...doc("s", "q", 1), boards: { s: { p: { id: "p", kind: "box", html: "", image: PNG, at: 1 } as never } } };
  await db.query(`INSERT INTO subject_versions (account_id, payload) VALUES ('g-4', $1)`, [sealJson(old)]);
  const [v] = await listVersions("g-4");
  const before = await readVersion("g-4", v.id);
  await slimLegacyVersions("g-4");
  const size = await db.query<{ n: number }>("SELECT length(payload)::int AS n FROM subject_versions WHERE account_id = 'g-4'");
  assert.ok(size.rows[0].n < 2000);
  assert.deepEqual(await readVersion("g-4", v.id), before);
  assert.equal((await inlineImages("g-4", before!)).boards.s.p && ((await inlineImages("g-4", before!)).boards.s.p as { image?: string }).image, PNG);
});
