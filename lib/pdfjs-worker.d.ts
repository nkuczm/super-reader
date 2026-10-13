/**
 * pdf.js's worker, imported only for what importing it does: it registers
 * itself on `globalThis.pdfjsWorker`, where pdf.js looks before fetching a
 * worker script of its own (lib/pdf-article.ts).
 */
declare module "pdfjs-dist/legacy/build/pdf.worker.mjs";
