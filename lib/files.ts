import { stripHtml } from "./feed";
import type { ReadableArticle } from "./article";

/**
 * Files a source links rather than writes: the PDF behind a court opinion, the
 * text of a rule, a CSV of the figures. They arrive as enclosures in a feed or
 * as fields on an API record, and this turns one into the same shape as an
 * article so the reader, the offline download and Saved all handle it without
 * knowing it was a file.
 *
 * Only text-bearing formats are here. An image or a video would need a viewer,
 * not an extractor, and pretending to read one would be worse than linking it.
 */
export type FileKind = "pdf" | "text" | "markdown" | "csv" | "json";

export const FILE_LABELS: Record<FileKind, string> = {
  pdf: "PDF",
  text: "Text",
  markdown: "Markdown",
  csv: "CSV",
  json: "JSON",
};

/** Bounded because this runs in a serverless function on someone's request. */
export const MAX_FILE_BYTES = 12 * 1024 * 1024;
const MAX_TEXT_CHARS = 400_000;
const MAX_PDF_PAGES = 60;

const BY_EXTENSION: Record<string, FileKind> = {
  pdf: "pdf",
  txt: "text",
  text: "text",
  md: "markdown",
  markdown: "markdown",
  csv: "csv",
  tsv: "csv",
  json: "json",
};

const BY_MIME: Record<string, FileKind> = {
  "application/pdf": "pdf",
  "application/x-pdf": "pdf",
  "text/plain": "text",
  "text/markdown": "markdown",
  "text/csv": "csv",
  "text/tab-separated-values": "csv",
  "application/json": "json",
};

/**
 * What kind of file this is, by declared type first and extension second — a
 * feed's enclosure type is more trustworthy than a URL that happens to end in
 * ".pdf", and plenty of real file URLs carry no extension at all.
 */
export function fileKindFor(url: string, mime?: string): FileKind | null {
  const declared = mime?.split(";")[0]?.trim().toLowerCase();
  if (declared && BY_MIME[declared]) return BY_MIME[declared];
  // A declared type that is not a file we read settles it: don't guess from
  // the path when the source has already said it is HTML.
  if (declared && declared.startsWith("text/html")) return null;

  try {
    const path = new URL(url, "https://example.invalid").pathname.toLowerCase();
    const extension = path.split(".").pop() ?? "";
    return BY_EXTENSION[extension] ?? null;
  } catch {
    return null;
  }
}

