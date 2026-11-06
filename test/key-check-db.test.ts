import test from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { PGlite } from "@electric-sql/pglite";
import { setSqlForTesting, type Sql } from "../lib/db";
import { upsertAccount } from "../lib/accounts";
import { dataKeyFits, forgetKeyCheckForTesting } from "../lib/key-check";
import { requireAccount, signInProblem } from "../lib/session";
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
  assert.equal(await signInProblem(), null);
});

test("sign-in that is off says which setting is wrong, never its value", async () => {
  const saved = { ...process.env };
  try {
    delete process.env.GOOGLE_CLIENT_SECRET;
    delete process.env.AUTH_SECRET;
    assert.equal(await signInProblem(), "This server is missing GOOGLE_CLIENT_SECRET, AUTH_SECRET.");
    process.env.GOOGLE_CLIENT_SECRET = "secret";
    process.env.AUTH_SECRET = "short";
    assert.match((await signInProblem()) ?? "", /AUTH_SECRET is too short/);
    process.env.AUTH_SECRET = saved.AUTH_SECRET;
    process.env.DATA_KEY = "not-a-key";
    assert.match((await signInProblem()) ?? "", /DATA_KEY is not a key/);
  } finally {
    process.env.GOOGLE_CLIENT_SECRET = saved.GOOGLE_CLIENT_SECRET;
    process.env.AUTH_SECRET = saved.AUTH_SECRET;
    process.env.DATA_KEY = saved.DATA_KEY;
  }
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
    assert.match((await signInProblem()) ?? "", /DATA_KEY is not the key your saved data was locked with/);
    const guarded = await requireAccount(new Request("https://example.test/api/subjects"), { write: true });
    assert.ok("response" in guarded);
    assert.equal(guarded.response.status, 503);
    assert.match(JSON.stringify(await guarded.response.json()), /DATA_KEY/);
  } finally {
    console.error = quiet;
    process.env.DATA_KEY = savedWith;
  }
});
