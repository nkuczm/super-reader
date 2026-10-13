/**
 * A PDF of an article, read back into an article: the reader's own copy of a
 * story — saved from the browser as a PDF, or the publisher's print edition —
 * put in place of a copy the site would only give us part of.
 *
 * A PDF holds positioned runs of text, not paragraphs. Reading it the way
 * `lib/files.ts` reads a court filing (one line per line, one paragraph per
 * page) is right for a filing and wrong for a story: a page saved from a
 * browser breaks every sentence at the margin and carries the browser's
 * header and footer — the date, the title, the address and "3/12" — on every
 * page. So the lines are put back into paragraphs from where they sit, and
 * what repeats at the top and bottom of every page is left out.
 *
 * Runs in the browser: the file never leaves the device, and a PDF is not
 * bound by the size a request to the server may be.
 */

/** One run of text as pdf.js gives it: where it starts, how wide and tall it is. */
export type PdfRun = { str: string; x: number; y: number; width: number; height: number; hasEOL?: boolean };
export type PdfPage = { runs: PdfRun[] };

/** Generous for an article; a book is not what this is for. */
export const MAX_PDF_PAGES = 150;
const MAX_TEXT_CHARS = 400_000;

type Line = { text: string; x: number; right: number; y: number; size: number };

/** The page's runs gathered into lines, in the order the PDF draws them. */
function linesOf(page: PdfPage): Line[] {
  const lines: Line[] = [];
  let line: Line | null = null;
  let ended = true;
  for (const run of page.runs) {
    const size = Math.abs(run.height) || 0;
    if (!run.str) {
      if (run.hasEOL) ended = true;
      continue;
    }
    // A run on another baseline starts another line, whatever pdf.js said.
    const sameLine = line && !ended && Math.abs(run.y - line.y) <= Math.max(2, Math.min(size, line.size) * 0.5);
    if (!line || !sameLine) {
      if (line && line.text.trim()) lines.push(line);
      line = { text: run.str, x: run.x, right: run.x + run.width, y: run.y, size };
    } else {
      // A visible gap between runs is a space the PDF did not write as one.
      const gap = run.x - line.right;
      const spaced = /\s$/.test(line.text) || /^\s/.test(run.str);
      line.text += !spaced && gap > Math.max(line.size, size) * 0.15 ? ` ${run.str}` : run.str;
      line.right = Math.max(line.right, run.x + run.width);
      line.x = Math.min(line.x, run.x);
      line.size = Math.max(line.size, size);
    }
    ended = Boolean(run.hasEOL);
  }
  if (line && line.text.trim()) lines.push(line);
  return lines.map((l) => ({ ...l, text: l.text.replace(/\s+/g, " ").trim() }));
}

/** What a running header or footer reads as once its page number and date are taken out. */
const shapeOf = (text: string) => text.toLowerCase().replace(/\d+/g, "#").replace(/\s+/g, " ").trim();
const PAGE_NUMBER = /^(page\s*)?#(\s*(of|\/)\s*#)?$/;
/** How many lines at the top and the bottom of a page can be a running header or footer. */
const EDGE = 3;

/**
 * Lines that come back at the top or bottom of most pages — the browser's
 * date and title, the address and page count, a journal's running head — and
 * bare page numbers. Never set larger than the text: "Section 2" heading the
 * next page has the shape of "Section 1" heading this one.
 */
function withoutRunningLines(pages: Line[][], body: number): Line[][] {
  const seen = new Map<string, number>();
  for (const lines of pages) {
    const edges = new Set([...lines.slice(0, EDGE), ...lines.slice(-EDGE)].map((l) => shapeOf(l.text)));
    for (const shape of edges) seen.set(shape, (seen.get(shape) ?? 0) + 1);
  }
  const repeated = (shape: string) => pages.length >= 2 && (seen.get(shape) ?? 0) >= Math.max(2, Math.ceil(pages.length * 0.6));
  return pages.map((lines) =>
    lines.filter((line, i) => {
      if (i >= EDGE && i < lines.length - EDGE) return true;
      const shape = shapeOf(line.text);
      return line.size > body * 1.05 || (!PAGE_NUMBER.test(shape) && !repeated(shape));
    }),
  );
}

