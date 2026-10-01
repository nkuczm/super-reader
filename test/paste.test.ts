import test from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { cleanPastedHtml } from "../lib/paste";

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
