import { test } from "node:test";
import assert from "node:assert/strict";
import { attributeStories, inAnySource, inSource } from "../lib/attribute";
import { canonicalUrl } from "../lib/url";

const story = (link: string, title = link) => ({ id: link, link, title });

test("a story two sources deliver is shown once, filed under its publisher, and in both", () => {
  // The news search comes first in the refresh; it used to take every story from OpenAI's own feed.
  const sources = [
    { id: "topic", feedUrl: "https://www.bing.com/news/search?q=openai&format=rss" },
    { id: "openai", feedUrl: "https://openai.com/news/rss.xml", siteUrl: "https://openai.com/news" },
  ];
  const out = attributeStories(
    [
      { feedUrl: sources[0].feedUrl, articles: [story("https://openai.com/index/sophos?utm_source=bing"), story("https://www.theverge.com/ai/1")] },
      { feedUrl: sources[1].feedUrl, articles: [story("https://openai.com/index/sophos"), story("https://openai.com/index/asana")] },
    ],
    sources,
    canonicalUrl,
  );
  assert.equal(out.length, 3);
  const sophos = out.find((a) => a.link.startsWith("https://openai.com/index/sophos"))!;
  assert.equal(sophos.sourceId, "openai");
  assert.deepEqual(sophos.alsoIn, ["topic"]);
  assert.equal(sophos.link, "https://openai.com/index/sophos");
  assert.equal(out.filter((a) => inSource(a, "openai")).length, 2);
  assert.equal(out.filter((a) => inSource(a, "topic")).length, 2);
  assert.equal(out.filter((a) => inAnySource(a, new Set(["openai"]))).length, 2);
});

test("with no publisher among them, the first source to deliver a story keeps it", () => {
  const sources = [
    { id: "a", feedUrl: "https://agg-one.example/rss" },
    { id: "b", feedUrl: "https://agg-two.example/rss" },
  ];
  const out = attributeStories(
    [{ feedUrl: sources[0].feedUrl, articles: [story("https://paper.example/x")] }, { feedUrl: sources[1].feedUrl, articles: [story("https://paper.example/x")] }],
    sources,
    canonicalUrl,
  );
  assert.equal(out.length, 1);
  assert.equal(out[0].sourceId, "a");
  assert.deepEqual(out[0].alsoIn, ["b"]);
  assert.equal(out[0].id, "a:https://paper.example/x");
});

test("two sources following the same feed both get its stories", () => {
  const sources = [
    { id: "in-ai-folder", feedUrl: "https://openai.com/news/rss.xml" },
    { id: "on-its-own", feedUrl: "https://openai.com/news/rss.xml" },
  ];
  const out = attributeStories([{ feedUrl: "https://openai.com/news/rss.xml", articles: [story("https://openai.com/index/a")] }], sources, canonicalUrl);
  assert.equal(out.length, 1);
  assert.ok(inSource(out[0], "in-ai-folder") && inSource(out[0], "on-its-own"));
});
