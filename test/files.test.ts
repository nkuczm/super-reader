import test from "node:test";
import assert from "node:assert/strict";
import { startFileSite } from "./fixtures.mjs";
import {
  fileKindFor,
  fileNameFrom,
  readFileAsArticle,
} from "../lib/files";
import { fetchText, parseFeed } from "../lib/feed";

const F = "http://127.0.0.1:8791";
let site: { close: () => void };

test.before(async () => {
  site = await startFileSite(8791);
});
test.after(() => site.close());

test("recognises the file types worth reading, and refuses the rest", () => {
  assert.equal(fileKindFor("https://x.test/a/report.pdf"), "pdf");
  assert.equal(fileKindFor("https://x.test/rows.csv"), "csv");
  assert.equal(fileKindFor("https://x.test/notes.md"), "markdown");
  assert.equal(fileKindFor("https://x.test/data.json"), "json");

  // A declared type beats the path, in both directions.
  assert.equal(fileKindFor("https://x.test/download?id=9", "application/pdf"), "pdf");
  assert.equal(
    fileKindFor("https://x.test/report.pdf", "text/html; charset=utf-8"),
    null,
    "a page that merely ends in .pdf is not a PDF",
  );

  assert.equal(fileKindFor("https://x.test/photo.jpg"), null, "images need a viewer");
  assert.equal(fileKindFor("https://x.test/clip.mp4"), null);
  assert.equal(fileKindFor("https://x.test/archive.zip"), null);
  assert.equal(fileKindFor("https://x.test/article"), null);
});

test("names a file from its URL", () => {
  assert.equal(fileNameFrom("https://x.test/docs/final%20rule.pdf"), "final rule.pdf");
  assert.equal(fileNameFrom("https://x.test/"), "File");
});

test("a PDF becomes readable text", async () => {
  const file = await readFileAsArticle(`${F}/notice.pdf`);
  assert.equal(file.fileKind, "pdf");
  assert.equal(file.via, "file");
  assert.match(file.html, /Notice of proposed rulemaking/);
  assert.match(file.html, /amend part 40/);
  assert.ok(file.wordCount > 5);
  assert.ok(file.bytes > 0);
});

test("a CSV becomes a table, not a wall of commas", async () => {
  const file = await readFileAsArticle(`${F}/rows.csv`);
  assert.equal(file.fileKind, "csv");
  assert.match(file.html, /<table>/);
  assert.match(file.html, /<th>docket<\/th>/);
  assert.match(file.html, /<td>EPA-2025-1<\/td>/);
});

test("a text file keeps its paragraphs", async () => {
  const file = await readFileAsArticle(`${F}/readme.txt`);
  assert.equal(file.fileKind, "text");
  assert.match(file.html, /<p>First paragraph\.<\/p>/);
  assert.match(file.html, /<p>Second paragraph\.<\/p>/);
});

test("a file with no extension is read from its declared type", async () => {
  const file = await readFileAsArticle(`${F}/notes`);
  assert.equal(file.fileKind, "text");
  assert.match(file.html, /no extension at all/);
  assert.equal(file.title, "notes", "named from the URL when the feed gives none");
});

test("a feed's file enclosures become attachments, images stay images", async () => {
  const { body, finalUrl } = await fetchText(`${F}/rss`);
  const { articles } = parseFeed(body, finalUrl);

  const notice = articles.find((a) => a.title.startsWith("Notice"))!;
  assert.deepEqual(notice.attachments, [
    { url: `${F}/notice.pdf`, kind: "pdf", bytes: 657 },
  ]);

  const data = articles.find((a) => a.title.startsWith("Comment"))!;
  assert.deepEqual(
    data.attachments?.map((a) => a.kind),
    ["csv"],
    "the jpeg enclosure is an image, not a file to read",
  );
  assert.equal(data.image, `${F}/cover.jpg`, "and it is still used as the image");
});

test("a file linked in the story's own text becomes an attachment", async () => {
  // What must not happen is a chip on every item because some field exists;
  // a file shows up when the publication actually links one.
  const feed = `<?xml version="1.0"?><rss version="2.0"><channel>
    <title>Notices</title><link>https://agency.test</link>
    <item><title>With a link</title><link>https://agency.test/a</link><guid>a</guid>
    <description><![CDATA[<p>The full text is in the
      <a href="/docs/final-rule.pdf">final rule</a>, and the
      <a href="/press">press release</a> summarises it.</p>]]></description></item>
    <item><title>Plain story</title><link>https://agency.test/b</link><guid>b</guid>
    <description><![CDATA[<p>No files here, just <a href="/more">a link</a>.</p>]]></description></item>
    </channel></rss>`;

  const { parseFeed } = await import("../lib/feed");
  const { articles } = parseFeed(feed, "https://agency.test");

  assert.deepEqual(articles[0].attachments, [
    { url: "https://agency.test/docs/final-rule.pdf", kind: "pdf" },
  ]);
  assert.equal(articles[1].attachments, undefined, "no file, no chip");
});

test("a wrapper around a picture is not mistaken for an empty one", async () => {
  // Substack nests images as div > picture > img. The sanitiser dropped
  // "empty" containers by looking only at direct children, so eight images
  // became none — measured on a real article before this was fixed.
  const { sanitizeArticleHtml } = await import("../lib/article");
  const html = `<figure><a href="https://x.test/big"><div class="image2-inset"><picture>
    <source srcset="https://x.test/wide.webp 1456w">
    <img src="https://x.test/photo.jpg" alt="A diagram">
  </picture></div></a><figcaption>How it fits together</figcaption></figure>`;

  const out = sanitizeArticleHtml(html, "https://x.test/p", { title: "t" }).html;
  assert.match(out, /<img[^>]+src="https:\/\/x\.test\/photo\.jpg"/, "the photo survives");
  assert.match(out, /How it fits together/, "and so does its caption");
});

test("an article with no picture of its own gets the one the page declares", async () => {
  const { extractArticle } = await import("../lib/article");
  const { startRedditSite } = await import("./fixtures.mjs");
  const site = await startRedditSite(8795);
  try {
    const article = await extractArticle("http://127.0.0.1:8795/story");
    assert.match(
      article.html,
      /<img[^>]+src="https:\/\/cdn\.test\/lead\.jpg"/,
      "the og:image leads the article",
    );
    assert.match(article.html, /narrow grounds/, "and the text is still there");
  } finally {
    site.close();
  }
});
