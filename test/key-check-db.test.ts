import test from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { PGlite } from "@electric-sql/pglite";
import { setSqlForTesting, type Sql } from "../lib/db";
import { upsertAccount } from "../lib/accounts";
import { dataKeyFits, forgetKeyCheckForTesting } from "../lib/key-check";
import { requireAccount } from "../lib/session";
import { seal } from "../lib/secure";

const savedWith = randomBytes(32).toString("base64");
let db: PGlite;

test.before(async () => {
  process.env.GOOGLE_CLIENT_ID = "id";
  process.env.GOOGLE_CLIENT_SECRET = "secret";
  process.env.AUTH_SECRET = randomBytes(48).toString("base64");
  process.env.DATA_KEY = savedWith;
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

test("a new database, with nothing sealed yet, lets any key start it", async () => {
  forgetKeyCheckForTesting();
  assert.equal(await dataKeyFits(), true);
});

test("saved data: the key it was saved with fits, another key turns accounts off before anything is read", async () => {
  await upsertAccount({ id: "acc-1", email: "a@example.com" });
  await db.query("INSERT INTO account_prefs (account_id, payload) VALUES ($1, $2)", ["acc-1", seal("{}")]);

  forgetKeyCheckForTesting();
  assert.equal(await dataKeyFits(), true);

  process.env.DATA_KEY = randomBytes(32).toString("base64");
  forgetKeyCheckForTesting();
  const quiet = console.error;
  console.error = () => {};
  try {
    assert.equal(await dataKeyFits(), false);
    const guarded = await requireAccount(new Request("https://example.test/api/subjects"), { write: true });
    assert.ok("response" in guarded);
    assert.equal(guarded.response.status, 503);
    assert.match(JSON.stringify(await guarded.response.json()), /DATA_KEY/);
  } finally {
    console.error = quiet;
    process.env.DATA_KEY = savedWith;
  }
});
