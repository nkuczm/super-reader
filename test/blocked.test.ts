import test from "node:test";
import assert from "node:assert/strict";
import { startGuardedSite } from "./fixtures.mjs";
import { fetchFeedItemContent } from "../lib/feed";
import { articleFromFeedContent, extractArticle } from "../lib/article";

const FEED = "http://127.0.0.1:8789/rss.xml";
let site: { close: () => void };

test.before(async () => {
  site = await startGuardedSite(8789);
});
test.after(() => site.close());

test("the article page really is blocked", async () => {
  await assert.rejects(
    () => extractArticle("http://127.0.0.1:8789/story/one"),
    /403/,
  );
});

test("falls back to the full text the publisher syndicated", async () => {
  const content = await fetchFeedItemContent(FEED, "http://127.0.0.1:8789/story/one");
  assert.ok(content, "found the entry's content");

  const article = articleFromFeedContent(
    content,
    "http://127.0.0.1:8789/story/one",
    "The blocked story",
  );
  assert.equal(article.via, "feed", "labelled as coming from the feed");
  assert.ok(article.html.includes("syndicates the whole article"));
  assert.ok(article.wordCount > 100, "the whole body, not a snippet");

  // The same sanitising as any other article.
  assert.ok(!/<script/i.test(article.html), "no script survives");
  assert.ok(!/<nav/i.test(article.html), "navigation is dropped");
  assert.ok(
    article.html.includes("http://127.0.0.1:8789/img/photo.jpg"),
    "images are made absolute",
  );
});

test("does not pass off a teaser as the article", async () => {
  const content = await fetchFeedItemContent(FEED, "http://127.0.0.1:8789/story/two");
  assert.equal(content, null, "a short description is not full text");
});

test("returns nothing for an entry the feed does not have", async () => {
  const content = await fetchFeedItemContent(FEED, "http://127.0.0.1:8789/story/nope");
  assert.equal(content, null);
});
