import test from "node:test";
import assert from "node:assert/strict";
import { boxHtml, cardHtml } from "../lib/subject-doc";
import { printPage } from "../lib/print";
import type { BoxItem } from "../lib/subjects";

const box = (extra: Partial<BoxItem>): BoxItem => ({ id: "b1", kind: "box", at: 1, html: "", ...extra }) as BoxItem;

test("a story prints with its headline, byline, quotes and notes, quote links reduced to their words", () => {
  const html = cardHtml(
    { link: "https://example.com/a", title: "Rates & the bank", note: "<p>My note.</p>", quotes: [{ id: "q1", text: "A quoted line" }], source: "Example" },
  );
  assert.match(html, /<h3><a href="https:\/\/example.com\/a">Rates &amp; the bank<\/a><\/h3>/);
  assert.match(html, /A quoted line/);
  assert.match(html, /My note\./);
  assert.doesNotMatch(html, /data-quote/);
});

test("a drawing prints as the drawing, and is only named in the Google Doc copy", () => {
  const drawn = box({ drawing: [{ d: "M0 0 L10 10", color: "#ff0000", w: 2 }], height: 200 });
  assert.match(boxHtml(drawn, undefined, "shown"), /<img src="data:image\/svg\+xml/);
  assert.match(boxHtml(drawn), /\[A drawing/);
});

test("a table prints as a table, a section label as a heading", () => {
  assert.match(boxHtml(box({ table: [["Visual", "Words"], ["Drone", "Intro"]], tableMode: "doc" })), /<table[\s\S]*Drone[\s\S]*<\/table>/);
  assert.equal(boxHtml(box({ label: true, html: "Background &amp; context" })), '<h2 class="section">Background &amp; context</h2>');
});

test("the printed page escapes its title", () => {
  const page = printPage("<Subject>", "Printed today", "<p>Body</p>");
  assert.match(page, /<title>&lt;Subject&gt;<\/title>/);
  assert.match(page, /@page/);
});
