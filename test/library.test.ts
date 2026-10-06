import test from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { PGlite } from "@electric-sql/pglite";
import { setSqlForTesting, type Sql } from "../lib/db";
import { readLibrary, writeLibrary } from "../lib/library-store";
import { itemBatches, itemsOf, libraryDelta, libraryOf, itemId, type LibraryItem } from "../lib/library";
import { mergeSaved } from "../lib/saved";

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

const NOW = Date.now();
const article = (i: number, at = NOW - i * 1000) => ({ id: `a${i}`, title: `Story ${i}`, link: `https://news.example/${i}`, savedAt: at, summary: "s" });

async function readAll(account: string, since: string | null = null) {
  const items: LibraryItem[] = [];
  let cursor = since;
  for (;;) {
    const page = await readLibrary(account, cursor);
    items.push(...page.items);
    cursor = page.cursor;
    if (!page.more) return { items, cursor };
  }
}

test("every bookmark is kept with the account, however many", async () => {
  const saved = Array.from({ length: 1200 }, (_, i) => article(i));
  const items = itemsOf({ saved, savedRemovals: [], manual: {}, highlights: {} });
  for (const batch of itemBatches(items, 200_000)) await writeLibrary("acct-1", batch);
  const { items: back } = await readAll("acct-1");
  const lib = libraryOf(back);
  assert.equal(lib.saved.length, 1200, "a cleared browser gets back all 1,200, not the newest 400");
  assert.equal(lib.saved.find((a) => a.link === "https://news.example/1199")?.title, "Story 1199");
});

test("only a newer change replaces an item, and a removal is an item of its own", async () => {
  await writeLibrary("acct-2", itemsOf({ saved: [article(1, 100)], savedRemovals: [], manual: {}, highlights: {} }));
  // Removed on one device at 200.
  await writeLibrary("acct-2", itemsOf({ saved: [], savedRemovals: [{ link: "https://news.example/1", at: 200 }], manual: {}, highlights: {} }));
  // A stale device still holding the save from 100 cannot bring it back.
  assert.equal(await writeLibrary("acct-2", itemsOf({ saved: [article(1, 100)], savedRemovals: [], manual: {}, highlights: {} })), 0);
  let lib = libraryOf((await readAll("acct-2")).items);
  assert.deepEqual(lib.saved, []);
  assert.equal(lib.savedRemovals.length, 1);
  // Saving it again later does.
  await writeLibrary("acct-2", itemsOf({ saved: [article(1, 300)], savedRemovals: [], manual: {}, highlights: {} }));
  lib = libraryOf((await readAll("acct-2")).items);
  assert.equal(lib.saved.length, 1);
  // Merged into a device the usual way, the removal and the re-save resolve as they do in sync.
  const merged = mergeSaved({ saved: [], removals: [] }, { saved: lib.saved, removals: lib.savedRemovals }, NOW);
  assert.equal(merged.saved.length, 1);
});

test("a device asks only for what changed since it last looked", async () => {
  await writeLibrary("acct-3", itemsOf({ saved: [], savedRemovals: [], manual: {}, highlights: { h1: { id: "h1", link: "https://x.example/a", text: "one", at: 10 } } }));
  const first = await readAll("acct-3");
  assert.equal(first.items.length, 1);
  await writeLibrary("acct-3", itemsOf({
    saved: [],
    savedRemovals: [],
    manual: { "https://x.example/p": { link: "https://x.example/p", title: "Pasted", at: 20 } },
    highlights: {},
  }));
  const next = await readAll("acct-3", first.cursor);
  assert.deepEqual(next.items.map((i) => i.kind), ["manual"]);
  // Another account's items are not there.
  assert.equal((await readAll("acct-1", first.cursor)).items.every((i) => i.kind === "saved"), true);
  const other = await readAll("acct-4");
  assert.equal(other.items.length, 0);
});

test("items are encrypted at rest", async () => {
  await writeLibrary("acct-5", itemsOf({ saved: [], savedRemovals: [], manual: {}, highlights: { h: { id: "h", link: "https://x.example/a", text: "a private passage", at: 5 } } }));
  const raw = await db.query("SELECT payload FROM account_items WHERE account_id = 'acct-5'");
  assert.doesNotMatch(JSON.stringify(raw.rows), /private passage/);
});

test("a device sends only what the account does not already hold", () => {
  const items = itemsOf({ saved: [article(1, 50), article(2, 60)], savedRemovals: [], manual: {}, highlights: {} });
  const base = { [itemId(items[0])]: items[0].at };
  assert.deepEqual(libraryDelta(items, base).map((i) => i.key), [items[1].key]);
});

test("bad items are refused, not stored", async () => {
  assert.equal(await writeLibrary("acct-6", [{ kind: "nope", key: "k", at: 1, data: {} }, { kind: "saved", key: "", at: 1, data: {} }, { kind: "saved", key: "k", at: 0, data: {} }]), 0);
});
