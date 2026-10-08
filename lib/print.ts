/**
 * Printing part of a subject: a page of its own, laid out for paper, sent to
 * the browser's print dialog — where "Save as PDF" is one of the printers.
 *
 * The page is built rather than the screen printed: the screen has toolbars,
 * drag handles, a whiteboard's cards scattered over a canvas, and on a phone
 * a layout a third of a sheet wide. What goes on paper is the writing.
 */

import { escapeHtml } from "./subjects";

const STYLE = `
@page { margin: 18mm 16mm; }
* { box-sizing: border-box; }
html { color: #111; background: #fff; }
body { margin: 0 auto; max-width: 720px; font: 11.5pt/1.5 Georgia, "Times New Roman", serif; }
h1 { font-size: 20pt; line-height: 1.2; margin: 0 0 2pt; }
.print-sub { color: #555; font-size: 9.5pt; margin: 0 0 14pt; font-family: -apple-system, "Segoe UI", Helvetica, Arial, sans-serif; }
h2 { font-size: 15pt; margin: 18pt 0 6pt; break-after: avoid; }
h2.tab { border-bottom: 1px solid #999; padding-bottom: 3pt; }
h3 { font-size: 12.5pt; margin: 14pt 0 2pt; break-after: avoid; }
h3 a { color: #111; text-decoration: none; }
h4 { font-size: 11pt; margin: 10pt 0 4pt; break-after: avoid; }
p { margin: 0 0 6pt; }
ul, ol { margin: 0 0 6pt; padding-left: 20pt; }
li { margin: 0 0 2pt; }
a { color: #1a4fa0; }
blockquote { margin: 0 0 6pt; padding-left: 10pt; border-left: 2px solid #bbb; color: #333; }
img { max-width: 100%; height: auto; break-inside: avoid; }
table { border-collapse: collapse; width: 100%; margin: 4pt 0 10pt; font-size: 10pt; break-inside: auto; }
tr { break-inside: avoid; }
td, th { border: 1px solid #888; padding: 3pt 6pt; vertical-align: top; text-align: left; }
ul[data-check] { list-style: none; padding-left: 4pt; }
ul[data-check] > li::before { content: "☐ "; }
ul[data-check] > li[data-checked="true"]::before { content: "☑ "; }
mark { background: #fff2a8; }
.print-block { margin: 0 0 12pt; }
.print-insights { margin-top: 16pt; }
`;

/** A whole page: the title, a line under it, and the body. */
export function printPage(title: string, sub: string, body: string): string {
  return `<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(title)}</title><style>${STYLE}</style></head><body>` +
    `<h1>${escapeHtml(title)}</h1>${sub ? `<p class="print-sub">${escapeHtml(sub)}</p>` : ""}${body}</body></html>`;
}

/**
 * Print a page without leaving the app: written into a hidden frame, printed
 * from there once its pictures have loaded, and taken away afterwards.
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
