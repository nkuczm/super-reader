import test from "node:test";
import assert from "node:assert/strict";
import { PGlite } from "@electric-sql/pglite";
import { setSqlForTesting, type Sql } from "../lib/db";
import { createSync, readSync, writeSync } from "../lib/sync";
import { newSyncCode, normalizeCode, isValidCode, hashCode } from "../lib/sync-code";

// Run the real SQL against a real Postgres, in-process.
let db: PGlite;

test.before(async () => {
  db = new PGlite();
  const sql: Sql = async (strings, ...values) => {
    // Rebuild the tagged template as a parameterised query ($1, $2, ...).
    const text = strings.reduce(
      (acc, part, i) => acc + part + (i < values.length ? `$${i + 1}` : ""),
      "",
    );
    const result = await db.query(text, values as any[]);
    return result.rows as Record<string, any>[];
  };
  setSqlForTesting(sql);
});

test.after(async () => {
  setSqlForTesting(null);
  await db.close();
});

test("creates a code and stores an empty feed list", async () => {
  const { code } = await createSync();
  assert.ok(isValidCode(code), `generated code should be valid: ${code}`);

  const record = await readSync(code);
  assert.ok(record, "the new code resolves");
  assert.deepEqual(record.payload.feeds, []);
});

test("round-trips feeds through storage", async () => {
  const { code } = await createSync();
  const feeds = [
    {
      id: "f1",
      name: "AI",
      sources: [{ id: "s1", feedUrl: "https://example.com/feed", title: "Example" }],
    },
  ];

  const written = await writeSync(code, { feeds, read: ["a", "b"] });
  assert.ok(written);

  const record = await readSync(code);
  assert.deepEqual(record!.payload.feeds, feeds);
  assert.deepEqual(record!.payload.read, ["a", "b"]);
});

test("a second device reading the same code sees the first device's feeds", async () => {
  const { code } = await createSync();
  await writeSync(code, { feeds: [{ id: "f1", name: "Tech", sources: [] }] });

  // Same code, typed the way a person would paste it.
  const asTyped = code.toLowerCase().replace(/-/g, " ");
  const record = await readSync(asTyped);
  assert.equal((record!.payload.feeds[0] as any).name, "Tech");
});

test("later writes win", async () => {
  const { code } = await createSync();
  await writeSync(code, { feeds: [{ id: "a", name: "First", sources: [] }] });
  await writeSync(code, { feeds: [{ id: "b", name: "Second", sources: [] }] });

  const record = await readSync(code);
  assert.equal(record!.payload.feeds.length, 1);
  assert.equal((record!.payload.feeds[0] as any).name, "Second");
});

test("an unknown code returns nothing rather than creating one", async () => {
  const stranger = newSyncCode();
  assert.equal(await readSync(stranger), null);
  assert.equal(await writeSync(stranger, { feeds: [] }), null);
});

test("codes are stored only as hashes", async () => {
  const { code } = await createSync();
  const rows = await db.query<{ code_hash: string }>("SELECT code_hash FROM feed_syncs");
  const stored = rows.rows.map((r) => r.code_hash);

  assert.ok(stored.includes(hashCode(code)), "row is keyed by the hash");
  assert.ok(
    !stored.some((h) => h.includes(normalizeCode(code))),
    "the code itself is never stored",
  );
});
