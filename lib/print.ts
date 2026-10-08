/**
 * Printing: a subject, one block of it, or an article, as a page of its own
 * laid out for paper and sent to the browser's print dialog — where "Save as
 * PDF" is one of the printers.
 *
 * The page is built rather than the screen printed: the screen has toolbars,
 * drag handles, a whiteboard's cards scattered over a canvas, and on a phone
 * a layout a third of a sheet wide. What goes on paper is the writing, set
 * the way a printed page is: one measured column, a quiet header, headings
 * that stay with what follows them, and pictures that never outgrow a page.
 */

import { escapeHtml } from "./subjects";

/** What a printed page says above and below its body. */
export type PrintDoc = {
  /** A small line over the title: the subject, or the publication. */
  kicker?: string;
  title: string;
  /** Under the title: byline, date, where it is from. */
  meta?: string;
  /** Sanitised HTML. */
  body: string;
  /** Closing line: where the piece lives, when it was printed. */
  footer?: string;
};

/** How much of a transcript a print shows unless the whole of it is asked for. */
export const TRANSCRIPT_PREVIEW_WORDS = 150;

const SANS = `-apple-system, BlinkMacSystemFont, "Segoe UI", "Helvetica Neue", Arial, sans-serif`;
const SERIF = `Charter, "Bitstream Charter", "Iowan Old Style", Georgia, Cambria, "Times New Roman", serif`;

/*
 * A4 and US Letter both fit inside these margins with a column of about 65
 * characters at 11pt — the measure book pages use. On screen (the preview)
 * the same page is drawn as a sheet 210mm wide with the margins as padding.
 */
