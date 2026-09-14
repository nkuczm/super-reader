import test from "node:test";
import assert from "node:assert/strict";
import { PGlite } from "@electric-sql/pglite";
import { setSqlForTesting, type Sql } from "../lib/db";
import {
  createTeam,
  readTeam,
  addToTeam,
  removeFromTeam,
  cleanArticle,
  cleanName,
  MAX_TEAM_ARTICLES,
  type TeamArticle,
} from "../lib/team";
import { isValidCode, normalizeCode } from "../lib/sync-code";

// The real SQL against a real Postgres, in-process — the merge below is
// written in SQL, so stubbing the database would test nothing.
let db: PGlite;

test.before(async () => {
  db = new PGlite();
  const sql: Sql = async (strings, ...values) => {
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

function article(link: string, title = "A story"): TeamArticle {
  return cleanArticle({ id: link, title, link })!;
}

test("creates a team feed with a code and an empty list", async () => {
  const { code, name } = await createTeam("Newsroom");
  assert.ok(isValidCode(code));
  assert.equal(name, "Newsroom");

  const record = await readTeam(code);
  assert.ok(record);
  assert.equal(record.name, "Newsroom");
  assert.deepEqual(record.articles, []);
});

test("an unnamed feed still gets a name", async () => {
  assert.equal(cleanName("   "), "Team");
  assert.equal(cleanName("  Desk  "), "Desk");
});

test("a shared article is on the feed for whoever holds the code", async () => {
  const { code } = await createTeam("Desk");
  await addToTeam(code, article("https://example.com/one", "One"));

  // A second person, connecting with the same code however they typed it.
  const record = await readTeam(normalizeCode(code.toLowerCase()));
  assert.equal(record!.articles.length, 1);
  assert.equal(record!.articles[0].title, "One");
});

test("two people saving at the same moment both land on the list", async () => {
  const { code } = await createTeam("Desk");
  await Promise.all([
    addToTeam(code, article("https://example.com/a", "A")),
    addToTeam(code, article("https://example.com/b", "B")),
    addToTeam(code, article("https://example.com/c", "C")),
  ]);

  const record = await readTeam(code);
  const links = record!.articles.map((a) => a.link).sort();
  assert.deepEqual(links, [
    "https://example.com/a",
    "https://example.com/b",
    "https://example.com/c",
  ]);
});

test("saving the same link twice moves it up rather than duplicating it", async () => {
  const { code } = await createTeam("Desk");
  await addToTeam(code, article("https://example.com/one", "One"));
  await addToTeam(code, article("https://example.com/two", "Two"));
  const record = await addToTeam(code, article("https://example.com/one", "One again"));

  assert.equal(record!.articles.length, 2);
  assert.equal(record!.articles[0].link, "https://example.com/one");
  assert.equal(record!.articles[0].title, "One again");
});

test("anyone on the feed can take an article off it", async () => {
  const { code } = await createTeam("Desk");
  await addToTeam(code, article("https://example.com/one"));
  await addToTeam(code, article("https://example.com/two"));

  const record = await removeFromTeam(code, "https://example.com/one");
  assert.deepEqual(
    record!.articles.map((a) => a.link),
    ["https://example.com/two"],
  );

  // Removing something that is not there is not an error.
  const again = await removeFromTeam(code, "https://example.com/one");
  assert.equal(again!.articles.length, 1);
});

test("the list is capped, oldest first", async () => {
  const { code } = await createTeam("Desk");
  for (let i = 0; i < MAX_TEAM_ARTICLES + 3; i += 1) {
    await addToTeam(code, article(`https://example.com/${i}`, `Story ${i}`));
  }
  const record = await readTeam(code);
  assert.equal(record!.articles.length, MAX_TEAM_ARTICLES);
  // The newest is at the front; the first three saved have dropped off.
  assert.equal(record!.articles[0].title, `Story ${MAX_TEAM_ARTICLES + 2}`);
  assert.ok(!record!.articles.some((a) => a.title === "Story 0"));
});

test("a code that was never created resolves to nothing", async () => {
  assert.equal(await readTeam("00000-00000-00000-00000"), null);
  assert.equal(await addToTeam("00000-00000-00000-00000", article("https://e.com/x")), null);
});

test("only the article travels — nothing about the sender", async () => {
  const cleaned = cleanArticle({
    id: "a1",
    title: "A story",
    link: "https://example.com/a",
    summary: "What happened",
    sourceTitle: "Example",
    favicon: "https://example.com/icon.png",
    // None of this is the team's business, and none of it should survive.
    sourceId: "s1",
    read: true,
    savedBy: "someone@example.com",
    vault: { ct: "secret" },
    feeds: [{ id: "f1" }],
  });

  assert.deepEqual(Object.keys(cleaned!).sort(), [
    "favicon",
    "id",
    "link",
    "savedAt",
    "sourceTitle",
    "summary",
    "title",
  ]);
});

test("an article with no link, no title or a non-http link is refused", () => {
  assert.equal(cleanArticle({ title: "No link" }), null);
  assert.equal(cleanArticle({ link: "https://example.com/a" }), null);
  assert.equal(cleanArticle({ title: "x", link: "javascript:alert(1)" }), null);
  assert.equal(cleanArticle(null), null);
  assert.equal(cleanArticle("https://example.com/a"), null);
});

test("an oversized article is refused rather than stored", () => {
  assert.equal(
    cleanArticle({
      title: "x",
      link: "https://example.com/a",
      image: `https://example.com/${"p".repeat(30_000)}.png`,
    }),
    null,
  );
});
