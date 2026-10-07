import test from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { PGlite } from "@electric-sql/pglite";
import { setSqlForTesting, type Sql } from "../lib/db";
import { createSync, writeSync } from "../lib/sync";
import { isValidCode } from "../lib/sync-code";
import { upsertAccount, linkSyncCode, readSubjects } from "../lib/accounts";
import { accountKey, adoptCode, readAccountState, writeAccountState, listAccountVersions } from "../lib/account-state";
import { readInbox, addInboxItem } from "../lib/inbox";

let db: PGlite;
process.env.DATA_KEY = randomBytes(32).toString("base64");

test.before(async () => {
  db = new PGlite();
  const sql: Sql = async (strings, ...values) => {
    const text = strings.reduce((acc, part, i) => acc + part + (i < values.length ? `$${i + 1}` : ""), "");
    return (await db.query(text, values as any[])).rows as Record<string, any>[];
  };
  setSqlForTesting(sql);
});
test.after(async () => {
  setSqlForTesting(null);
  await db.close();
});

const src = (id: string) => ({ id, feedUrl: `https://${id}.example/rss` });

test("an account's things are kept with it, by the same merge rules, never with writing", async () => {
  await upsertAccount({ id: "acc-1", email: "a@example.com" });
  const empty = await readAccountState("acc-1");
  assert.deepEqual(empty.payload.feeds, []);
  const after = await writeAccountState("acc-1", {
    feeds: [{ id: "f", name: "News", sources: [src("a")] }],
    notes: [{ id: "n", name: "x", at: 1, entries: [] }] as never,
    stamps: { feeds: 5 },
    updatedAt: 5,
  });
  assert.equal((after.payload.feeds[0] as { name: string }).name, "News");
  assert.equal(after.payload.notes, undefined, "writing lives with the subjects, not here");
  // And a removal is kept as a version.
  await writeAccountState("acc-1", { feeds: [], stamps: { feeds: 6 }, updatedAt: 6 });
  assert.equal((await listAccountVersions("acc-1")).length >= 1, true);
});

test("an account key can never pass as a sync code", () => {
  // Google account ids are 21 digits; the code routes accept exactly 20 characters.
  assert.equal(isValidCode(accountKey("112233445566778899001")), false);
});

test("a device's old code is folded in once: feeds join, writing moves, inbox comes along", async () => {
  await upsertAccount({ id: "acc-2", email: "b@example.com" });
  await writeAccountState("acc-2", { feeds: [{ id: "f1", name: "Mine", sources: [src("a")] }], stamps: { feeds: Date.now() + 10_000 }, updatedAt: Date.now() });
  const { code } = await createSync();
  await writeSync(code, {
    feeds: [{ id: "f2", name: "From the code", sources: [src("b")] }],
    notes: [{ id: "n1", name: "Old subject", at: 1, updatedAt: 1, entries: [] }] as never,
    stamps: { feeds: 1 },
    updatedAt: 1,
  });
  await addInboxItem(code, { id: "i1", savedAt: Date.now(), article: { url: "https://x.example/a", title: "A", html: "", excerpt: "", wordCount: 0 } } as never);

  assert.equal(await adoptCode("acc-2", code), true);
  const state = await readAccountState("acc-2");
  assert.deepEqual((state.payload.feeds as { name: string }[]).map((f) => f.name).sort(), ["From the code", "Mine"], "a newer account list does not throw the code's away");
  const { doc } = await readSubjects("acc-2");
  assert.ok(doc.notes.some((n) => n.id === "n1"), "the code's writing moved to the account");
  assert.equal((await readInbox(accountKey("acc-2"))).items.length, 1);
});

test("a code tied to another account is not folded in", async () => {
  await upsertAccount({ id: "acc-3", email: "c@example.com" });
  await upsertAccount({ id: "acc-4", email: "d@example.com" });
  const { code } = await createSync();
  await linkSyncCode("acc-3", code);
  assert.equal(await adoptCode("acc-4", code), false);
});

test("an account once tied to a code starts from what that code held", async () => {
  await upsertAccount({ id: "acc-5", email: "e@example.com" });
  const { code } = await createSync();
  await writeSync(code, { feeds: [{ id: "f", name: "Linked", sources: [src("z")] }], updatedAt: 1 });
  await linkSyncCode("acc-5", code);
  const state = await readAccountState("acc-5");
  assert.equal((state.payload.feeds[0] as { name: string }).name, "Linked");
});
