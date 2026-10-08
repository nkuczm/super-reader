import test from "node:test";
import assert from "node:assert/strict";
import { boxHtml, cardHtml, subjectHtml, transcriptHtml } from "../lib/subject-doc";
import { firstWords, printPage, transcriptArticleExcerpt } from "../lib/print";
import type { BoxItem } from "../lib/subjects";

const box = (extra: Partial<BoxItem>): BoxItem => ({ id: "b1", kind: "box", at: 1, html: "", ...extra }) as BoxItem;
const words = (n: number, w = "word") => Array.from({ length: n }, (_, i) => `${w}${i}`).join(" ");

test("a story prints with its headline, byline, quotes and notes, quote links reduced to their words", () => {
  const html = cardHtml(
    { link: "https://example.com/a", title: "Rates & the bank", note: "<p>My note.</p>", quotes: [{ id: "q1", text: "A quoted line" }], source: "Example" },
    undefined,
    { print: true },
  );
  assert.match(html, /<h3><a href="https:\/\/example.com\/a">Rates &amp; the bank<\/a><\/h3>/);
  assert.match(html, /class="print-byline">Example</);
  assert.match(html, /A quoted line/);
  assert.match(html, /My note\./);
  assert.doesNotMatch(html, /data-quote/);
});

test("a drawing prints as the drawing, and is only named in the Google Doc copy", () => {
  const drawn = box({ drawing: [{ d: "M0 0 L10 10", color: "#ff0000", w: 2 }], height: 200 });
  assert.match(boxHtml(drawn, undefined, { print: true }), /<img src="data:image\/svg\+xml/);
  assert.match(boxHtml(drawn), /\[A drawing/);
});

test("a table prints as a table, a section label as a heading", () => {
  assert.match(boxHtml(box({ table: [["Visual", "Words"], ["Drone", "Intro"]], tableMode: "doc" })), /<table[\s\S]*Drone[\s\S]*<\/table>/);
  assert.equal(boxHtml(box({ label: true, html: "Background &amp; context" })), '<h2 class="section">Background &amp; context</h2>');
});

test("a printed transcript shows its opening and says how much more there is, unless printed whole", () => {
  const turns = Array.from({ length: 12 }, (_, i) => ({ s: i % 2 ? "Reporter" : "Mayor", t: `00:0${i}`, x: words(40, `t${i}w`) }));
  const transcript = { title: "Mayor interview", turns };
  const preview = transcriptHtml(transcript, undefined, { full: false });
  assert.match(preview, /t0w0/);
  assert.doesNotMatch(preview, /t11w0/);
  assert.match(preview, /The transcript continues — \d+ more passages, about [\d,]+ more words/);
  const whole = transcriptHtml(transcript, undefined, { full: true });
  assert.match(whole, /t11w39/);
  assert.doesNotMatch(whole, /continues/);
  // The Google Doc copy is unchanged: the whole transcript, in its plain form.
  assert.match(transcriptHtml(transcript), /<b>Mayor<\/b> <i>\(00:00\)<\/i>: t0w0/);
  assert.match(transcriptHtml(transcript), /t11w39/);
});

test("a single very long turn is cut, not dropped", () => {
  const preview = transcriptHtml({ title: "", turns: [{ x: words(900) }] }, undefined, { full: false });
  assert.match(preview, /word0 /);
  assert.doesNotMatch(preview, /word800/);
  assert.match(preview, /about [\d,]+ more words/);
});

test("the Google Doc export keeps transcripts whole", () => {
  const note = { id: "n1", name: "S", at: 1, updatedAt: 1, entries: [] };
  const board = { b1: box({ transcript: { title: "", turns: Array.from({ length: 20 }, (_, i) => ({ x: words(30, `p${i}w`) })) } }) };
  const html = subjectHtml(note, board as never);
  assert.match(html, /p19w29/);
  assert.doesNotMatch(html, /continues/);
});

test("a video transcript in the reader prints its first passages, then how much is left", () => {
  const html = `<h2>Transcript</h2>${Array.from({ length: 30 }, (_, i) => `<p><a href="https://www.youtube.com/watch?v=x&amp;t=${i}s">0:${i}</a> ${words(25, `v${i}w`)}</p>`).join("")}`;
  const excerpt = transcriptArticleExcerpt(html);
  assert.match(excerpt, /^<h2>Transcript<\/h2><p>/);
  assert.match(excerpt, /v0w0/);
  assert.doesNotMatch(excerpt, /v29w0/);
  assert.match(excerpt, /The transcript continues/);
  assert.equal(transcriptArticleExcerpt("<h2>Transcript</h2><p>Short.</p>"), "<h2>Transcript</h2><p>Short.</p>");
});

test("cutting text ends at a sentence where one is close", () => {
  assert.equal(firstWords("One two three. Four five six seven", 5), "One two three. …");
  assert.equal(firstWords("Short text", 5), "Short text");
});

test("the printed page escapes its header and carries the page stylesheet", () => {
  const page = printPage({ kicker: "A & B", title: "<Subject>", meta: "Printed today", body: "<p>Body</p>", footer: "https://x.example/a" });
  assert.match(page, /<title>&lt;Subject&gt;<\/title>/);
  assert.match(page, /class="print-kicker">A &amp; B</);
  assert.match(page, /@page/);
  assert.match(page, /<footer class="print-foot">https:\/\/x.example\/a<\/footer>/);
});
