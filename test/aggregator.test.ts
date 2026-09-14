import test from "node:test";
import assert from "node:assert/strict";
import { parseFeed } from "../lib/feed";

/**
 * The shape Google News really returns, taken from the live feed for
 * site:apnews.com: the publisher appended to every headline, and a
 * description that is the headline again inside a link.
 */
const GOOGLE_NEWS = `<?xml version="1.0"?>
<rss version="2.0"><channel>
  <title>"site:apnews.com when:2d" - Google News</title>
  <link>https://news.google.com/search?q=site:apnews.com</link>
  <item>
    <title>Iranian cargo ship is struck, and talks between Tehran and its neighbors are postponed - AP News</title>
    <link>https://news.google.com/rss/articles/CBMilAFBVV95cUxNMG04?oc=5</link>
    <guid isPermaLink="false">CBMilAFBVV95cUxNMG04</guid>
    <pubDate>Mon, 14 Sep 2026 01:17:00 GMT</pubDate>
    <description>&lt;a href="https://news.google.com/rss/articles/CBMilAFBVV95cUxNMG04?oc=5"&gt;Iranian cargo ship is struck, and talks between Tehran and its neighbors are postponed&lt;/a&gt;&nbsp;&nbsp;AP News</description>
    <source url="https://apnews.com">AP News</source>
  </item>
  <item>
    <title>A headline that ends in a dash - and then some words</title>
    <link>https://news.google.com/rss/articles/CBMiotherstory?oc=5</link>
    <pubDate>Mon, 14 Sep 2026 00:04:00 GMT</pubDate>
    <description>Something the feed actually said about the story.</description>
    <source url="https://apnews.com">AP News</source>
  </item>
</channel></rss>`;

test("drops the publisher Google News appends to every headline", () => {
  const { articles } = parseFeed(
    GOOGLE_NEWS,
    "https://news.google.com/rss/search?q=site%3Aapnews.com+when%3A2d",
  );
  assert.equal(
    articles[0].title,
    "Iranian cargo ship is struck, and talks between Tehran and its neighbors are postponed",
  );
  // Only the suffix the item's own <source> named is removed — a headline
  // that happens to contain a dash keeps every word of itself.
  assert.equal(articles[1].title, "A headline that ends in a dash - and then some words");
});

test("drops a summary that only repeats the headline", () => {
  const { articles } = parseFeed(
    GOOGLE_NEWS,
    "https://news.google.com/rss/search?q=site%3Aapnews.com+when%3A2d",
  );
  assert.equal(articles[0].summary, undefined);
  // A summary with something of its own to say is kept.
  assert.equal(articles[1].summary, "Something the feed actually said about the story.");
});

test("leaves a publisher's own feed alone", () => {
  const OWN = GOOGLE_NEWS.replace(/news\.google\.com/g, "feeds.example.com");
  const { articles } = parseFeed(OWN, "https://feeds.example.com/rss");
  // No aggregator, no tidying: what the publisher wrote is what they meant.
  assert.match(articles[0].title, / - AP News$/);
  assert.ok(articles[0].summary);
});
