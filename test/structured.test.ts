import test from "node:test";
import assert from "node:assert/strict";
import { articlesFromStructured, jsonLdBlocks, searchTemplateFrom } from "../lib/structured";

const page = (json: string) =>
  `<html><head><script type="application/ld+json">${json}</script></head><body></body></html>`;

test("an ItemList of bare URLs becomes candidates", () => {
  const html = page(
    JSON.stringify({
      "@context": "https://schema.org",
      "@type": "ItemList",
      itemListElement: [
        { "@type": "ListItem", position: 1, url: "https://paper.example/2026/09/14/first-story-today" },
        { "@type": "ListItem", position: 2, url: "https://paper.example/2026/09/14/second-story-today" },
      ],
    }),
  );
  const articles = articlesFromStructured(html, "https://paper.example/us");
  assert.deepEqual(articles.map((a) => a.link), [
    "https://paper.example/2026/09/14/first-story-today",
    "https://paper.example/2026/09/14/second-story-today",
  ]);
});

test("full Article records bring headline, date, summary and image", () => {
  const html = page(
    JSON.stringify({
      "@context": "https://schema.org",
      "@graph": [
        {
          "@type": "NewsArticle",
          url: "https://paper.example/2026/09/14/the-headline-here",
          headline: "The headline here",
          datePublished: "2026-09-14T08:00:00Z",
          description: "What the story is about, at some length.",
          image: { "@type": "ImageObject", url: "https://paper.example/i.jpg" },
          author: { "@type": "Person", name: "A Reporter" },
        },
      ],
    }),
  );
  const [article] = articlesFromStructured(html, "https://paper.example/");
  assert.equal(article.title, "The headline here");
  assert.equal(article.publishedAt, new Date("2026-09-14T08:00:00Z").toISOString());
  assert.equal(article.summary, "What the story is about, at some length.");
  assert.equal(article.image, "https://paper.example/i.jpg");
  assert.equal(article.author, "A Reporter");
});

test("a richer record later on the page wins over a bare URL earlier", () => {
  const html =
    page(
      JSON.stringify({
        "@type": "ItemList",
        itemListElement: [{ "@type": "ListItem", url: "https://paper.example/a/the-same-story-twice" }],
      }),
    ) +
    page(
      JSON.stringify({
        "@type": "NewsArticle",
        url: "https://paper.example/a/the-same-story-twice",
        headline: "The same story twice",
        datePublished: "2026-09-14T08:00:00Z",
      }),
    );
  const articles = articlesFromStructured(html, "https://paper.example/");
  assert.equal(articles.length, 1, "one story, not two");
  assert.equal(articles[0].title, "The same story twice");
  assert.ok(articles[0].publishedAt);
});

test("relative URLs are resolved against the page", () => {
  const html = page(
    JSON.stringify({
      "@type": "ItemList",
      itemListElement: [{ "@type": "ListItem", url: "/2026/09/14/a-relative-link-here" }],
    }),
  );
  const [article] = articlesFromStructured(html, "https://paper.example/section");
  assert.equal(article.link, "https://paper.example/2026/09/14/a-relative-link-here");
});

test("one invalid block does not cost us the valid ones beside it", () => {
  const html =
    `<script type="application/ld+json">{ this is not json }</script>` +
    page(
      JSON.stringify({
        "@type": "BlogPosting",
        url: "https://blog.example/a-post-that-parsed",
        headline: "A post that parsed",
      }),
    );
  assert.equal(jsonLdBlocks(html).length, 1, "the broken block is skipped");
  assert.equal(articlesFromStructured(html, "https://blog.example/").length, 1);
});

test("the site's own search URL is read from its SearchAction", () => {
  const html = page(
    JSON.stringify({
      "@type": "WebSite",
      url: "https://paper.example/",
      potentialAction: {
        "@type": "SearchAction",
        target: {
          "@type": "EntryPoint",
          urlTemplate: "https://paper.example/?s={search_term_string}",
        },
        "query-input": "required name=search_term_string",
      },
    }),
  );
  assert.equal(searchTemplateFrom(html), "https://paper.example/?s={search_term_string}");
});

test("a page that declares nothing yields nothing, quietly", () => {
  const html = "<html><body><a href='/x'>hi</a></body></html>";
  assert.deepEqual(articlesFromStructured(html, "https://x.example/"), []);
  assert.equal(searchTemplateFrom(html), undefined);
});

test("a template with no placeholder is not a search", () => {
  const html = page(
    JSON.stringify({
      "@type": "SearchAction",
      target: "https://paper.example/search",
    }),
  );
  assert.equal(searchTemplateFrom(html), undefined);
});
