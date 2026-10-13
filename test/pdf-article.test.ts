import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { imageBoxes, pdfArticleHtml, readPdfPages, type PdfImage, type PdfPage, type PdfRun } from "../lib/pdf-article";

/** An article saved from Chromium as a PDF: three pages, its header (date, title) and footer (address, "1/3") on each. */
const SAVED = new Uint8Array(readFileSync(new URL("./fixtures/saved-article.pdf", import.meta.url)));

test("a page saved as a PDF reads back as the article: headings, whole paragraphs, no browser furniture", async () => {
  const pages = await readPdfPages(SAVED);
  assert.equal(pages.length, 3);
  const { html, words, title } = pdfArticleHtml(pages, { title: "aquifer-running-dry" });
  assert.equal(title, "The Aquifer Is Running Dry", "the headline, set largest at the top of the first page");
  const blocks = html.split("\n");
  assert.ok(!html.includes("Aquifer Is Running Dry"), "and not repeated below it");
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

/** pdf.js's operator numbers, as `pdfjs.OPS` has them. */
const OPS = { save: 10, restore: 11, transform: 12, constructPath: 91, clip: 29, eoClip: 30, paintFormXObjectBegin: 74, paintFormXObjectEnd: 75, paintImageXObject: 85, paintInlineImageXObject: 86 };

test("a picture is where its transform puts it, cut to the clip in force", () => {
  const ops: [number, unknown][] = [
    // A photograph 400×300 at (100, 200).
    [OPS.save, null], [OPS.transform, [400, 0, 0, 300, 100, 200]], [OPS.paintImageXObject, ["img1", 400, 300]], [OPS.restore, null],
    // One cropped to a frame: drawn 600 wide, seen through a 200×100 window.
    [OPS.save, null], [OPS.constructPath, [[19], [50, 600, 200, 100], [50, 600, 250, 700]]], [OPS.clip, null],
    [OPS.transform, [600, 0, 0, 200, 0, 550]], [OPS.paintImageXObject, ["img2", 600, 200]], [OPS.restore, null],
    // Inside a form moved 10 up: the form's matrix applies to what it draws.
    [OPS.paintFormXObjectBegin, [[1, 0, 0, 1, 0, 10], [0, 0, 612, 792]]], [OPS.save, null],
    [OPS.transform, [50, 0, 0, 50, 300, 30]], [OPS.paintInlineImageXObject, [{}]], [OPS.restore, null], [OPS.paintFormXObjectEnd, null],
  ];
  const boxes = imageBoxes(ops.map(([fn]) => fn), ops.map(([, args]) => args), OPS);
  assert.deepEqual(boxes, [
    { left: 100, bottom: 200, right: 500, top: 500 },
    { left: 50, bottom: 600, right: 250, top: 700 },
    { left: 300, bottom: 40, right: 350, top: 90 },
  ]);
});

test("a picture drawn in strips is one picture", () => {
  const strip = (y: number): [number, unknown][] => [[OPS.save, null], [OPS.transform, [300, 0, 0, 50, 100, y]], [OPS.paintImageXObject, ["s"]], [OPS.restore, null]];
  const ops = [...strip(100), ...strip(150), ...strip(200)];
  assert.deepEqual(imageBoxes(ops.map(([fn]) => fn), ops.map(([, a]) => a), OPS), [{ left: 100, bottom: 100, right: 400, top: 250 }]);
});

const picture = (left: number, bottom: number, right: number, top: number, src = "data:image/jpeg;base64,AAAA"): PdfImage => ({ left, bottom, right, top, src, width: 10, height: 10 });

test("pictures sit between paragraphs, after the one they interrupt, at their printed size", () => {
  const lines = (from: number, texts: string[]) => texts.map((t, i) => run(t, 50, from - i * 13));
  const page1 = { runs: [
    ...lines(700, ["The first paragraph opens the story here,", "and it ends on this short line."]),
    // A photograph below it, then a paragraph that runs round a second one.
    ...lines(560, ["The second paragraph starts above a picture", "that sits beside these lines and goes on", "for a while before it ends right here."]),
  ], images: [picture(50, 590, 350, 680), picture(400, 500, 550, 560, "data:image/jpeg;base64,BBBB")] };
  const { html } = pdfArticleHtml([page1]);
  assert.deepEqual(html.split("\n").map((b) => b.replace(/>[^<]{12,}</, ">…<")), [
    "<p>…</p>",
    '<figure><img src="data:image/jpeg;base64,AAAA" alt="" width="400" height="120" /></figure>',
    "<p>…</p>",
    '<figure><img src="data:image/jpeg;base64,BBBB" alt="" width="200" height="80" /></figure>',
  ]);
});

test("a picture in the same place on every page is the publication's, not the story's", () => {
  const logo = () => picture(20, 750, 120, 790, "data:image/jpeg;base64,LOGO");
  const pages = [0, 1, 2].map((n) => ({ runs: [run(`Page ${n} of the story, with enough words to read.`, 50, 700)], images: [logo(), ...(n === 1 ? [picture(50, 400, 450, 650)] : [])] }));
  const { html } = pdfArticleHtml(pages);
  assert.doesNotMatch(html, /LOGO/);
  assert.equal((html.match(/<figure>/g) ?? []).length, 1);
});

test("a running header is the same words at the same place on every page; the story's own lines are not, however alike", () => {
  const page = (n: number, top: number) => ({ runs: [
    run(`10/13/26, 5:0${n} PM`, 20, 770, 6),
    run(`Sentence ${n}-0 about the district's wells and the water table,`, 50, top),
    run(`which fell again this year as the pumps ran on into the night,`, 50, top - 13),
    run(`and the board met in the morning to hear what the wells showed.`, 50, top - 26),
    run(`https://valley.example/aquifer ${n + 1}/2`, 20, 20, 6),
  ] });
  const { html } = pdfArticleHtml([page(0, 600), page(1, 740)]);
  assert.match(html, /Sentence 0-0/, "the first page's opening line stays, though the second page opens alike");
  assert.match(html, /Sentence 1-0/);
  assert.doesNotMatch(html, /PM|valley\.example/);
});
