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

test("a device that has been away cannot overwrite a newer change", async () => {
  const { code } = await createSync();

  // The phone adds a feed now.
  await writeSync(code, {
    feeds: [{ id: "phone", name: "Added on the phone", sources: [] }],
    updatedAt: 2_000,
  });

  // The desktop, closed for a week, wakes up and pushes what it remembers.
  await assert.rejects(
    () =>
      writeSync(code, {
        feeds: [{ id: "old", name: "Stale desktop copy", sources: [] }],
        updatedAt: 1_000,
      }),
    (error: Error) => error.name === "StaleWrite",
  );

  const record = await readSync(code);
  assert.equal(
    (record?.payload.feeds?.[0] as { name: string }).name,
    "Added on the phone",
    "the newer change survives",
  );

  // And the refusal hands back what is current, so the stale device can catch up.
  try {
    await writeSync(code, { feeds: [], updatedAt: 1_000 });
    assert.fail("should have been refused");
  } catch (error: any) {
    assert.equal(
      (error.current.payload.feeds[0] as { name: string }).name,
      "Added on the phone",
    );
  }
});

test("a later change from any device is accepted", async () => {
  const { code } = await createSync();
  await writeSync(code, { feeds: [{ id: "a", name: "First", sources: [] }], updatedAt: 5_000 });
  await writeSync(code, { feeds: [{ id: "b", name: "Second", sources: [] }], updatedAt: 6_000 });

  const record = await readSync(code);
  assert.equal((record?.payload.feeds?.[0] as { name: string }).name, "Second");
  assert.equal(record?.payload.updatedAt, 6_000);
});

test("a write with the same change time is allowed through", async () => {
  // Re-sending after a dropped connection must not be mistaken for staleness.
  const { code } = await createSync();
  await writeSync(code, { feeds: [], updatedAt: 9_000 });
  const again = await writeSync(code, {
    feeds: [{ id: "x", name: "Retry", sources: [] }],
    updatedAt: 9_000,
  });
  assert.equal((again?.payload.feeds?.[0] as { name: string }).name, "Retry");
});

// Bookmark stamps are wall-clock times in production, and the tombstone TTL
// is measured against the clock — so these use real times, not 1000/2000,
// which the TTL would treat as ancient.
const NOW = Date.now();
const ago = (minutes: number) => NOW - minutes * 60_000;

test("one device's bookmarks never delete another's", async () => {
  // The bug this fixes: the whole document resolved by "most recent change
  // wins", so whichever device pushed second replaced the other's bookmark
  // list wholesale. Bookmarks merge instead.
  const { code } = await createSync();

  await writeSync(code, {
    feeds: [],
    updatedAt: 1000,
    saved: [{ id: "a", title: "Desktop find", link: "https://a.example/1", savedAt: ago(240) }],
  });
  const after = await writeSync(code, {
    feeds: [],
    updatedAt: 2000,
    saved: [{ id: "b", title: "Phone find", link: "https://b.example/2", savedAt: ago(10) }],
  });

  assert.deepEqual(
    (after?.payload.saved ?? []).map((article) => article.link).sort(),
    ["https://a.example/1", "https://b.example/2"],
    "both survive the second write",
  );

  const stored = await readSync(code);
  assert.equal(stored?.payload.saved?.length, 2);
});

test("an un-save travels, instead of being undone by the other device", async () => {
  const { code } = await createSync();
  await writeSync(code, {
    feeds: [],
    updatedAt: 1000,
    saved: [
      { id: "a", title: "Saved then dropped", link: "https://a.example/1", savedAt: ago(240) },
    ],
  });

  // The other device removes it and pushes the tombstone.
  const after = await writeSync(code, {
    feeds: [],
    updatedAt: 2000,
    saved: [],
    savedRemovals: [{ link: "https://a.example/1", at: ago(60) }],
  });
  assert.deepEqual(after?.payload.saved, [], "the removal wins over the older save");
  assert.equal(after?.payload.savedRemovals?.length, 1, "and keeps travelling");

  // A device that still holds the article pushes it again: it does not
  // resurrect, because its save is older than the removal.
  const later = await writeSync(code, {
    feeds: [],
    updatedAt: 3000,
    saved: [
      { id: "a", title: "Saved then dropped", link: "https://a.example/1", savedAt: ago(240) },
    ],
  });
  assert.deepEqual(later?.payload.saved, []);

  // Saving it again, now, does bring it back — an un-save is not permanent.
  const resaved = await writeSync(code, {
    feeds: [],
    updatedAt: 4000,
    saved: [{ id: "a", title: "Saved again", link: "https://a.example/1", savedAt: ago(1) }],
  });
  assert.deepEqual((resaved?.payload.saved ?? []).map((a) => a.link), ["https://a.example/1"]);
});

test("bookmarks survive a feed list arriving from another device", async () => {
  // Feeds still resolve by most-recent-change; that must not take the
  // bookmarks with it.
  const { code } = await createSync();
  await writeSync(code, {
    feeds: [{ id: "f1", name: "Old", sources: [] }],
    updatedAt: 1000,
    saved: [{ id: "a", title: "Keep me", link: "https://a.example/1", savedAt: ago(30) }],
  });
  const after = await writeSync(code, {
    feeds: [{ id: "f2", name: "New arrangement", sources: [] }],
    updatedAt: 2000,
  });
  assert.equal((after?.payload.feeds[0] as { name: string }).name, "New arrangement");
  assert.deepEqual((after?.payload.saved ?? []).map((a) => a.link), ["https://a.example/1"]);
});
