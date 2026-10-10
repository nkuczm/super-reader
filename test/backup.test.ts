import test from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { PGlite } from "@electric-sql/pglite";
import { setSqlForTesting, type Sql } from "../lib/db";
import { backupState, ensureAccountSchema, upsertAccount, writeSubjects, type SubjectsDoc } from "../lib/accounts";
import { backupSubjects } from "../lib/backup";

let db: PGlite;
process.env.DATA_KEY = randomBytes(32).toString("base64");
process.env.AUTH_SECRET = randomBytes(32).toString("base64");
process.env.GOOGLE_CLIENT_ID = "client";
process.env.GOOGLE_CLIENT_SECRET = "secret";

const realFetch = globalThis.fetch;
/** Drive, as slow as asked, refusing the documents named in `refuse`. `uploads`: in the order they began. */
let uploadMs = 0;
let refuse = new Set<string>();
const uploads: string[] = [];

test.before(async () => {
  db = new PGlite();
  const sql: Sql = async (strings, ...values) => {
    const text = strings.reduce((acc, part, i) => acc + part + (i < values.length ? `$${i + 1}` : ""), "");
    return (await db.query(text, values as any[])).rows as Record<string, any>[];
  };
  setSqlForTesting(sql);
  await ensureAccountSchema();
  await upsertAccount({ id: "g-b", email: "b@example.com" }, "refresh-secret");
  let made = 0;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
    if (url.startsWith("https://oauth2.googleapis.com/token")) return json({ access_token: "token" });
    if (url.includes("/upload/drive/v3/files")) {
      const name = /"name":"([^"]+)"/.exec(String(init?.body))?.[1] ?? "";
      uploads.push(name);
      await new Promise((r) => setTimeout(r, uploadMs));
      if (refuse.has(name)) return json({ error: { message: "Backend Error" } }, 500);
      return json({ id: `doc-${++made}` });
    }
    if (url.includes("/drive/v3/files")) return init?.method === "POST" ? json({ id: "folder" }) : json({ id: "x", trashed: false });
    throw new Error(`unexpected fetch ${url}`);
  }) as typeof fetch;
});

test.after(async () => {
  globalThis.fetch = realFetch;
  setSqlForTesting(null);
  await db.close();
});

/** The subjects, each holding a quote that differs from round to round — a change worth backing up. */
const subjects = (names: string[], at: number): SubjectsDoc => ({
  notes: names.map((name) => ({
    id: name, name, at,
    entries: [{ id: `${name}-q`, kind: "quote", text: `Round ${at}`, link: "https://a.com/x", articleTitle: "X", at }],
  })) as SubjectsDoc["notes"],
  noteRemovals: [],
  boards: {},
});

test("a backup answers in time, says what is left, and the next one does the rest", async () => {
  await writeSubjects("g-b", subjects(["s1", "s2", "s3", "s4", "s5"], 1));
  uploadMs = 150;
  uploads.length = 0;
  const started = Date.now();
  const first = await backupSubjects("g-b", { budget: 400, leastToStart: 300 });
  assert.ok(Date.now() - started < 400, "it answers inside its budget");
  assert.equal(first.backedUp, 3, "three at once, and no time to start more");
  assert.equal(first.more, 2);
  const second = await backupSubjects("g-b", { budget: 400, leastToStart: 300 });
  assert.equal(second.backedUp, 2);
  assert.equal(second.unchanged, 3);
  assert.equal(second.more, undefined);
  assert.equal(new Set(uploads).size, 5, "every subject written once");
});

test("a subject that fails waits behind the others next time", async () => {
  await writeSubjects("g-b", subjects(["s1", "s2", "s3", "s4", "s5"], 2));
  uploadMs = 0;
  refuse = new Set(["s1"]);
  uploads.length = 0;
  const first = await backupSubjects("g-b", { budget: 5000, leastToStart: 0 });
  assert.deepEqual(first.failed, ["s1"]);
  assert.match(first.problem ?? "", /update the Google Doc|create the Google Doc/);
  assert.ok((await backupState("g-b", "s1")).triedAt > 0);
  // Every subject changes again; the one that failed is now tried last.
  await writeSubjects("g-b", subjects(["s1", "s2", "s3", "s4", "s5"], 3));
  refuse = new Set();
  uploads.length = 0;
  const second = await backupSubjects("g-b", { budget: 5000, leastToStart: 0 });
  assert.equal(second.backedUp, 5);
  assert.equal(uploads.length, 5);
  assert.equal(uploads.at(-1), "s1");
});
