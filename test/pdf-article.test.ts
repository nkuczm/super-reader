import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { pdfArticleHtml, readPdfPages, type PdfPage, type PdfRun } from "../lib/pdf-article";

/** An article saved from Chromium as a PDF: three pages, its header (date, title) and footer (address, "1/3") on each. */
const SAVED = new Uint8Array(readFileSync(new URL("./fixtures/saved-article.pdf", import.meta.url)));

test("a page saved as a PDF reads back as the article: headings, whole paragraphs, no browser furniture", async () => {
  const pages = await readPdfPages(SAVED);
  assert.equal(pages.length, 3);
  const { html, words } = pdfArticleHtml(pages, { title: "The Aquifer Is Running Dry" });
  const blocks = html.split("\n");
  assert.ok(!blocks[0].includes("Aquifer Is Running Dry"), "the headline the reader already shows is not repeated");
  assert.equal(blocks[0], "<p>By Jane Example · October 12, 2026</p>");
  assert.deepEqual(blocks.filter((b) => b.startsWith("<h3>")), [1, 2, 3].map((n) => `<h3>Section ${n}: what the district knew</h3>`));
  // Every paragraph whole — those running over a page too — and none run together.
  const paragraphs = blocks.filter((b) => b.includes("Sentence "));
  assert.equal(paragraphs.length, 12);
  paragraphs.forEach((p, i) => {
    const [k, j] = [Math.floor(i / 4), i % 4];
    assert.equal((p.match(/Sentence /g) ?? []).length, 3 + ((j + k) % 4), p.slice(0, 80));
    assert.ok(p.startsWith(`<p>Sentence ${k}.${j}-0 `) && p.endsWith("An inter-national well-known effect.</p>"), p.slice(-80));
  });
  assert.doesNotMatch(html, /example\.com|\d\/3|\b[AP]M\b/, "the browser's header and footer are gone");
  assert.ok(words > 1000);
});

const run = (str: string, x: number, y: number, size = 10): PdfRun => ({ str, x, y, width: str.length * size * 0.5, height: size, hasEOL: true });
const page = (...runs: PdfRun[]): PdfPage => ({ runs });

test("a word broken at the margin is made whole only where the text writes it whole", () => {
  const lines = (a: string, b: string) =>
    page(run(`The outcome was inter-`, 50, 700), run(`${a} for the ${b} study.`, 50, 687), run(`Its international reach was clear.`, 50, 674));
  assert.match(pdfArticleHtml([lines("national", "first")]).html, /was international for the first/);
  const kept = page(run("A well-", 50, 700), run("known result in every trial of it.", 50, 687));
  assert.match(pdfArticleHtml([kept]).html, /A well-known result/);
});

test("two columns of indented paragraphs: a paragraph runs on into the next column", () => {
  const left = 50;
  const right = 320;
  const col = (x: number, top: number, texts: string[]) => texts.map((t, i) => run(t, x, top - i * 13));
  const text = [
    ...col(left, 700, ["This paragraph is long enough to fill", "every line of the column it starts in", "and it carries on, line after line,", "until it reaches the foot and goes"]),
    ...col(right, 700, ["on to the next, where it ends at last.", "A second paragraph starts with an", "indent, as a journal sets them, and", "it runs on to its own end here."]),
  ];
  // The indented line starts a little in from the column's edge.
  text[5] = run("A second paragraph starts with an", right + 14, 687);
  const { html } = pdfArticleHtml([page(...text)]);
  assert.deepEqual(html.split("\n"), [
    "<p>This paragraph is long enough to fill every line of the column it starts in and it carries on, line after line, until it reaches the foot and goes on to the next, where it ends at last.</p>",
    "<p>A second paragraph starts with an indent, as a journal sets them, and it runs on to its own end here.</p>",
  ]);
});

test("a scan has no text to give", () => {
  assert.deepEqual(pdfArticleHtml([page(), page()]), { html: "", words: 0 });
});
