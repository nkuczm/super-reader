import test from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { cleanPastedHtml, linkedTextHtml, pastedText } from "../lib/paste";

const { document } = new JSDOM("<!doctype html><body></body>").window;

// What Google Docs puts on the clipboard: everything inside a not-bold <b>,
// formatting as span styles, and a nested list flattened with aria-level.
const GOOGLE_DOCS = `<meta charset="utf-8"><b style="font-weight:normal;" id="docs-internal-guid-1234"><p dir="ltr" style="line-height:1.38;margin-top:0pt;margin-bottom:0pt;"><span style="font-size:11pt;font-weight:700;">Board structure</span><span style="font-size:11pt;font-weight:400;"> and </span><span style="font-size:11pt;font-style:italic;">who appoints it</span></p><ul style="margin-top:0;margin-bottom:0;padding-inline-start:48px;"><li dir="ltr" aria-level="1" style="list-style-type:disc;"><p dir="ltr" role="presentation"><span style="font-weight:400;">Labs write their own rules</span></p></li><li dir="ltr" aria-level="2" style="list-style-type:circle;"><p dir="ltr" role="presentation"><span style="font-weight:400;background-color:#ffff00;">Who audits them?</span></p></li><li dir="ltr" aria-level="3" style="list-style-type:square;"><p dir="ltr" role="presentation"><span style="font-weight:400;text-decoration:underline;">Nobody yet</span></p></li><li dir="ltr" aria-level="1" style="list-style-type:disc;"><p dir="ltr" role="presentation"><span style="font-weight:400;">Back at the top</span></p></li></ul><ol style="margin-top:0;"><li dir="ltr" aria-level="1" style="list-style-type:decimal;"><p dir="ltr" role="presentation"><span>First step</span></p></li></ol><p dir="ltr" style="margin-left:36pt;"><span style="font-weight:400;">An indented thought</span></p></b>`;

test("a Google Docs paste keeps its bullets, nesting and formatting, and is not all bold", () => {
  const html = cleanPastedHtml(GOOGLE_DOCS, document);
  assert.doesNotMatch(html, /^<b>/, "the not-bold wrapper is gone");
  assert.match(html, /<b>Board structure<\/b> and <i>who appoints it<\/i>/);
  assert.match(
    html,
    /<ul><li>Labs write their own rules<ul><li><mark>Who audits them\?<\/mark><ul><li><u>Nobody yet<\/u><\/li><\/ul><\/li><\/ul><\/li><li>Back at the top<\/li><\/ul>/,
    "levels 1 → 2 → 3 → 1 nest and come back out",
  );
  assert.match(html, /<ol><li>First step<\/li><\/ol>/, "a numbered list stays numbered");
  assert.match(html, /<blockquote><p>An indented thought<\/p><\/blockquote>/, "an indented paragraph stays indented");
  assert.doesNotMatch(html, /style=|aria-level|docs-internal/, "nothing of Docs' markup survives");
});

test("ordinary pasted HTML with real nested lists passes through", () => {
  const html = cleanPastedHtml("<ul><li>One<ul><li>Two</li></ul></li></ul><script>x()</script>", document);
  assert.equal(html, "<ul><li>One<ul><li>Two</li></ul></li></ul>");
});

// A Google Docs paste is mostly inline styles and ids; a smart chip adds an
// icon and more of the same. All of it once counted against the sanitiser's
// size cap, so a long paste — or one with a YouTube chip — stopped partway.
const docsLine = (n: number) =>
  `<p dir="ltr" style="line-height:1.38;margin-top:0pt;margin-bottom:0pt;" id="h.${n}"><span style="font-size:11pt;font-family:Arial,sans-serif;color:#000000;background-color:transparent;font-weight:400;font-style:normal;font-variant:normal;text-decoration:none;vertical-align:baseline;white-space:pre;white-space:pre-wrap;">Paragraph number ${n} of the pasted document.</span></p>`;
const YOUTUBE_CHIP = `<p dir="ltr" style="line-height:1.38;"><a href="https://www.youtube.com/watch?v=abc123" class="docs-chip" style="text-decoration:none;"><span style="font-size:11pt;"><img src="https://www.gstatic.com/youtube-icon.png" width="16" height="16" style="vertical-align:middle;"></span><span style="font-size:11pt;color:#1155cc;">How transformers work</span></a></p>`;

test("a long Google Docs paste with a YouTube chip comes through whole, the chip as a chip", () => {
  const lines = Array.from({ length: 60 }, (_, i) => docsLine(i + 1));
  const source = `<meta charset="utf-8"><b style="font-weight:normal;" id="docs-internal-guid-9">${lines.slice(0, 30).join("")}${YOUTUBE_CHIP}${lines.slice(30).join("")}</b>`;
  assert.ok(source.length > 20_000, "longer than the sanitiser keeps");
  const html = cleanPastedHtml(source, document);
  assert.match(html, /Paragraph number 60 of the pasted document\./, "nothing after the chip is lost");
  assert.match(html, /<a href="https:\/\/www\.youtube\.com\/watch\?v=abc123" data-link="chip"[^>]*>How transformers work<\/a>/);
  assert.doesNotMatch(html, /<img|style=|class=|id=/);
});

test("an ordinary pasted link stays an ordinary link", () => {
  const html = cleanPastedHtml(`<p>See <a href="https://example.com/a" style="color:blue">this</a>.</p>`, document);
  assert.equal(html, `<p>See <a href="https://example.com/a" target="_blank" rel="noopener noreferrer">this</a>.</p>`);
});

/** A clipboard holding just these types, as a paste event's would. */
const clipboard = (types: Record<string, string>) => ({ getData: (type: string) => types[type] ?? "" });

test("a link an iPhone puts on the clipboard only as a URI list is still pasted", () => {
  assert.equal(pastedText(clipboard({ "text/uri-list": "https://example.com/story" })), "https://example.com/story");
  assert.equal(pastedText(clipboard({ "text/uri-list": "# copied from Safari\r\nhttps://example.com/a\r\n" })), "https://example.com/a");
  assert.equal(pastedText(clipboard({ "text/plain": "words", "text/uri-list": "https://example.com/a" })), "words", "plain text first, when there is some");
  assert.equal(pastedText(clipboard({})), "");
});

test("pasted words keep the links in them, and nothing else becomes markup", () => {
  assert.equal(
    linkedTextHtml("Read this https://example.com/a-story now"),
    'Read this <a href="https://example.com/a-story">https://example.com/a-story</a> now',
  );
  assert.equal(
    linkedTextHtml("Headline <b> — www.example.org/x."),
    'Headline &lt;b&gt; — <a href="https://www.example.org/x">www.example.org/x</a>.',
    "the full stop stays outside the link, and the words are escaped",
  );
  assert.equal(linkedTextHtml("no address here"), null);
  assert.equal(linkedTextHtml("two lines https://example.com\nsecond"), null, "lines go in as typed lines");
  assert.equal(linkedTextHtml("javascript:alert(1) and ftp://example.com"), null);
});
