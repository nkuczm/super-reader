"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";

/**
 * Find in a subject: ⌘F (Ctrl+F) on the whiteboard or in the document.
 *
 * It searches what is on the page — story headlines, quotes and notes, text
 * boxes, tables, transcripts, section labels — marks every match, and takes
 * the reader to each in turn: the document scrolls to it; the whiteboard
 * pans (and zooms in, if it was too far out to read) to put it in the middle.
 *
 * Marks are drawn with the CSS Custom Highlight API, which paints over text
 * without touching the DOM, so nothing being edited is disturbed. A section
 * label is an input, whose text no range can reach; a match there lights the
 * whole label instead.
 */

export type FindTarget = {
  /** The whiteboard card holding the match, when on the whiteboard. */
  node: HTMLElement | null;
  /** The element the match is in. */
  el: HTMLElement;
  /** Where the match is on screen. */
  rect: DOMRect;
};

type Hit = { range: Range | null; el: HTMLElement; node: HTMLElement | null };

const HL_ALL = "subject-find";
const HL_ON = "subject-find-on";
/** Parts of a card that are controls, not writing. */
const SKIP = "script, style, svg, button.icon-btn, .subject-box-head, .tag-badges, .wb-menu, .wb-resize, [aria-hidden='true'], .subject-find";

type HighlightRegistry = Map<string, unknown>;
const registry = () => (globalThis.CSS as unknown as { highlights?: HighlightRegistry } | undefined)?.highlights;
const HighlightCtor = () => (globalThis as unknown as { Highlight?: new (...r: Range[]) => unknown }).Highlight;

function clearMarks() {
  registry()?.delete(HL_ALL);
  registry()?.delete(HL_ON);
  document.querySelectorAll(".find-input-hit").forEach((el) => el.classList.remove("find-input-hit", "on"));
}

/** Every match of `needle` under `root`, in reading order. */
function findAll(root: HTMLElement, needle: string, board: boolean): Hit[] {
  const hits: (Hit & { order: number })[] = [];
  let order = 0;
  const nodeOf = (el: Element) => (board ? el.closest<HTMLElement>(".wb-node") : null);
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT, {
    acceptNode: (n) => {
      if (n.nodeType === Node.ELEMENT_NODE) {
        const el = n as Element;
        if (el.matches(SKIP)) return NodeFilter.FILTER_REJECT;
        // A label's words live in its value, not in text nodes (a node's name is a textarea).
        if (el.matches("input.section-label, textarea.section-label")) {
          const input = el as HTMLInputElement | HTMLTextAreaElement;
          if (input.value.toLowerCase().includes(needle)) hits.push({ range: null, el: input, node: nodeOf(input), order: order++ });
          return NodeFilter.FILTER_REJECT;
        }
        return NodeFilter.FILTER_SKIP;
      }
      return NodeFilter.FILTER_ACCEPT;
    },
  });
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    const text = (n.nodeValue ?? "").toLowerCase();
    if (!text) continue;
    for (let i = text.indexOf(needle); i >= 0; i = text.indexOf(needle, i + needle.length)) {
      const range = document.createRange();
      range.setStart(n, i);
      range.setEnd(n, i + needle.length);
      hits.push({ range, el: n.parentElement as HTMLElement, node: nodeOf(n.parentElement as Element), order: order++ });
    }
  }
  if (!board) return hits;
  // On the whiteboard, reading order is where the cards sit: top to bottom, then left to right.
  const at = (h: Hit) => {
    const s = h.node?.style;
    return { y: parseFloat(s?.top ?? "0") || 0, x: parseFloat(s?.left ?? "0") || 0 };
  };
  return hits.sort((a, b) => {
    if (a.node === b.node) return a.order - b.order;
    const pa = at(a);
    const pb = at(b);
    return Math.abs(pa.y - pb.y) > 40 ? pa.y - pb.y : pa.x - pb.x || a.order - b.order;
  });
}

