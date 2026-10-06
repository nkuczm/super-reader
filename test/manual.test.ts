import test from "node:test";
import assert from "node:assert/strict";
import { linkIn, mergeManual, sourceFor } from "../lib/manual";

test("the link is found in whatever was copied", () => {
  assert.equal(linkIn("https://www.nytimes.com/2026/09/30/us/story.html"), "https://www.nytimes.com/2026/09/30/us/story.html");
  assert.equal(linkIn("Read this: https://a.com/x/y?z=1."), "https://a.com/x/y?z=1");
  assert.equal(linkIn("Big news — (https://a.com/story)"), "https://a.com/story");
  assert.equal(linkIn("no link here"), null);
});

test("a story is filed under the followed source for its site, sections first", () => {
  const sources = [
    { id: "nyt", feedUrl: "https://rss.nytimes.com/services/xml/rss/nyt/HomePage.xml", siteUrl: "https://www.nytimes.com" },
    { id: "nyt-tech", feedUrl: "https://rss.nytimes.com/x.xml", siteUrl: "https://www.nytimes.com/section/technology" },
    { id: "topic", kind: "topic", feedUrl: "https://www.bing.com/news/search?q=x", siteUrl: "https://www.bing.com/news" },
  ];
  assert.equal(sourceFor("https://www.nytimes.com/2026/09/30/us/a.html", sources)?.id, "nyt");
  assert.equal(sourceFor("https://www.nytimes.com/section/technology/b", sources)?.id, "nyt-tech");
  assert.equal(sourceFor("https://cooking.nytimes.com/recipes/1", sources)?.id, "nyt");
  assert.equal(sourceFor("https://notnytimes.com/a", sources), null);
  assert.equal(sourceFor("https://www.bing.com/news/a", sources), null, "a topic search is not a source to file under");
});

test("pasted stories merge per link, a deletion outranking an older copy", () => {
  const story = { link: "https://a.com/x", title: "X", at: 100 };
  const merged = mergeManual({ k: story }, { k: { ...story, deleted: true, at: 200 } }, 300);
  assert.equal(merged.k.deleted, true);
});

test("malformed stored feeds are dropped rather than crashing the sidebar", async () => {
  const { cleanFeeds } = await import("../lib/store");
  const cleaned = cleanFeeds([
    { id: "f1", name: "Tech", sources: null },
    { id: "f2", name: "News", sources: [{ id: "s1", feedUrl: "https://a.com/feed" }, null, { id: 5 }] },
    "junk",
    null,
  ]);
  assert.equal(cleaned.length, 2);
  assert.deepEqual(cleaned[0].sources, []);
  assert.equal(cleaned[1].sources.length, 1);
  assert.deepEqual(cleanFeeds("nope"), []);
});

test("shared settings from another device are checked before they are applied", async () => {
  const { cleanSharedPrefs } = await import("../lib/store");
  assert.deepEqual(cleanSharedPrefs({ subjects: true, aiProvider: "openai", openaiModel: " gpt-5 ", at: 5 }), {
    subjects: true, aiProvider: "openai", openaiModel: "gpt-5", anthropicModel: "claude-opus-5-5", at: 5,
  });
  assert.equal(cleanSharedPrefs({ subjects: "yes", at: 5 }), null);
  assert.equal(cleanSharedPrefs(null), null);
  assert.equal(cleanSharedPrefs({ subjects: true, aiProvider: "evil", at: 1 })?.aiProvider, "anthropic");
});
