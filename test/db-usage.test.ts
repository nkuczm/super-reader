import test from "node:test";
import assert from "node:assert/strict";
import { PGlite } from "@electric-sql/pglite";
import { setSqlForTesting, type Sql } from "../lib/db";
import { attribute, meterStore, record, type Meter } from "../lib/db-meter";
import { flush, usageReport } from "../lib/db-usage";

test("each request's database use is counted, stored by day and part, and reported", async () => {
  const db = new PGlite();
  const sql: Sql = async (strings, ...values) => {
    const text = strings.reduce((acc, part, i) => acc + part + (i < values.length ? `$${i + 1}` : ""), "");
    return (await db.query(text, values as never[])).rows as Record<string, never>[];
  };
  setSqlForTesting(sql);
  try {
    const m: Meter = { category: "subjects", account: null, bytesIn: 0, bytesOut: 0, queries: 0, ms: 0 };
    meterStore.run(m, () => {
      record(100, 2000, 5);
      attribute("me");
      record(50, 10, 1);
    });
    record(9999, 9999, 9); // outside any request: not counted
    assert.deepEqual(m, { category: "subjects", account: "me", bytesIn: 2010, bytesOut: 150, queries: 2, ms: 6 });
    await flush(m);
    await flush({ ...m, account: null, category: "sync" });
    await flush(m);
    const report = await usageReport("me");
    const subjects = report.rows.find((r) => r.category === "subjects")!;
    assert.equal(subjects.bytesIn, 4020);
    assert.equal(subjects.requests, 2);
    assert.equal(subjects.mine, 4320);
    assert.equal(report.rows.find((r) => r.category === "sync")!.mine, 0);
    assert.ok(report.storage.tables.some((t) => t.name === "db_usage"));
  } finally {
    setSqlForTesting(null);
    await db.close();
  }
});