export default function SubjectFind({
  board,
  onGo,
  onClose,
}: {
  /** Searching the whiteboard rather than the document. */
  board: boolean;
  /** Bring a match into view: the whiteboard pans to it; the document scrolls. */
  onGo: (target: FindTarget) => void;
  onClose: () => void;
}) {
  const [query, setQuery] = useState("");
  const [at, setAt] = useState(0);
  const input = useRef<HTMLInputElement | null>(null);
  const onGoRef = useRef(onGo);
  onGoRef.current = onGo;
  const [version, setVersion] = useState(0);

  useLayoutEffect(() => {
    input.current?.focus();
    input.current?.select();
  }, []);

  const rootEl = useCallback(
    () => document.querySelector<HTMLElement>(board ? ".subject-main .wb-canvas" : ".subject-main .subject-doc"),
    [board],
  );

  // Matches, worked out again whenever the query or the page changes. Read
  // off the page as it is drawn, so a new search and its first match agree.
  const hits = useMemo(() => {
    void version;
    const needle = query.trim().toLowerCase();
    const root = typeof document === "undefined" ? null : rootEl();
    return needle && root ? findAll(root, needle, board) : [];
  }, [query, board, rootEl, version]);

  // Switching between whiteboard and document: search the new page once it is drawn.
  useEffect(() => {
    const frame = requestAnimationFrame(() => setVersion((v) => v + 1));
    return () => cancelAnimationFrame(frame);
  }, [board]);

  // The page changing under the search (typing, a card arriving) finds again, a moment later.
  useEffect(() => {
    const root = rootEl();
    if (!root || !query.trim()) return;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const watch = new MutationObserver((records) => {
      // Our own marks on labels are class changes, not content.
      if (records.every((r) => r.type === "attributes")) return;
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => setVersion((v) => v + 1), 250);
    });
    watch.observe(root, { childList: true, subtree: true, characterData: true });
    return () => {
      watch.disconnect();
      if (timer) clearTimeout(timer);
    };
  }, [rootEl, query]);

  const current = hits.length ? ((at % hits.length) + hits.length) % hits.length : -1;

  // Paint every match, the current one stronger.
  useEffect(() => {
    clearMarks();
    const reg = registry();
    const Ctor = HighlightCtor();
    const ranges = hits.filter((h) => h.range).map((h) => h.range!);
    if (reg && Ctor && ranges.length) reg.set(HL_ALL, new Ctor(...ranges));
    for (const h of hits) if (!h.range) h.el.classList.add("find-input-hit");
    const on = hits[current];
    if (on?.range && reg && Ctor) reg.set(HL_ON, new Ctor(on.range));
    if (on && !on.range) on.el.classList.add("on");
    return clearMarks;
  }, [hits, current]);

  // Take the reader to the current match.
  const goTo = useCallback((hit: Hit | undefined) => {
    if (!hit) return;
    const rect = hit.range ? hit.range.getBoundingClientRect() : hit.el.getBoundingClientRect();
    onGoRef.current({ node: hit.node, el: hit.el, rect });
  }, []);
  const step = (by: number) => {
    if (!hits.length) return;
    const next = (((current + by) % hits.length) + hits.length) % hits.length;
    setAt(next);
    goTo(hits[next]);
  };
  // A new search goes to its first match.
  const lastQuery = useRef("");
  useEffect(() => {
    if (query === lastQuery.current) return;
    lastQuery.current = query;
    setAt(0);
    if (hits[0]) goTo(hits[0]);
  }, [query, hits, goTo]);

  return (
    <div className={`subject-find${board ? " on-board" : ""}`} role="search" onPointerDown={(e) => e.stopPropagation()}>
      <svg viewBox="0 0 24 24" width="15" height="15" aria-hidden="true">
        <circle cx="10.5" cy="10.5" r="6" fill="none" stroke="currentColor" strokeWidth="2" />
        <path d="M15 15l5 5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      </svg>
      <input
        ref={input}
        aria-label={board ? "Find on the whiteboard" : "Find in the document"}
        placeholder={board ? "Find on the whiteboard" : "Find in the document"}
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            step(e.shiftKey ? -1 : 1);
          }
          if (e.key === "Escape") {
            e.preventDefault();
            e.stopPropagation();
            onClose();
          }
        }}
      />
      <span className="subject-find-count" aria-live="polite">
        {query.trim() ? (hits.length ? `${current + 1} of ${hits.length}` : "No matches") : ""}
      </span>
      <button className="icon-btn subtle" disabled={!hits.length} aria-label="Previous match" title="Previous (Shift+Enter)" onClick={() => step(-1)}>↑</button>
      <button className="icon-btn subtle" disabled={!hits.length} aria-label="Next match" title="Next (Enter)" onClick={() => step(1)}>↓</button>
      <button className="icon-btn subtle" aria-label="Close find" title="Close (Esc)" onClick={onClose}>✕</button>
    </div>
  );
}
