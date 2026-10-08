"use client";

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { printHtml } from "@/lib/print";

/** What a print is built from: given the choices, the whole page. */
export type PrintJob = {
  /** What the dialog calls it: "Housing investigation", "This table". */
  what: string;
  /** Whether a transcript is in it — then it offers to include them whole. */
  transcripts: boolean;
  build: (options: { fullTranscripts: boolean }) => string;
};

/** The width of an A4 sheet in CSS pixels; the preview is that page, scaled to fit. */
const SHEET_PX = 794;

/**
 * Print, with a look first: the page as it will come out of the printer,
 * scaled to fit, and the one choice a print has — whether transcripts go in
 * whole or as their opening lines. Print hands it to the browser's dialog,
 * which also offers Save as PDF.
 */
export default function PrintDialog({ job, onClose }: { job: PrintJob; onClose: () => void }) {
  const [full, setFull] = useState(false);
  const html = useMemo(() => job.build({ fullTranscripts: full }), [job, full]);
  const frame = useRef<HTMLIFrameElement | null>(null);
  const holder = useRef<HTMLDivElement | null>(null);
  const [scale, setScale] = useState(0.6);
  const [height, setHeight] = useState(1123);

  useEffect(() => {
    const esc = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", esc);
    return () => window.removeEventListener("keydown", esc);
  }, [onClose]);

  // The sheet is drawn at its real width and scaled down to the room there is.
  useLayoutEffect(() => {
    const el = holder.current;
    if (!el) return;
    const fit = () => setScale(Math.min(1, (el.clientWidth - 24) / SHEET_PX));
    fit();
    const watch = new ResizeObserver(fit);
    watch.observe(el);
    return () => watch.disconnect();
  }, []);

  /** The preview's own height, once its pictures have settled, so the whole page scrolls as one. */
  const measure = () => {
    const doc = frame.current?.contentDocument;
    if (!doc?.documentElement) return;
    setHeight(Math.max(1123, doc.documentElement.scrollHeight));
    for (const img of Array.from(doc.images)) if (!img.complete) img.addEventListener("load", measure, { once: true });
  };

  return createPortal(
    <div className="overlay print-overlay" onMouseDown={onClose}>
      <div className="print-dialog" role="dialog" aria-modal="true" aria-label={`Print ${job.what}`} onMouseDown={(e) => e.stopPropagation()}>
        <div className="print-dialog-head">
          <div className="print-dialog-title">
            <b>Print</b>
            <span>{job.what}</span>
          </div>
          {job.transcripts && (
            <label className="print-option">
              <input type="checkbox" checked={full} onChange={(e) => setFull(e.target.checked)} />
              Include full transcripts
            </label>
          )}
          <div className="print-dialog-actions">
            <button className="btn ghost small" onClick={onClose}>Cancel</button>
            <button className="btn small" onClick={() => { printHtml(html); onClose(); }}>Print</button>
          </div>
        </div>
        <div className="print-preview" ref={holder}>
          <div className="print-sheet" style={{ width: SHEET_PX * scale, height: height * scale }}>
            <iframe
              ref={frame}
              title="Print preview"
              // Pictures and styles only: nothing in a printed page runs.
              sandbox="allow-same-origin"
              srcDoc={html}
              onLoad={measure}
              style={{ width: SHEET_PX, height, transform: `scale(${scale})` }}
            />
          </div>
        </div>
        <p className="print-hint">Your browser&apos;s print window opens next, where you can also save it as a PDF.</p>
      </div>
    </div>,
    document.body,
  );
}