/** The value most lines share, to the nearest half point. */
function commonest(values: number[]): number {
  const counts = new Map<number, number>();
  for (const v of values) {
    const key = Math.round(v * 2) / 2;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  let best = 0;
  let most = -1;
  for (const [value, count] of counts) if (count > most) [best, most] = [value, count];
  return best;
}

const ENDS_SENTENCE = /[.!?:;"”’)\]…]$/;

type Block = { kind: "p" | "h2" | "h3"; lines: Line[] };

/** Lines into paragraphs and headings, by how far apart, how indented and how large they are. */
function blocksOf(pages: Line[][]): Block[] {
  const all = pages.flat();
  if (all.length === 0) return [];
  const body = commonest(all.map((l) => l.size)) || 10;
  const bodyLines = all.filter((l) => Math.abs(l.size - body) <= body * 0.12);
  const gaps: number[] = [];
  for (const lines of pages) {
    for (let i = 1; i < lines.length; i += 1) {
      const gap = lines[i - 1].y - lines[i].y;
      if (gap > 0 && Math.abs(lines[i].size - body) <= body * 0.12 && Math.abs(lines[i - 1].size - body) <= body * 0.12) gaps.push(gap);
    }
  }
  const leading = commonest(gaps) || body * 1.3;
  // Each column's margins: its left edge is one many lines start at, its
  // right edge where most of its lines reach.
  const starts = new Map<number, number>();
  for (const l of bodyLines) starts.set(Math.round(l.x), (starts.get(Math.round(l.x)) ?? 0) + 1);
  const lefts = [...starts].filter(([, n]) => n >= Math.max(3, bodyLines.length * 0.08)).map(([x]) => x).sort((a, b) => a - b);
  const columnOf = (line: Line) => lefts.filter((x) => x <= line.x + 1).pop() ?? lefts[0] ?? line.x;
  const rightOf = new Map<number, number>();
  for (const x of lefts) {
    const rights = bodyLines.filter((l) => columnOf(l) === x).map((l) => l.right).sort((a, b) => a - b);
    rightOf.set(x, rights[Math.floor(rights.length * 0.9)] ?? 0);
  }
  const indented = (line: Line) => line.x - columnOf(line) > body * 0.9 && line.x - columnOf(line) < body * 8;
  const short = (line: Line) => line.right < (rightOf.get(columnOf(line)) ?? 0) - body * 3;

  const kindOf = (line: Line): Block["kind"] =>
    line.size >= body * 1.45 ? "h2" : line.size >= body * 1.15 ? "h3" : "p";

  const blocks: Block[] = [];
  let previous: Line | null = null;
  pages.forEach((lines, pageIndex) => {
    lines.forEach((line, i) => {
      const kind = kindOf(line);
      const current = blocks[blocks.length - 1];
      let fresh = !current || current.kind !== kind;
      if (!fresh && previous) {
        const firstOnPage = i === 0 && pageIndex > 0;
        // A finished sentence ends a paragraph when the line it ends on stops
        // short, or the next line is indented. Across a page, or a column
        // (back up the page), that is all there is to go on.
        const ended = ENDS_SENTENCE.test(previous.text) && (short(previous) || indented(line));
        if (firstOnPage || line.y > previous.y + 1) fresh = ended;
        else {
          const gap = previous.y - line.y;
          fresh = gap > leading * 1.4 || Math.abs(line.size - previous.size) > body * 0.12 || ended;
          // A heading runs on only while its lines stay close.
          if (kind !== "p" && gap > line.size * 1.6) fresh = true;
        }
      }
      if (fresh) blocks.push({ kind, lines: [line] });
      else current!.lines.push(line);
      previous = line;
    });
  });
  // A "heading" that runs long is a pull quote or a lede set large: text.
  return blocks.map((b) => (b.kind !== "p" && b.lines.reduce((n, l) => n + l.text.length, 0) > 200 ? { ...b, kind: "p" } : b));
}

/** Where a word was broken at the end of a line, until it is known whether its hyphen is its own. */
const BREAK = "\u00ad";

/** A paragraph's lines as one run of text. */
function joined(lines: Line[]): string {
  let text = "";
  for (const { text: line } of lines) {
    if (!text) text = line;
    else if (/\p{L}-$/u.test(text) && /^\p{Ll}/u.test(line)) text = text.slice(0, -1) + BREAK + line;
    else text += ` ${line}`;
  }
  return text;
}

/**
 * A word hyphenated at the end of a line: "inter-" "national" is one word
 * typeset across two lines, "well-" "known" is a hyphenated word that happened
 * to fall there. Only the rest of the text can tell them apart, so the hyphen
 * goes where the same word is written whole elsewhere, and stays otherwise —
 * a stray hyphen reads better than two words run together.
 */
function mendBreaks(texts: string[]): string[] {
  const words = new Set<string>();
  for (const text of texts) for (const word of text.split(/[^\p{L}\u00ad]+/u)) if (word && !word.includes(BREAK)) words.add(word.toLowerCase());
  return texts.map((text) =>
    text.replace(/(\p{L}+)\u00ad(\p{L}+)/gu, (_, a: string, b: string) => (words.has(`${a}${b}`.toLowerCase()) ? `${a}${b}` : `${a}-${b}`)),
  );
}

const escapeHtml = (value: string) => value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const comparable = (value: string) => value.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();

/**
 * The article's HTML from a PDF's pages. `title` is the headline the reader
 * already shows above the text, so the PDF's own copy of it is not repeated
 * below.
 */
export function pdfArticleHtml(pages: PdfPage[], { title }: { title?: string } = {}): { html: string; words: number } {
  const lines = pages.map(linesOf);
  const blocks = blocksOf(withoutRunningLines(lines, commonest(lines.flat().map((l) => l.size))));
  const texts = mendBreaks(blocks.map((block) => joined(block.lines)));
  const headline = title ? comparable(title) : "";
  let chars = 0;
  let words = 0;
  const html: string[] = [];
  for (const [i, block] of blocks.entries()) {
    const text = texts[i];
    if (!text) continue;
    if (headline && html.length === 0 && comparable(text) === headline) continue;
    if (chars + text.length > MAX_TEXT_CHARS) break;
    chars += text.length;
    words += text.split(/\s+/).filter(Boolean).length;
    html.push(`<${block.kind}>${escapeHtml(text)}</${block.kind}>`);
  }
  return { html: html.join("\n"), words };
}

/** A PDF's pages as positioned runs of text, read with pdf.js. */
export async function readPdfPages(bytes: Uint8Array): Promise<PdfPage[]> {
  // The legacy build, which still reads on an older phone's browser.
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  if (typeof window !== "undefined") {
    // pdf.js wants its worker as a separate script it fetches by address.
    // Loaded into this page instead, it reads on the page's own thread and
    // there is no worker file to serve.
    await import("pdfjs-dist/legacy/build/pdf.worker.mjs");
  }
  const doc = await pdfjs.getDocument({ data: bytes, isEvalSupported: false, verbosity: 0, useSystemFonts: false }).promise;
  try {
    const pages: PdfPage[] = [];
    for (let n = 1; n <= Math.min(doc.numPages, MAX_PDF_PAGES); n += 1) {
      const page = await doc.getPage(n);
      const content = await page.getTextContent();
      const runs: PdfRun[] = [];
      for (const item of content.items as { str?: string; transform?: number[]; width?: number; height?: number; hasEOL?: boolean }[]) {
        if (typeof item.str !== "string" || !item.transform) continue;
        const [, , c, d, x, y] = item.transform;
        runs.push({ str: item.str, x, y, width: item.width ?? 0, height: item.height || Math.hypot(c, d), hasEOL: item.hasEOL });
      }
      pages.push({ runs });
      page.cleanup();
    }
    return pages;
  } finally {
    await doc.destroy();
  }
}
