import test from "node:test";
import assert from "node:assert/strict";
import { matchOf, parseQuery, rankByRelevance, slugTextOf } from "../lib/relevance";

const article = (title: string, summary = "", link = "https://example.com/news/a-story-here") => ({
  title,
  summary,
  link,
});

test("a plain query needs every word", () => {
  const query = parseQuery("export controls");
  assert.ok(matchOf(article("New export controls on chips"), query).matches);
  assert.equal(
    matchOf(article("Export growth slows"), query).matches,
    false,
    "half a query is not a match",
  );
});

test("the reason it did not match is reported", () => {
  const result = matchOf(article("Export growth slows"), parseQuery("export controls"));
  assert.deepEqual(result.missing, ["controls"]);
});

test("a quoted phrase must arrive intact", () => {
  const query = parseQuery('"supply chain"');
  assert.ok(matchOf(article("Repairing the supply chain"), query).matches);
  assert.equal(
    matchOf(article("Chain stores and the supply of labour"), query).matches,
    false,
    "the same words in the wrong order are not the phrase",
  );
});

test("a minus term disqualifies", () => {
  const query = parseQuery("apple -iphone");
  assert.ok(matchOf(article("Apple opens a new campus"), query).matches);
  assert.equal(matchOf(article("Apple iPhone sales climb"), query).matches, false);
});

test("OR accepts either side", () => {
  const query = parseQuery("openai OR anthropic funding");
  assert.ok(matchOf(article("Anthropic funding round closes"), query).matches);
  assert.ok(matchOf(article("OpenAI funding at record levels"), query).matches);
  assert.equal(
    matchOf(article("Google funding round closes"), query).matches,
    false,
    "neither alternative is present",
  );
});

test("possessives and accents do not break a match", () => {
  const query = parseQuery("beyonce album");
  assert.ok(matchOf(article("Beyoncé’s album arrives"), query).matches);
});

test("plurals and simple stems count, unrelated longer words do not", () => {
  assert.ok(matchOf(article("The banks respond"), parseQuery("bank")).matches);
  assert.ok(matchOf(article("Banking rules tighten"), parseQuery("bank")).matches);
  assert.equal(
    matchOf(article("Bankruptcy filings rise"), parseQuery("bank")).matches,
    false,
    "a prefix is not a word",
  );
});

test("the slug counts when a listing gives no summary", () => {
  const bare = {
    title: "",
    link: "https://example.com/2026/09/14/senate-passes-tariff-bill",
  };
  assert.ok(matchOf(bare, parseQuery("tariff")).matches);
});

test("a title hit outranks a summary hit", () => {
  const query = parseQuery("tariffs");
  const inTitle = matchOf(article("Tariffs raised again"), query).score;
  const inSummary = matchOf(article("A quiet week in Washington", "Tariffs were mentioned"), query).score;
  assert.ok(inTitle > inSummary, `${inTitle} should beat ${inSummary}`);
});

test("an empty query matches everything", () => {
  const query = parseQuery("   ");
  assert.ok(query.empty);
  assert.ok(matchOf(article("Anything at all"), query).matches);
});

test("ranking keeps only matches, best first, newest breaking ties", () => {
  const items = [
    { ...article("A note on tariffs", "brief"), publishedAt: "2026-09-01T00:00:00Z" },
    { ...article("Tariffs reshape trade"), publishedAt: "2026-09-10T00:00:00Z" },
    { ...article("Tariffs reshape trade"), publishedAt: "2026-09-12T00:00:00Z" },
    { ...article("Unrelated story"), publishedAt: "2026-09-13T00:00:00Z" },
  ];
  const ranked = rankByRelevance(items, parseQuery("tariffs"));
  assert.equal(ranked.length, 3, "the unrelated story is gone");
  assert.equal(ranked[0].publishedAt, "2026-09-12T00:00:00Z", "newest of the equally relevant");
});

test("stop words alone do not make a query", () => {
  assert.ok(parseQuery("the of and").empty);
});

test("slug text drops ids and extensions", () => {
  assert.equal(
    slugTextOf("https://example.com/2026/09/14/senate-passes-bill-84c21f9a.html"),
    "senate passes bill 84c21f9a",
  );
});
