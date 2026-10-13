import test from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { cleanArticleHtml, takeHeadline } from "../lib/own-article";

const parse = (html: string) => new JSDOM(html).window.document;
const BASE = "https://news.example.com/2026/10/story";
const clean = (html: string) => cleanArticleHtml(html, BASE, parse);

test("pasted as an article: pictures, links and headings kept, nothing that runs and none of the site's furniture", () => {
  const html = clean(`
    <nav><a href="/">Home</a> <a href="/world">World</a></nav>
    <article>
      <h1 onclick="steal()">Water board raises rates</h1>
      <figure><img src="/photos/dam.jpg" onerror="steal()" width="800" height="450" alt="The dam"><figcaption>The dam in May.</figcaption></figure>
      <p style="color:red">The board voted <a href="javascript:steal()">on Tuesday</a> to raise rates, <a href="/budget">its budget</a> shows.</p>
      <script>steal()</script><button>Share</button>
      <img src="data:image/gif;base64,R0lGOD" data-src="https://cdn.example.com/chart.png">
    </article>
    <aside>Most read</aside><footer>© News</footer>`);
  assert.equal(html, [
    "<h1>Water board raises rates</h1>",
    '<figure><img src="https://news.example.com/photos/dam.jpg" alt="The dam" width="800" height="450" /><figcaption>The dam in May.</figcaption></figure>',
    '<p>The board voted <a>on Tuesday</a> to raise rates, <a href="https://news.example.com/budget">its budget</a> shows.</p>',
    '<p><img src="https://cdn.example.com/chart.png" alt="" /></p>',
  ].join("\n"));
});

test("a long article is kept whole", () => {
  const body = Array.from({ length: 400 }, (_, i) => `<p>Paragraph ${i} of a long story, which goes on and on for many screens.</p>`).join("");
  const html = clean(`<div>${body}</div>`);
  assert.equal((html.match(/<p>/g) ?? []).length, 400);
  assert.match(html, /Paragraph 399 of a long story/);
});

test("lines typed into the box stay lines", () => {
  assert.equal(clean("A headline typed first<div>Then the story's first paragraph.</div><div><br></div><div>And its second.</div>"),
    "<p>A headline typed first</p>\n<p>Then the story's first paragraph.</p>\n<p>And its second.</p>");
});

test("the headline is the first main heading, or a short first line typed or pasted above the story", () => {
  const fromHeading = takeHeadline(clean("<p>Advertisement</p><h1>Water board raises rates</h1><p>The board voted.</p><h1>What comes next</h1>"), parse);
  assert.equal(fromHeading.title, "Water board raises rates");
  assert.equal(fromHeading.html, "<p>Advertisement</p>\n<p>The board voted.</p>\n<h2>What comes next</h2>");

  const typed = takeHeadline(clean("The aquifer is running dry<div>The district pumped more than it could replace.</div><div>It will pump more next year.</div>"), parse);
  assert.equal(typed.title, "The aquifer is running dry");
  assert.doesNotMatch(typed.html, /running dry/);

  // A first line that is a sentence, or the site's chrome, is the story, not its headline.
  assert.equal(takeHeadline(clean("<p>The board voted on Tuesday.</p><p>Rates rise.</p><p>More later.</p>"), parse).title, undefined);
  assert.equal(takeHeadline(clean("<p>Skip to main content</p><p>Rates rise.</p><p>More later.</p>"), parse).title, undefined);
});
