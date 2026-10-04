import { test } from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { Readability } from "@mozilla/readability";
import { tidyForReadability } from "../lib/article";

const words = (n: number, w: string) => Array.from({ length: n }, (_, i) => `${w}${i}`).join(" ");
const P = (t: string) => `<div class="intercom-interblocks-paragraph no-margin"><p>${t}</p></div>`;
const page = `<html><head><title>T</title></head><body><main>
<div class="breadcrumbs"><a href="/">All Collections</a> <a href="/c">Section</a></div>
<article>${P(words(80, "intro"))}<div class="intercom-interblocks-subheading"><h2>Steps</h2></div>${P(words(60, "lead"))}
<div class="intercom-interblocks-unordered-nested-list"><ul>${["alpha", "beta", "gamma", "delta", "eps", "zeta"].map((w) => `<li>${P(words(50, w))}</li>`).join("")}</ul></div>
${P(words(50, "closing"))}<h2>Related Articles</h2><ul><li><a href="/r1">One</a></li><li><a href="/r2">Two</a></li></ul></article></main></body></html>`;

test("an Intercom help-centre article keeps its list and loses its furniture", () => {
  const doc = new JSDOM(page, { url: "https://help.example.com/en/articles/1-x" }).window.document;
  tidyForReadability(doc);
  const content = new Readability(doc, { charThreshold: 250 }).parse()?.content ?? "";
  for (const w of ["alpha0", "delta0", "zeta0", "closing0"]) assert.match(content, new RegExp(w));
  assert.doesNotMatch(content, /All Collections/);
  assert.doesNotMatch(content, /Related Articles/);
});

test("without the tidy, Readability drops that list (the bug this guards)", () => {
  const doc = new JSDOM(page, { url: "https://help.example.com/en/articles/1-x" }).window.document;
  const content = new Readability(doc, { charThreshold: 250 }).parse()?.content ?? "";
  assert.doesNotMatch(content, /alpha0/);
});