const STYLE = `
@page { size: auto; margin: 20mm 19mm 22mm; @bottom-center { content: counter(page) " of " counter(pages); font: 8pt ${SANS}; color: #8a8a8a; } }
* { box-sizing: border-box; }
html { color: #1b1b1b; background: #fff; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
body { margin: 0; font: 11pt/1.58 ${SERIF}; hyphens: auto; -webkit-hyphens: auto; orphans: 3; widows: 3; text-rendering: optimizeLegibility; font-kerning: normal; }
@media screen { body { width: 210mm; min-height: 297mm; padding: 20mm 19mm 22mm; } }

.print-head { margin: 0 0 16pt; padding-bottom: 10pt; border-bottom: 0.75pt solid #d4d4d4; }
.print-kicker { margin: 0 0 5pt; font: 600 7.5pt/1.3 ${SANS}; letter-spacing: 0.12em; text-transform: uppercase; color: #8a6a2f; }
h1 { margin: 0; font: 700 23pt/1.15 ${SERIF}; letter-spacing: -0.01em; hyphens: manual; }
.print-meta { margin: 6pt 0 0; font: 8.5pt/1.4 ${SANS}; color: #6b6b6b; }
.print-foot { margin-top: 22pt; padding-top: 7pt; border-top: 0.75pt solid #e2e2e2; font: 8pt/1.4 ${SANS}; color: #8a8a8a; word-break: break-all; }

h2, h3, h4 { hyphens: manual; break-after: avoid; page-break-after: avoid; }
h2 { margin: 20pt 0 7pt; font: 700 15pt/1.25 ${SERIF}; }
h2.tab { margin-top: 26pt; padding-bottom: 4pt; border-bottom: 0.75pt solid #cfcfcf; }
h2.tab:first-child { margin-top: 0; }
h2.section { margin: 20pt 0 8pt; font: 700 8.5pt/1.3 ${SANS}; letter-spacing: 0.1em; text-transform: uppercase; color: #8a6a2f; }
h3 { margin: 0 0 2pt; font: 700 13pt/1.3 ${SERIF}; }
h3 a { color: inherit; text-decoration: none; }
h4 { margin: 12pt 0 5pt; font: 600 8.5pt/1.3 ${SANS}; letter-spacing: 0.06em; text-transform: uppercase; color: #6b6b6b; }
p { margin: 0 0 7pt; }
a { color: #1d4f91; text-decoration-thickness: 0.5pt; text-underline-offset: 1.5pt; }
strong, b { font-weight: 700; }
ul, ol { margin: 0 0 8pt; padding-left: 16pt; }
li { margin: 0 0 3pt; padding-left: 2pt; }
li > ul, li > ol { margin: 3pt 0 0; }
ul[data-check] { list-style: none; padding-left: 2pt; }
ul[data-check] > li::before { content: "☐"; display: inline-block; width: 13pt; }
ul[data-check] > li[data-checked="true"]::before { content: "☑"; }
blockquote { margin: 0 0 8pt; padding: 1pt 0 1pt 11pt; border-left: 2pt solid #d9c7a3; color: #333; font-style: italic; }
mark { background: #fbeea4; color: inherit; padding: 0 1pt; }
hr { border: 0; border-top: 0.75pt solid #ddd; margin: 14pt 0; }
code, pre { font: 9.5pt/1.45 ui-monospace, "SF Mono", Menlo, Consolas, monospace; }
pre { white-space: pre-wrap; background: #f6f6f4; padding: 7pt 9pt; border-radius: 3pt; }

img, svg, video { display: block; max-width: 100%; height: auto; max-height: 115mm; object-fit: contain; margin: 4pt auto 8pt; border-radius: 2pt; break-inside: avoid; page-break-inside: avoid; }
figure { margin: 6pt 0 12pt; break-inside: avoid; page-break-inside: avoid; }
figcaption, .caption { margin-top: -3pt; font: 8.5pt/1.4 ${SANS}; color: #6b6b6b; text-align: center; }
iframe, script, button, form, input { display: none !important; }

table { width: 100%; border-collapse: collapse; margin: 4pt 0 12pt; font: 9.5pt/1.45 ${SANS}; break-inside: auto; }
tr { break-inside: avoid; page-break-inside: avoid; }
td, th { border: 0.75pt solid #c8c8c8 !important; padding: 4pt 6pt !important; vertical-align: top; text-align: left; hyphens: auto; }
th { background: #f3f1ec; font-weight: 600; }
td p:last-child, th p:last-child { margin-bottom: 0; }

/* Blocks of a subject: each story or box with room around it, a short one kept on one page. */
.print-block { margin: 0 0 15pt; }
.print-story { break-inside: avoid-page; page-break-inside: avoid; }
.print-story + .print-story { padding-top: 13pt; border-top: 0.75pt solid #ececec; }
.print-byline { margin: 0 0 6pt; font: 8.5pt/1.4 ${SANS}; color: #6b6b6b; font-style: normal; }
.print-story ul { list-style: none; padding-left: 0; }
.print-story ul > li { position: relative; padding-left: 11pt; font-style: italic; color: #2f2f2f; }
.print-story ul > li::before { content: ""; position: absolute; left: 0; top: 0.25em; bottom: 0.25em; width: 2pt; background: #d9c7a3; border-radius: 1pt; }
.print-drawing img { border: 0.75pt solid #e2e2e2; }
/* A picture among notes is set like a figure in a report, not a poster. */
.print-image img { max-width: 85%; max-height: 100mm; }

/* Transcripts: who spoke, and when, over what they said. */
.print-transcript { margin: 0 0 12pt; }
/* Printed on its own, a transcript's name is already the page's title. */
.print-solo > .print-transcript:first-child > .t-title { display: none; }
.t-title { margin: 0 0 8pt; font: 600 8.5pt/1.3 ${SANS}; letter-spacing: 0.08em; text-transform: uppercase; color: #6b6b6b; }
.t-turn { margin: 0 0 7pt; }
.t-turn p { margin: 0 0 4pt; }
.t-who { font: 700 8.5pt/1.3 ${SANS}; letter-spacing: 0.04em; text-transform: uppercase; color: #333; }
.t-time { margin-left: 5pt; font: 8pt/1.3 ${SANS}; color: #8a8a8a; }
.t-more { margin: 4pt 0 0; padding: 6pt 9pt; background: #f6f4ef; border-radius: 3pt; font: 8.5pt/1.45 ${SANS}; color: #5c5c5c; }

.print-insights { margin-top: 22pt; padding-top: 10pt; border-top: 0.75pt solid #d4d4d4; }
.print-insights h2 { margin-top: 0; }
`;