/** A readable name for the file, since feeds rarely give one. */
export function fileNameFrom(url: string, fallback = "File") {
  try {
    const path = new URL(url).pathname;
    const last = decodeURIComponent(path.split("/").filter(Boolean).pop() ?? "");
    return last || fallback;
  } catch {
    return fallback;
  }
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

/** Blank-line-separated blocks become paragraphs, so it reads as prose. */
function asParagraphs(text: string) {
  return text
    .split(/\n{2,}/)
    .map((block) => block.trim())
    .filter(Boolean)
    .map((block) => `<p>${escapeHtml(block).replace(/\n/g, "<br />")}</p>`)
    .join("\n");
}

/** A table, because a spreadsheet read as prose is unreadable. */
function csvAsTable(text: string, separator: string) {
  const rows = text
    .split(/\r?\n/)
    .filter((row) => row.trim())
    .slice(0, 300)
    .map((row) => row.split(separator));
  if (rows.length === 0) return "<p>This file is empty.</p>";

  const cell = (value: string, tag: "th" | "td") =>
    `<${tag}>${escapeHtml(value.replace(/^"|"$/g, "").trim())}</${tag}>`;
  const [head, ...body] = rows;
  return [
    "<table>",
    `<thead><tr>${head.map((c) => cell(c, "th")).join("")}</tr></thead>`,
    "<tbody>",
    ...body.map((row) => `<tr>${row.map((c) => cell(c, "td")).join("")}</tr>`),
    "</tbody></table>",
  ].join("");
}

async function pdfToText(bytes: Uint8Array): Promise<string> {
  // The legacy build is the one that runs outside a browser. Imported here
  // rather than at module load so the rest of the app does not pay for it.
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const doc = await pdfjs.getDocument({
    data: bytes,
    isEvalSupported: false,
    // Warnings about fonts it will not render are noise in a serverless log;
    // nothing here draws a glyph.
    verbosity: 0,
    // No fonts are rendered, only text pulled out; asking for the standard
    // font data would mean shipping it for nothing.
    useSystemFonts: false,
  }).promise;

  const pages: string[] = [];
  const count = Math.min(doc.numPages, MAX_PDF_PAGES);
  for (let n = 1; n <= count; n += 1) {
    const page = await doc.getPage(n);
    const content = await page.getTextContent();
    // Items carry their own line breaks in `hasEOL`; without honouring it the
    // whole page arrives as one paragraph.
    let text = "";
    for (const item of content.items as { str?: string; hasEOL?: boolean }[]) {
      if (typeof item.str !== "string") continue;
      text += item.str + (item.hasEOL ? "\n" : " ");
    }
    pages.push(text.replace(/[ \t]+/g, " ").trim());
  }
  await doc.destroy();
  return pages.filter(Boolean).join("\n\n");
}

export async function fetchFile(url: string, timeoutMs = 20000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      headers: { accept: "*/*" },
      redirect: "follow",
      signal: controller.signal,
    });
    if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);

    const declared = Number(res.headers.get("content-length") ?? "0");
    if (declared > MAX_FILE_BYTES) {
      throw new Error("That file is too large to open here.");
    }
    const bytes = new Uint8Array(await res.arrayBuffer());
    if (bytes.byteLength > MAX_FILE_BYTES) {
      throw new Error("That file is too large to open here.");
    }
    return {
      bytes,
      contentType: res.headers.get("content-type") ?? undefined,
      finalUrl: res.url || url,
    };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Read a file into the same shape as an extracted article, so everything
 * downstream — the reader, the offline cache, Saved — needs no special case.
 */
export async function readFileAsArticle(
  url: string,
  fallbackTitle?: string,
): Promise<ReadableArticle & { fileKind: FileKind; bytes: number }> {
  const { bytes, contentType, finalUrl } = await fetchFile(url);
  // Read the size now: pdf.js takes ownership of the buffer and detaches it,
  // so afterwards byteLength is 0.
  const size = bytes.byteLength;
  const kind = fileKindFor(finalUrl, contentType);
  if (!kind) {
    throw new Error("That is not a file this reader can open.");
  }

  let html: string;
  if (kind === "pdf") {
    const text = await pdfToText(bytes);
    if (!text.trim()) {
      throw new Error(
        "This PDF has no text in it — it is probably a scan, which needs OCR.",
      );
    }
    html = asParagraphs(text.slice(0, MAX_TEXT_CHARS));
  } else {
    const text = new TextDecoder("utf-8").decode(bytes).slice(0, MAX_TEXT_CHARS);
    if (kind === "csv") {
      html = csvAsTable(text, finalUrl.toLowerCase().endsWith(".tsv") ? "\t" : ",");
    } else if (kind === "json") {
      let pretty = text;
      try {
        pretty = JSON.stringify(JSON.parse(text), null, 2);
      } catch {
        /* not valid JSON after all — show it as it came */
      }
      html = `<pre><code>${escapeHtml(pretty)}</code></pre>`;
    } else {
      html = asParagraphs(text);
    }
  }

  const plain = stripHtml(html, Number.MAX_SAFE_INTEGER);
  return {
    via: "file",
    fileKind: kind,
    bytes: size,
    url: finalUrl,
    title: fallbackTitle?.trim() || fileNameFrom(finalUrl),
    html,
    wordCount: plain ? plain.split(/\s+/).length : 0,
    truncated: size > MAX_TEXT_CHARS,
  };
}
