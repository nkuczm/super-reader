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
/** Where something sits on a page, in the PDF's own units (points, counted up from the bottom). */
export type PdfBox = { left: number; bottom: number; right: number; top: number };
/** A picture on a page, cut from the page as drawn: where it sits, and its JPEG. */
export type PdfImage = PdfBox & { src: string; width: number; height: number };
export type PdfPage = { runs: PdfRun[]; images?: PdfImage[] };

/** Generous for an article; a book is not what this is for. */
export const MAX_PDF_PAGES = 150;
const MAX_TEXT_CHARS = 400_000;
const MAX_IMAGES = 60;
/** Smaller than this, in points, a picture is an icon or a rule, not a photograph or a chart. */
const MIN_IMAGE_PT = 40;
/** The widest a picture is kept, in pixels: sharp across a laptop's column, not a poster. */
const MAX_IMAGE_PX = 1600;

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
  // Same words, numbers aside, at the same height on the page: the story's
  // own lines can share a shape, but not a place on every page.
  const placeOf = (line: Line) => `${shapeOf(line.text)}@${Math.round(line.y / 4)}`;
  const seen = new Map<string, number>();
  for (const lines of pages) {
    const edges = new Set([...lines.slice(0, EDGE), ...lines.slice(-EDGE)].map(placeOf));
    for (const place of edges) seen.set(place, (seen.get(place) ?? 0) + 1);
  }
  const repeated = (line: Line) => pages.length >= 2 && (seen.get(placeOf(line)) ?? 0) >= Math.max(2, Math.ceil(pages.length * 0.6));
  return pages.map((lines) =>
    lines.filter((line, i) => {
      if (i >= EDGE && i < lines.length - EDGE) return true;
      const shape = shapeOf(line.text);
      return line.size > body * 1.05 || (!PAGE_NUMBER.test(shape) && !repeated(line));
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

type Block = { kind: "p" | "h2" | "h3" | "img"; lines: Line[]; page: number; image?: PdfImage };

/**
 * Lines into paragraphs and headings, by how far apart, how indented and how
 * large they are; and the pictures between them. A picture goes after the
 * paragraph it interrupts — text wrapped round a photograph, or a paragraph
 * running on to the next page past one — never into the middle of it.
 */
function blocksOf(pages: Line[][], images: PdfImage[][] = []): Block[] {
  const all = pages.flat();
  if (all.length === 0) return images.flat().map((image) => ({ kind: "img", lines: [], page: 0, image }));
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
  /** Pictures passed, waiting for the paragraph they interrupt to end. */
  let waiting: Block[] = [];
  pages.forEach((lines, pageIndex) => {
    // Each picture comes before the first line below its top that it sits over.
    const before = new Map<number, PdfImage[]>();
    for (const image of images[pageIndex] ?? []) {
      const at = lines.findIndex((l) => l.y < image.top - 1 && l.x < image.right && l.right > image.left);
      const index = at < 0 ? lines.length : at;
      before.set(index, [...(before.get(index) ?? []), image]);
    }
    const passed = (index: number) => {
      for (const image of before.get(index) ?? []) waiting.push({ kind: "img", lines: [], page: pageIndex, image });
    };
    lines.forEach((line, i) => {
      passed(i);
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
      if (fresh) {
        blocks.push(...waiting, { kind, lines: [line], page: pageIndex });
        waiting = [];
      } else current!.lines.push(line);
      previous = line;
    });
    passed(lines.length);
  });
  blocks.push(...waiting);
  // A "heading" that runs long is a pull quote or a lede set large: text.
  return blocks.map((b) => (b.kind === "h2" || b.kind === "h3") && b.lines.reduce((n, l) => n + l.text.length, 0) > 200 ? { ...b, kind: "p" } : b);
}

/** A picture in the same place on most pages is the publication's, not the article's: a logo, a rule. */
function withoutRunningImages(pages: PdfImage[][]): PdfImage[][] {
  const place = (image: PdfImage) => [image.left, image.bottom, image.right, image.top].map((v) => Math.round(v / 2)).join(",");
  const seen = new Map<string, number>();
  for (const images of pages) for (const key of new Set(images.map(place))) seen.set(key, (seen.get(key) ?? 0) + 1);
  const running = (image: PdfImage) => pages.length >= 2 && (seen.get(place(image)) ?? 0) >= Math.max(2, Math.ceil(pages.length * 0.6));
  return pages.map((images) => images.filter((image) => !running(image)));
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
 * The article's headline in a PDF: the largest text near the start of its
 * first page, set larger than the text. Its index among the blocks, or -1.
 */
function headlineAt(blocks: Block[], texts: string[], body: number): number {
  let best = -1;
  let size = body * 1.3;
  let seen = 0;
  for (const [i, block] of blocks.entries()) {
    if (block.page > 0 || seen >= 8) break;
    if (block.kind === "img" || !texts[i]) continue;
    seen += 1;
    const largest = Math.max(...block.lines.map((l) => l.size));
    const words = texts[i].split(/\s+/).length;
    if (largest >= size && texts[i].length >= 8 && texts[i].length <= 300 && words >= 2) [best, size] = [i, largest];
  }
  return best;
}

/**
 * The article's HTML from a PDF's pages, and its headline when the PDF sets
 * one out. The headline is not repeated in the text below it — nor is
 * `title`, the one the reader shows already.
 */
export function pdfArticleHtml(pages: PdfPage[], { title }: { title?: string } = {}): { html: string; words: number; title?: string } {
  const lines = pages.map(linesOf);
  const body = commonest(lines.flat().map((l) => l.size));
  const blocks = blocksOf(withoutRunningLines(lines, body), withoutRunningImages(pages.map((page) => page.images ?? [])));
  const texts = mendBreaks(blocks.map((block) => joined(block.lines)));
  const head = headlineAt(blocks, texts, body || 10);
  const shown = title ? comparable(title) : "";
  let chars = 0;
  let words = 0;
  let pictures = 0;
  let wrote = false;
  const html: string[] = [];
  for (const [i, block] of blocks.entries()) {
    if (block.image) {
      if (pictures >= MAX_IMAGES) continue;
      pictures += 1;
      const { src, left, right, top, bottom } = block.image;
      // Shown at the size it was printed (a point is 4/3 of a CSS pixel); the bitmap is sharper than that.
      const width = Math.round((right - left) * (4 / 3));
      const height = Math.round((top - bottom) * (4 / 3));
      html.push(`<figure><img src="${src.replace(/"/g, "%22")}" alt="" width="${width}" height="${height}" /></figure>`);
      continue;
    }
    const text = texts[i];
    if (!text || i === head) continue;
    if (shown && !wrote && comparable(text) === shown) continue;
    if (chars + text.length > MAX_TEXT_CHARS) break;
    wrote = true;
    chars += text.length;
    words += text.split(/\s+/).filter(Boolean).length;
    html.push(`<${block.kind}>${escapeHtml(text)}</${block.kind}>`);
  }
  return { html: html.join("\n"), words, ...(head >= 0 ? { title: texts[head] } : {}) };
}

type Matrix = [number, number, number, number, number, number];
/** `m`, then `n`: how PDF composes a transform with the one already in force. */
const then = (m: Matrix, n: Matrix): Matrix => [
  m[0] * n[0] + m[1] * n[2], m[0] * n[1] + m[1] * n[3],
  m[2] * n[0] + m[3] * n[2], m[2] * n[1] + m[3] * n[3],
  m[4] * n[0] + m[5] * n[2] + n[4], m[4] * n[1] + m[5] * n[3] + n[5],
];
/** A box, once transformed, as the upright box around it. */
function boxThrough([x0, y0, x1, y1]: number[], m: Matrix): PdfBox | null {
  if (![x0, y0, x1, y1].every(Number.isFinite)) return null;
  const xs: number[] = [];
  const ys: number[] = [];
  for (const [x, y] of [[x0, y0], [x1, y0], [x0, y1], [x1, y1]]) {
    xs.push(m[0] * x + m[2] * y + m[4]);
    ys.push(m[1] * x + m[3] * y + m[5]);
  }
  return { left: Math.min(...xs), bottom: Math.min(...ys), right: Math.max(...xs), top: Math.max(...ys) };
}
function within(a: PdfBox, b: PdfBox | null): PdfBox | null {
  if (!b) return a;
  const box = { left: Math.max(a.left, b.left), bottom: Math.max(a.bottom, b.bottom), right: Math.min(a.right, b.right), top: Math.min(a.top, b.top) };
  return box.right > box.left && box.top > box.bottom ? box : null;
}

/** The pdf.js operators this reads. Their numbers, from `pdfjs.OPS`. */
type Ops = { save: number; restore: number; transform: number; constructPath: number; clip: number; eoClip: number;
  paintFormXObjectBegin: number; paintFormXObjectEnd: number; paintImageXObject: number; paintInlineImageXObject: number };

/**
 * Where a page draws its pictures, from its list of drawing operations: each
 * image fills the unit square of the transform in force, cut to the clip in
 * force — a photograph cropped to its frame on the page is the frame, not the
 * whole photograph. Pictures that overlap or touch are one picture, as a
 * large image drawn in strips is.
 */
export function imageBoxes(fnArray: number[], argsArray: unknown[], ops: Ops): PdfBox[] {
  let ctm: Matrix = [1, 0, 0, 1, 0, 0];
  let clip: PdfBox | null = null;
  let path: PdfBox | null = null;
  const stack: { ctm: Matrix; clip: PdfBox | null }[] = [];
  const found: PdfBox[] = [];
  fnArray.forEach((fn, i) => {
    const args = argsArray[i] as unknown[] | null;
    if (fn === ops.save) stack.push({ ctm, clip });
    else if (fn === ops.restore) ({ ctm, clip } = stack.pop() ?? { ctm, clip });
    else if (fn === ops.transform) ctm = then(args as Matrix, ctm);
    else if (fn === ops.paintFormXObjectBegin) {
      stack.push({ ctm, clip });
      const [matrix, bbox] = (args ?? []) as [Matrix | null, number[] | null];
      if (matrix?.length === 6) ctm = then(matrix, ctm);
      const frame = bbox?.length === 4 ? boxThrough(bbox, ctm) : null;
      if (frame) clip = within(frame, clip) ?? { left: 0, bottom: 0, right: 0, top: 0 };
    } else if (fn === ops.paintFormXObjectEnd) ({ ctm, clip } = stack.pop() ?? { ctm, clip });
    else if (fn === ops.constructPath) path = boxThrough(Array.from(((args ?? [])[2] as ArrayLike<number>) ?? []), ctm);
    else if ((fn === ops.clip || fn === ops.eoClip) && path) clip = within(path, clip) ?? { left: 0, bottom: 0, right: 0, top: 0 };
    else if (fn === ops.paintImageXObject || fn === ops.paintInlineImageXObject) {
      const drawn = boxThrough([0, 0, 1, 1], ctm);
      const seen = drawn && within(drawn, clip);
      if (seen) found.push(seen);
    }
  });
  // Overlapping or touching pictures, joined until none are left to join.
  const merged: PdfBox[] = [];
  for (const box of found) {
    let next = { ...box };
    for (let i = merged.length - 1; i >= 0; i -= 1) {
      const other = merged[i];
      if (other.left <= next.right + 2 && next.left <= other.right + 2 && other.bottom <= next.top + 2 && next.bottom <= other.top + 2) {
        next = { left: Math.min(next.left, other.left), bottom: Math.min(next.bottom, other.bottom), right: Math.max(next.right, other.right), top: Math.max(next.top, other.top) };
        merged.splice(i, 1);
        i = merged.length;
      }
    }
    merged.push(next);
  }
  return merged;
}

/**
 * The pictures cut from a page as pdf.js draws it — what the reader saw in
 * the PDF, whatever format each image was stored in, masks and all.
 */
async function cropImages(
  page: { view: number[]; getViewport: (o: { scale: number }) => PageViewport; render: (o: { canvasContext: CanvasRenderingContext2D; viewport: PageViewport }) => { promise: Promise<unknown> } },
  boxes: PdfBox[],
): Promise<PdfImage[]> {
  const [x0, y0, x1, y1] = page.view;
  const scale = Math.min(2.5, 3200 / Math.max(x1 - x0, y1 - y0, 1));
  const viewport = page.getViewport({ scale });
  const canvas = document.createElement("canvas");
  canvas.width = Math.ceil(viewport.width);
  canvas.height = Math.ceil(viewport.height);
  const context = canvas.getContext("2d");
  if (!context) return [];
  try {
    await page.render({ canvasContext: context, viewport }).promise;
    const images: PdfImage[] = [];
    for (const box of boxes) {
      const [ax, ay, bx, by] = viewport.convertToViewportRectangle([box.left, box.bottom, box.right, box.top]);
      const sx = Math.max(0, Math.floor(Math.min(ax, bx)));
      const sy = Math.max(0, Math.floor(Math.min(ay, by)));
      const sw = Math.min(canvas.width, Math.ceil(Math.max(ax, bx))) - sx;
      const sh = Math.min(canvas.height, Math.ceil(Math.max(ay, by))) - sy;
      if (sw < 8 || sh < 8) continue;
      const fit = Math.min(1, MAX_IMAGE_PX / sw);
      const piece = document.createElement("canvas");
      piece.width = Math.round(sw * fit);
      piece.height = Math.round(sh * fit);
      piece.getContext("2d")?.drawImage(canvas, sx, sy, sw, sh, 0, 0, piece.width, piece.height);
      images.push({ ...box, src: piece.toDataURL("image/jpeg", 0.85), width: piece.width, height: piece.height });
    }
    return images;
  } finally {
    // A page at this size is tens of megabytes of pixels: let it go now.
    canvas.width = 0;
    canvas.height = 0;
  }
}

type PageViewport = { width: number; height: number; convertToViewportRectangle: (rect: number[]) => number[] };

/**
 * A PDF's pages as positioned runs of text, read with pdf.js — and, in a
 * browser, the pictures on them. `onPage` hears how far it has got.
 */
export async function readPdfPages(bytes: Uint8Array, onPage?: (page: number, pages: number) => void): Promise<PdfPage[]> {
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
    const count = Math.min(doc.numPages, MAX_PDF_PAGES);
    for (let n = 1; n <= count; n += 1) {
      onPage?.(n, count);
      const page = await doc.getPage(n);
      const content = await page.getTextContent();
      const runs: PdfRun[] = [];
      for (const item of content.items as { str?: string; transform?: number[]; width?: number; height?: number; hasEOL?: boolean }[]) {
        if (typeof item.str !== "string" || !item.transform) continue;
        const [, , c, d, x, y] = item.transform;
        runs.push({ str: item.str, x, y, width: item.width ?? 0, height: item.height || Math.hypot(c, d), hasEOL: item.hasEOL });
      }
      // Pictures are cut from the page as drawn, which needs a canvas.
      let images: PdfImage[] = [];
      if (typeof document !== "undefined") {
        const [x0, y0, x1, y1] = page.view;
        const area = (x1 - x0) * (y1 - y0);
        const { fnArray, argsArray } = await page.getOperatorList();
        const boxes = imageBoxes(fnArray, argsArray, pdfjs.OPS)
          .map((box) => within(box, { left: x0, bottom: y0, right: x1, top: y1 }))
          .filter((box): box is PdfBox => Boolean(box))
          // An icon, or the whole page: a scan's page image, or a background.
          .filter((box) => box.right - box.left >= MIN_IMAGE_PT && box.top - box.bottom >= MIN_IMAGE_PT && (box.right - box.left) * (box.top - box.bottom) < area * 0.9);
        if (boxes.length) images = await cropImages(page as unknown as Parameters<typeof cropImages>[0], boxes);
      }
      pages.push({ runs, images });
      page.cleanup();
    }
    return pages;
  } finally {
    await doc.destroy();
  }
}
