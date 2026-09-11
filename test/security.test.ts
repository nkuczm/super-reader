import test from "node:test";
import assert from "node:assert/strict";
import { structuredArticle } from "../lib/structured";
import { scrapePage } from "../lib/scrape";
import { articleFromFeedContent, sanitizeArticleHtml } from "../lib/article";
import { parseFeed } from "../lib/feed";
import { fileKindFor, imageUrlFor } from "../lib/files";
import { httpUrlOrNull } from "../lib/url";

/**
 * Everything this app renders comes from somewhere else — a feed, a page, a
 * Reddit thread — and none of it is trusted. These are the cases that would
 * turn "read this article" into "run this".
 */

const PAYLOADS = [
  `<script>alert(1)</script>`,
  `<img src=x onerror="alert(1)">`,
  `<iframe src="https://evil.test/"></iframe>`,
  `<a href="javascript:alert(1)">click</a>`,
  `<div onclick="alert(1)">text</div>`,
  `<style>body{background:url('https://evil.test/beacon')}</style>`,
  `<form action="https://evil.test/"><input name="p"></form>`,
  `<object data="https://evil.test/x.swf"></object>`,
  `<svg><use href="data:image/svg+xml;base64,PHN2Zz4="></use></svg>`,
  `<a href="data:text/html,<script>alert(1)</script>">d</a>`,
];

function assertInert(html: string, where: string) {
  assert.doesNotMatch(html, /<script|<iframe|<object|<embed|<form|<style/i, `${where}: tag`);
  assert.doesNotMatch(html, /\son\w+\s*=/i, `${where}: event handler`);
  assert.doesNotMatch(html, /javascript:/i, `${where}: javascript URL`);
  assert.doesNotMatch(html, /data:text\/html/i, `${where}: data document`);
}

test("a hostile feed body cannot carry anything executable", () => {
  for (const payload of PAYLOADS) {
    const article = articleFromFeedContent(
      `<p>Fine.</p>${payload}`,
      "https://publisher.test/story",
      "A story",
    );
    assertInert(article.html, `feed body ${payload.slice(0, 24)}`);
  }
});

/**
 * A JSON-LD block is still a <script> element, so a literal `</script>` inside
 * it ends the block early — in this parser and in every browser. A page that
 * wants its payload delivered has to write `<\/script>`, which is what this
 * does. Handing the parser an unescaped one would be testing that broken
 * markup stays broken, which proves nothing about the sanitiser.
 */
const deliverable = (value: string) => JSON.stringify(value).replace(/<\//g, "<\\/");

test("structured data is sanitised like anything else, markup and all", () => {
  // articleBody may legitimately contain markup, so it is not escaped
  // wholesale — which makes it a body source like the others and means it has
  // to go through the same sanitiser. This is the test that says so.
  for (const payload of PAYLOADS) {
    const data = structuredArticle(
      `<script type="application/ld+json">{"@type":"NewsArticle",` +
        `"headline":"Hostile","articleBody":${deliverable(`<p>Fine.</p>${payload}`)}}` +
        `</script>`,
    );
    assert.ok(data?.body, `the body was read for ${payload.slice(0, 24)}`);
    const article = sanitizeArticleHtml(data!.body!, "https://publisher.test/story", {
      title: "Hostile",
    });
    assertInert(article.html, `structured body ${payload.slice(0, 24)}`);
  }
});

test("a headline or byline from structured data is text, never markup", () => {
  const data = structuredArticle(
    `<script type="application/ld+json">{"@type":"NewsArticle",` +
      `"headline":${deliverable("<img src=x onerror=alert(1)>")},` +
      `"author":{"name":${deliverable("<script>alert(1)</script>")}},` +
      `"keywords":${deliverable("<b>tag</b>, ok")}}</script>`,
  );
  // React escapes these when it renders them; what matters here is that they
  // arrive as the strings they are and are never treated as HTML on the way.
  assert.equal(data?.headline, `<img src=x onerror=alert(1)>`);
  assert.equal(data?.byline, `<script>alert(1)</script>`);
  assert.deepEqual(data?.keywords, ["<b>tag</b>", "ok"]);
});

test("a scraped listing page yields no executable markup", () => {
  // Real-looking slugs and headlines: the scraper rejects one-word paths and
  // very short titles, which is correct and would make a toy fixture prove
  // nothing.
  const cards = [
    "harbour-works-approved",
    "bridge-inspection-report",
    "grant-scheme-opens",
    "quay-closure-notice",
    "dredging-consultation",
  ]
    .map(
      (slug) =>
        `<a href="/news/${slug}"><h3>Council publishes ${slug.replace(/-/g, " ")}` +
        `<script>alert(1)</script><img src=x onerror=alert(1)></h3></a>`,
    )
    .join("");
  const { articles } = scrapePage(
    `<html><body><main>${cards}</main></body></html>`,
    "https://site.test/news",
  );
  assert.ok(articles.length >= 3, "the fixture is a list the scraper accepts");
  for (const article of articles) {
    assert.doesNotMatch(article.title, /<script|onerror/i);
  }
});

test("a link the app cannot open never enters the article model", () => {
  for (const bad of [
    "javascript:alert(1)//x.pdf",
    "JaVaScRiPt:alert(1)#.pdf",
    "data:text/html,<script>alert(1)</script>#x.pdf",
    "vbscript:msgbox(1)#x.csv",
  ]) {
    assert.equal(fileKindFor(bad), null, `${bad} is not a file`);
    assert.equal(imageUrlFor(bad.replace(/\.(pdf|csv)/, ".jpg")), null, `${bad} is not a picture`);
    assert.equal(httpUrlOrNull(bad), null, `${bad} is not a link`);
  }
  assert.equal(fileKindFor("https://ok.test/real.pdf"), "pdf");
  assert.equal(httpUrlOrNull("https://ok.test/a"), "https://ok.test/a");
});

test("an enclosure with an unusable scheme is dropped, not shown", () => {
  const { articles } = parseFeed(
    `<?xml version="1.0"?><rss version="2.0"><channel>
      <title>Hostile</title><link>https://feed.test</link><description>x</description>
      <item><title>One</title><link>https://feed.test/1</link>
        <enclosure url="javascript:alert(1)//x.pdf" type="application/pdf"/>
      </item>
     </channel></rss>`,
    "https://feed.test/rss",
  );
  assert.equal(articles[0].attachments, undefined);
});

/**
 * The DoS this caught was real and self-inflicted: `[^>]*` before a literal
 * backtracks from every position the literal fails at, so a page whose tags
 * never close made tag-matching quadratic. Measured at 91.7 seconds of CPU on
 * a 4MB page, against routes that are allowed 30 — and these parsers run on
 * pages fetched from wherever a feed points, so nobody has to click anything.
 *
 * The bound is generous: the point is to catch a return to quadratic time,
 * which was three orders of magnitude slower than this.
 */
test("a page built to make the parsers backtrack stays cheap", () => {
  const hostile = ("<script " + "a".repeat(200)).repeat(20_000);
  const started = Date.now();
  structuredArticle(hostile);
  const elapsed = Date.now() - started;
  assert.ok(elapsed < 5_000, `structured-data scan took ${elapsed}ms`);
});

test("the same page does not hang the scraper either", () => {
  const hostile = ("<a " + "a".repeat(200)).repeat(20_000);
  const started = Date.now();
  try {
    scrapePage(hostile, "https://site.test/news");
  } catch {
    // "no list of articles here" is the right answer; the time is the test.
  }
  const elapsed = Date.now() - started;
  assert.ok(elapsed < 5_000, `anchor scan took ${elapsed}ms`);
});
