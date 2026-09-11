import test from "node:test";
import assert from "node:assert/strict";
import { startThinPageSite } from "./fixtures.mjs";
import { extractArticle, preferSyndicated, pickBody } from "../lib/article";
import { fetchFeedItemContent } from "../lib/feed";
import { structuredArticle, bodyToHtml, jsonLdNodes } from "../lib/structured";
import { paywallVerdict, endsAtWall } from "../lib/paywall";

/**
 * The failure these cover is the quiet one: the page answers, Readability
 * extracts what it was given perfectly, and the reader shows a confident
 * article that happens to be a third of the story.
 */
const S = "http://127.0.0.1:8793";
let site: { close: () => void };

test.before(async () => {
  site = await startThinPageSite(8793);
});
test.after(() => site.close());

test("a page whose body is rendered in the browser is read from its structured data", async () => {
  const article = await extractArticle(`${S}/shell`);

  assert.equal(article.via, "data", "the page's HTML has no article in it");
  assert.match(article.html, /two hundred pages/);
  assert.match(article.html, /changed their minds/);
  assert.equal(article.title, "Committee report published");
  assert.equal(article.byline, "Newsroom Staff");
  assert.match(article.publishedAt ?? "", /^2026-09-02/);
  // The paragraph breaks in articleBody are paragraphs, not one slab.
  assert.ok(
    (article.html.match(/<p>/g) ?? []).length >= 3,
    "articleBody's line breaks become paragraphs",
  );
});

test("a metered page is marked as the free part, not passed off as the article", async () => {
  const article = await extractArticle(`${S}/metered`);

  assert.equal(article.partial, true);
  assert.match(article.partialReason ?? "", /subscriber-only|meters/i);
  // What it did get is still shown, with the publisher's own byline.
  assert.match(article.html, /first\s+finding was blunt/);
  assert.match(article.byline ?? "", /Ada Byron/);
  assert.match(article.byline ?? "", /Sam Roe/);
  assert.deepEqual(article.topics, ["audit", "public spending"]);
});

test("the publisher's syndicated copy replaces the teaser when it is fuller", async () => {
  const article = await extractArticle(`${S}/metered`);
  const content = await fetchFeedItemContent(`${S}/feed.xml`, `${S}/metered`);
  assert.ok(content, "the fixture feed carries content:encoded");

  const full = preferSyndicated(article, content!, "The ledger nobody checked");

  assert.equal(full.via, "feed");
  assert.ok(
    full.wordCount > article.wordCount * 3,
    `the feed copy is the whole article (${article.wordCount} → ${full.wordCount})`,
  );
  assert.match(full.html, /auditors found/);
  assert.equal(
    full.partial,
    undefined,
    "the wall was on the page; what the publisher syndicated is not behind it",
  );
  // The metadata the page gave is kept — only the body is replaced.
  assert.equal(full.byline, article.byline);
  assert.ok(full.byline, "and there was a byline to keep");
});

test("the syndicated copy is refused when it is no fuller than the page", async () => {
  const article = await extractArticle(`${S}/metered`);
  const kept = preferSyndicated(article, "<p>A one line summary.</p>", "x");

  assert.equal(kept.via, "page", "a summary must not replace the extracted text");
  assert.equal(kept.wordCount, article.wordCount);
});

test("a thin page falls back to the AMP copy it declares", async () => {
  const article = await extractArticle(`${S}/amp-stub`);

  assert.equal(article.via, "amp");
  assert.match(article.html, /auditors found/);
  assert.ok(article.wordCount > 200);
});

test("one malformed JSON-LD block does not cost the page the valid one", async () => {
  const article = await extractArticle(`${S}/broken-ld`);

  assert.equal(article.via, "data");
  assert.match(article.html, /annex is the interesting part/);
});

