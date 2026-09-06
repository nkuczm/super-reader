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

test("unwraps aggregator links to the publisher", async () => {
  const { unwrapRedirect } = await import("../lib/feed");

  // Bing puts the destination in a plain query parameter.
  assert.equal(
    unwrapRedirect(
      "http://www.bing.com/news/apiclick.aspx?ref=FexRss&url=https%3a%2f%2f247wallst.com%2finvesting%2f2026%2f09%2fstory%2f&c=123",
    ),
    "https://247wallst.com/investing/2026/09/story/",
  );

  // Google's /url? redirector, same idea.
  assert.equal(
    unwrapRedirect("https://www.google.com/url?q=https://example.com/piece"),
    "https://example.com/piece",
  );

  // An ordinary article link is returned untouched.
  assert.equal(
    unwrapRedirect("https://example.com/news/story"),
    "https://example.com/news/story",
  );

  // No destination to recover: leave it alone rather than mangling it.
  const opaque =
    "https://news.google.com/rss/articles/CBMidkFVX3lxTE9mUGNqZnNW?oc=5";
  assert.equal(unwrapRedirect(opaque), opaque);
});

test("recognises links only a browser can resolve", async () => {
  const { isUnresolvableAggregatorLink } = await import("../lib/discover");
  assert.ok(
    isUnresolvableAggregatorLink(
      "https://news.google.com/rss/articles/CBMidkFVX3lxTE9m?oc=5",
    ),
  );
  assert.ok(!isUnresolvableAggregatorLink("https://example.com/news/story"));
});