/** A whole page: header, body and footer, with the stylesheet. */
export function printPage(doc: PrintDoc): string {
  const head =
    `<header class="print-head">${doc.kicker ? `<p class="print-kicker">${escapeHtml(doc.kicker)}</p>` : ""}` +
    `<h1>${escapeHtml(doc.title)}</h1>${doc.meta ? `<p class="print-meta">${escapeHtml(doc.meta)}</p>` : ""}</header>`;
  const foot = doc.footer ? `<footer class="print-foot">${escapeHtml(doc.footer)}</footer>` : "";
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${escapeHtml(doc.title)}</title><style>${STYLE}</style></head>` +
    `<body>${head}<main>${doc.body}</main>${foot}</body></html>`;
}

/** "Printed 8 October 2026". */
export function printedOn(now = new Date()): string {
  return `Printed ${now.toLocaleDateString(undefined, { day: "numeric", month: "long", year: "numeric" })}`;
}

export const wordsIn = (text: string) => text.match(/[\p{L}\p{N}][\p{L}\p{N}'’-]*/gu)?.length ?? 0;

/** About `words` words of `text`, cut at the end of a sentence where there is one close by. */
export function firstWords(text: string, words: number): string {
  const all = text.match(/\S+\s*/g) ?? [];
  if (all.length <= words) return text;
  const cut = all.slice(0, words).join("");
  const end = Math.max(cut.lastIndexOf(". "), cut.lastIndexOf("? "), cut.lastIndexOf("! "));
  return (end > cut.length * 0.5 ? cut.slice(0, end + 1) : cut.trimEnd()) + " …";
}

/** "38 more passages, about 4,200 words". */
export function remainderNote(passages: number, words: number): string {
  const parts = [passages > 0 ? `${passages.toLocaleString("en")} more passage${passages === 1 ? "" : "s"}` : "", words > 0 ? `about ${words.toLocaleString("en")} more words` : ""].filter(Boolean);
  return `<p class="t-more">The transcript continues — ${parts.join(", ")}. Turn on “Include full transcripts” to print all of it.</p>`;
}

/**
 * The opening of a video transcript as the article reader holds it (a
 * heading, then one paragraph per passage): its first passages up to about
 * `words` words, and a line saying how much more there is.
 */
export function transcriptArticleExcerpt(html: string, words = TRANSCRIPT_PREVIEW_WORDS): string {
  const paragraphs = html.match(/<p\b[\s\S]*?<\/p>/g) ?? [];
  const first = html.search(/<p\b/);
  const head = first > 0 ? html.slice(0, first) : "";
  const kept: string[] = [];
  let count = 0;
  for (const p of paragraphs) {
    if (count >= words) break;
    kept.push(p);
    count += wordsIn(p.replace(/<[^>]+>/g, " "));
  }
  const restWords = paragraphs.slice(kept.length).reduce((n, p) => n + wordsIn(p.replace(/<[^>]+>/g, " ")), 0);
  if (kept.length === paragraphs.length) return html;
  return head + kept.join("") + remainderNote(paragraphs.length - kept.length, restWords);
}

/**
 * Print a page without leaving the app: written into a frame out of sight,
 * printed from there once its pictures have loaded, and taken away after.
 */
export function printHtml(html: string): void {
  const frame = document.createElement("iframe");
  frame.setAttribute("aria-hidden", "true");
  frame.tabIndex = -1;
  // Out of sight but laid out: some browsers print a frame that is not displayed as a blank page.
  frame.style.cssText = "position:fixed;left:-10000px;top:0;width:800px;height:600px;border:0;";
  document.body.appendChild(frame);
  const win = frame.contentWindow;
  const doc = frame.contentDocument;
  if (!win || !doc) {
    frame.remove();
    return;
  }
  doc.open();
  doc.write(html);
  doc.close();
  let gone = false;
  const remove = () => {
    if (gone) return;
    gone = true;
    frame.remove();
  };
  const pictures = [...doc.images].map((img) =>
    img.complete ? Promise.resolve() : new Promise<void>((done) => {
      img.addEventListener("load", () => done(), { once: true });
      img.addEventListener("error", () => done(), { once: true });
    }),
  );
  // A picture that never answers does not hold the print up for long.
  const ready = Promise.race([Promise.all(pictures), new Promise((done) => setTimeout(done, 3000))]);
  void ready.then(() => {
    win.addEventListener("afterprint", () => setTimeout(remove, 500), { once: true });
    win.focus();
    win.print();
    // Where printing does not block, or afterprint never comes, the frame still goes — later, so it is not pulled out from under the dialog.
    setTimeout(remove, 120_000);
  });
}