test("pickBody prefers the page at comparable length and yields at a distance", () => {
  const page = { via: "page" as const, html: "", words: 300 };
  const feed = { via: "feed" as const, html: "", words: 380 };
  assert.equal(
    pickBody([page, feed])?.via,
    "page",
    "the page brings pictures and links; a 27% edge is not worth losing them",
  );
  assert.equal(pickBody([page, { ...feed, words: 900 }])?.via, "feed");
  // A short post must not be replaced on the ratio alone.
  assert.equal(
    pickBody([{ via: "page", html: "", words: 40 }, { via: "feed", html: "", words: 90 }])?.via,
    "page",
  );
  assert.equal(pickBody([]), null);
});

test("structured data is read out of a @graph and off several nodes at once", () => {
  const html = `<script type="application/ld+json">{"@context":"https://schema.org",
    "@graph":[
      {"@type":"WebPage","name":"Page title","publisher":{"name":"The Gazette"}},
      {"@type":"NewsArticle","headline":"Real headline","articleBody":"Body text.",
       "author":{"name":"Jo Bloggs"},"isAccessibleForFree":"False"}
    ]}</script>`;
  const data = structuredArticle(html);

  assert.equal(data?.headline, "Real headline", "the article node outranks the page node");
  assert.equal(data?.byline, "Jo Bloggs");
  assert.equal(data?.free, false, '"False" is an answer, not a string');
  assert.equal(data?.siteName, "The Gazette", "taken from the node that had it");

  const two = structuredArticle(
    `<script type="application/ld+json">{"@type":"Article","headline":"H",
      "author":[{"name":"Ada Byron"},{"name":"Sam Roe"},{"name":"Ada Byron"}]}</script>`,
  );
  assert.equal(two?.byline, "Ada Byron and Sam Roe", "listed authors read as a byline");
});

test("a page with no article node in its structured data yields nothing", () => {
  const html = `<script type="application/ld+json">
    {"@type":"BreadcrumbList","itemListElement":[]}</script>`;
  assert.equal(structuredArticle(html), null);
});

test("jsonLdNodes survives a trailing comma and a CDATA wrapper", () => {
  const nodes = jsonLdNodes(
    `<script type="application/ld+json">//<![CDATA[
     {"@type":"Article","headline":"Hi",}
     ]]></script>`,
  );
  assert.equal(nodes.length, 1);
  assert.equal(nodes[0].headline, "Hi");
});

test("bodyToHtml keeps real markup and paragraphs plain text", () => {
  assert.equal(bodyToHtml("<p>Already markup.</p>"), "<p>Already markup.</p>");
  assert.equal(bodyToHtml("One.\n\nTwo."), "<p>One.</p>\n<p>Two.</p>");
  assert.equal(bodyToHtml("One.\nTwo."), "<p>One.</p>\n<p>Two.</p>");
  assert.match(bodyToHtml("Tom & Jerry <3"), /Tom &amp; Jerry &lt;3/);
});

test("the paywall verdict believes the publisher in both directions", () => {
  assert.equal(paywallVerdict("<html></html>", false).declared, true);
  assert.equal(
    paywallVerdict(`<div class="paywall">x</div>`, true).marked,
    false,
    "a page declaring itself free outranks the vendor markup in its template",
  );
  assert.equal(
    paywallVerdict(`<meta property="article:content_tier" content="free">`).marked,
    false,
  );
  assert.equal(
    paywallVerdict(`<meta property="article:content_tier" content="locked">`).marked,
    true,
  );
  assert.equal(
    paywallVerdict(`<p>Our unpaywalled archive is open.</p>`).marked,
    false,
    "a whole-word match, so 'unpaywalled' is not a wall",
  );
});

test("a wall is only read at the end of the text, so an article about walls survives", () => {
  assert.equal(endsAtWall("Subscribe to continue reading."), true);
  assert.equal(
    endsAtWall(
      "Many sites now say 'subscribe to continue reading'. " +
        "This piece examines why. ".repeat(40),
    ),
    false,
  );
});
