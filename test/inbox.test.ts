import test from "node:test";
import assert from "node:assert/strict";
import { PGlite } from "@electric-sql/pglite";
import { setSqlForTesting, type Sql } from "../lib/db";
import { addInboxItem, clearInboxItems, readInbox, readPage, setSubjectIndex, MAX_ITEMS } from "../lib/inbox";

let db: PGlite;

test.before(async () => {
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

const article = (n: number) => ({ url: `https://a.example/${n}`, title: `Story ${n}`, html: "<p>x</p>", excerpt: "", wordCount: 1 }) as never;

test("the extension's inbox holds items per code until the app files them", async () => {
  await setSubjectIndex("code-a", [{ id: "n1", name: "Hawaii" }]);
  await addInboxItem("code-a", { id: "i1", savedAt: Date.now(), article: article(1), subjectId: "n1" });
  await addInboxItem("code-a", { id: "i2", savedAt: Date.now(), article: article(2) });
  const box = await readInbox("code-a");
  assert.deepEqual(box.subjects, [{ id: "n1", name: "Hawaii" }]);
  assert.deepEqual(box.items.map((i) => i.id), ["i1", "i2"]);
  // Another code sees nothing of it.
  assert.deepEqual((await readInbox("code-b")).items, []);
  await clearInboxItems("code-a", ["i1"]);
  assert.deepEqual((await readInbox("code-a")).items.map((i) => i.id), ["i2"]);
  // Subjects survive items being added and cleared.
  assert.equal((await readInbox("code-a")).subjects.length, 1);
});

test("the inbox keeps only the newest items, and drops week-old ones", async () => {
  for (let i = 0; i < MAX_ITEMS + 5; i++) await addInboxItem("code-c", { id: `c${i}`, savedAt: Date.now(), article: article(i) });
  const items = (await readInbox("code-c")).items;
  assert.equal(items.length, MAX_ITEMS);
  assert.equal(items[items.length - 1].id, `c${MAX_ITEMS + 4}`);
  await addInboxItem("code-d", { id: "old", savedAt: Date.now() - 8 * 24 * 3600 * 1000, article: article(0) });
  assert.deepEqual((await readInbox("code-d")).items, []);
});

test("a page saved from the browser stays readable by its address, tracking tags or not", async () => {
  const page = { url: "https://news.example/story?utm_source=x", title: "Story", html: "<p>Full text here.</p>", excerpt: "", wordCount: 3 } as never;
  await addInboxItem("code-e", { id: "e1", savedAt: Date.now(), article: page });
  await clearInboxItems("code-e", ["e1"]);
  // Filed and cleared from the inbox, yet any device can still read it.
  assert.equal((await readPage("code-e", "https://news.example/story"))?.title, "Story");
  assert.equal(await readPage("code-f", "https://news.example/story"), null);
});
