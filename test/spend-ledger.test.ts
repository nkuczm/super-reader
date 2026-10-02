import test from "node:test";
import assert from "node:assert/strict";
import { PGlite } from "@electric-sql/pglite";
import { setSqlForTesting, type Sql } from "../lib/db";
import { addSpend, listSpend } from "../lib/spend-ledger";
import { idOf } from "../lib/spend";

let db: PGlite;
test.before(() => {
  db = new PGlite();
  const sql: Sql = async (strings, ...values) => {
    const text = strings.reduce((acc, part, i) => acc + part + (i < values.length ? `$${i + 1}` : ""), "");
    return (await db.query(text, values as never[])).rows as Record<string, never>[];
  };
  setSqlForTesting(sql);
});
test.after(async () => {
  setSqlForTesting(null);
  await db.close();
});

const run = (id: string, device: string, at: number, cost: number) =>
  ({ id, device, at, provider: "anthropic", model: "claude-opus-5-5", input: 1000, output: 200, cost }) as const;

test("every device's runs add up under the sync code, each counted once", async () => {
  await addSpend("code-a", [run("r1", "Mac", 1, 0.01), run("r2", "Mac", 2, 0.02)]);
  await addSpend("code-a", [run("r3", "iPhone", 3, 0.03), run("r1", "Mac", 1, 0.01)]); // r1 again
  await addSpend("code-b", [run("x", "Mac", 1, 9)]);
  const records = await listSpend("code-a");
  assert.deepEqual(records.map((r) => r.id), ["r1", "r2", "r3"]);
  assert.equal(records.reduce((n, r) => n + (r.cost ?? 0), 0).toFixed(2), "0.06");
  // Junk is cleaned, not stored as given.
  await addSpend("code-a", [{ id: "r4", at: 4, input: -5, cost: Number.NaN, model: "m".repeat(500) } as never]);
  const r4 = (await listSpend("code-a")).find((r) => r.id === "r4")!;
  assert.equal(r4.input, 0);
  assert.equal(r4.cost, null);
  assert.equal(r4.model.length, 80);
});

test("a record from before ids existed gets the same id every time", () => {
  const old = { at: 5, provider: "openai", model: "gpt-5-mini", input: 10, output: 2, cost: 0 } as const;
  assert.equal(idOf(old), idOf({ ...old }));
});
