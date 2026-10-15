import test from "node:test";
import assert from "node:assert/strict";
import { homepageOf } from "../lib/homepage";

test("a source's home page is its own site, never the feed's aggregator or a search", () => {
  assert.equal(homepageOf({ kind: "feed", siteUrl: "https://www.techmeme.com/", feedUrl: "https://www.techmeme.com/feed.xml" }), "https://www.techmeme.com/");
  // No site recorded: where the feed is served from.
  assert.equal(homepageOf({ kind: "feed", feedUrl: "https://blog.example.org/rss/index.xml" }), "https://blog.example.org/");
  // AP read through Google News: AP's site, not Google's.
  assert.equal(homepageOf({ kind: "feed", siteUrl: "https://apnews.com", feedUrl: "https://news.google.com/rss/search?q=site:apnews.com" }), "https://apnews.com/");
  assert.equal(homepageOf({ kind: "feed", siteUrl: "", feedUrl: "https://news.google.com/rss/search?q=x" }), null);
  assert.equal(homepageOf({ kind: "topic", siteUrl: "https://www.bing.com/news", feedUrl: "https://www.bing.com/news/search?q=openai&format=rss" }), null);
  assert.equal(homepageOf({ kind: "api", feedUrl: "api:arxiv?q=cat:cs.AI" }), null);
});
