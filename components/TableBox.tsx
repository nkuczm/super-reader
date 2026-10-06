"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { escapeHtml, sanitizeRichText, textOf, type BoxItem } from "@/lib/subjects";
import {
  cellKey, colName, coveredCells, deleteCol, deleteRow, display, evaluate, fromTsv, insertAt, insertCol, insertRow, isError,
  MAX_COL, MAX_COLS, MAX_ROW, MAX_ROWS, MIN_COL, MIN_ROW, mergeRange, moveLine, pasteBlock, removeAt, safeGrid, safeMetas, safeSizes,
  shiftMetas, sortRows, toTsv,
  type CellMetas, type Grid,
} from "@/lib/sheet";
import RichText from "./RichText";
import CompareVersions from "./CompareVersions";
import FlagButton from "./FlagButton";
import type { FlagInput } from "@/lib/flags";
import { safeFactCheck, scriptColumns, scriptRows, sourceLabel, type FactCheck, type FactClaim, type SourceTarget } from "@/lib/factcheck";

/* ---------- a script's fact-check, painted over its words ---------- */

type DomRange = globalThis.Range;

/** What a script table needs to be fact-checked: a way to run the check, and to open a source. */
export type TableFacts = {
  /** Check one table (a card may hold several, as tabs); its result is written back with `write`. */
  run: (sheet: BoxItem, write: (change: Change) => void) => Promise<void>;
  /** Break the script down into a shot list and production prep, set beside it. */
  produce?: (sheet: BoxItem) => Promise<void>;
  open: (target: SourceTarget, quote: string) => void;
};

const FACT_NAMES = { pass: "fc-pass", verify: "fc-verify", contradicts: "fc-contra" } as const;
const FACT_WORDS = { pass: "Supported", verify: "Needs verification", contradicts: "Contradicts the evidence" } as const;
/** Every table's checked spans, painted through three shared CSS highlights. */
const factPaint = new Map<string, { claim: FactClaim; range: DomRange }[]>();
function repaintFacts() {
  const registry = (globalThis.CSS as unknown as { highlights?: Map<string, unknown> } | undefined)?.highlights;
  const Ctor = (globalThis as unknown as { Highlight?: new (...r: DomRange[]) => unknown }).Highlight;
  if (!registry || !Ctor) return;
  const all = [...factPaint.values()].flat();
  for (const status of ["pass", "verify", "contradicts"] as const) {
    registry.set(FACT_NAMES[status], new Ctor(...all.filter((x) => x.claim.status === status).map((x) => x.range)));
  }
}

/**
 * Where a claim's text sits in a cell, as a DOM range. Matched ignoring
 * whitespace, since the check read the cell as plain text and the cell is
 * paragraphs and line breaks.
 */
function rangeOfText(root: HTMLElement, text: string): DomRange | null {
  const chars: { node: Text; i: number }[] = [];
  let flat = "";
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  for (let n = walker.nextNode() as Text | null; n; n = walker.nextNode() as Text | null) {
    const value = n.data;
    for (let i = 0; i < value.length; i++) {
      if (/\s/.test(value[i])) continue;
      chars.push({ node: n, i });
      flat += value[i];
    }
  }
  const want = text.replace(/\s+/g, "");
  const at = want ? flat.indexOf(want) : -1;
  if (at < 0) return null;
  const a = chars[at];
  const b = chars[at + want.length - 1];
  const range = document.createRange();
  range.setStart(a.node, a.i);
  range.setEnd(b.node, b.i + 1);
  return range;
}

type Change = Partial<BoxItem>;
type Sizes = (number | null)[];
type Range = { r0: number; c0: number; r1: number; c1: number };

/**
 * Defaults per mode: a document table has room to write in, a sheet is
 * compact. A document row is never shorter than one line of its text.
 */
const DEFAULTS = { doc: { col: 160, row: 34, minRow: 34 }, sheet: { col: 96, row: 26, minRow: MIN_ROW } } as const;
const SHEET_GUTTER = 34;

/** Cell colours, light enough to read text over in either theme's text colour. */
export const CELL_COLORS = ["#fde68a", "#fecaca", "#bbf7d0", "#bfdbfe", "#e9d5ff", "#fed7aa", "#e5e7eb"];

/** How wide a table draws, so the card holding it can be that wide. */
export function tableWidth(box: BoxItem): number {
  return Math.max(sheetWidth(box), ...(box.tableTabs ?? []).map((t) => sheetWidth({ ...box, ...t })));
}
function sheetWidth(box: BoxItem): number {
  const mode = box.tableMode ?? "sheet";
  const cols = safeGrid(box.table)[0].length;
  const widths = safeSizes(box.tableCols, cols, MIN_COL, MAX_COL).map((w) => w ?? DEFAULTS[mode].col);
  return widths.reduce((a, b) => a + b, 0) + (mode === "sheet" ? SHEET_GUTTER : 16) + 2;
}

/** A cell's text as document-table HTML: older cells were plain text. */
const asHtml = (v: string) => (/[<&]/.test(v) ? sanitizeRichText(v) : v ? escapeHtml(v).replace(/\n/g, "<br>") : "");

/**
 * A table copied from Google Docs, Word, a web page or a spreadsheet, as
 * rows of cell HTML with its merges and cell colours. Null when the
 * clipboard holds no table.
 */
function tableFromClipboard(data: DataTransfer): { cells: string[][]; metas: CellMetas } | null {
  const html = data.getData("text/html");
  if (!html || !/<table/i.test(html)) return null;
  const doc = new DOMParser().parseFromString(html, "text/html");
  const table = doc.querySelector("table");
  if (!table) return null;
  const cells: string[][] = [];
  const metas: CellMetas = {};
  const taken = new Set<string>();
  Array.from(table.rows).forEach((tr, r) => {
    cells[r] ??= [];
    let c = 0;
    for (const td of Array.from(tr.cells)) {
      while (taken.has(cellKey(r, c))) c++;
      const rs = Math.max(1, td.rowSpan || 1);
      const cs = Math.max(1, td.colSpan || 1);
      cells[r][c] = sanitizeRichText(td.innerHTML);
      const bg = hexColor(td.style.backgroundColor || td.getAttribute("bgcolor") || "");
      const meta: CellMetas[string] = {};
      if (bg && bg !== "#ffffff") meta.bg = bg;
      if (rs > 1 || cs > 1) { meta.rs = rs; meta.cs = cs; }
      if (Object.keys(meta).length) metas[cellKey(r, c)] = meta;
      for (let i = r; i < r + rs; i++) for (let j = c; j < c + cs; j++) {
        taken.add(cellKey(i, j));
        if (i !== r || j !== c) (cells[i] ??= [])[j] = "";
      }
      c += cs;
    }
  });
  const width = Math.max(...cells.map((row) => row.length));
  return { cells: cells.map((row) => Array.from({ length: width }, (_, j) => row[j] ?? "")), metas };
}

/** "rgb(255, 242, 204)" or "#fff2cc" as "#fff2cc"; anything else as "". */
function hexColor(css: string): string {
  const s = css.trim().toLowerCase();
  if (/^#[0-9a-f]{6}$/.test(s)) return s;
  if (/^#[0-9a-f]{3}$/.test(s)) return `#${[...s.slice(1)].map((ch) => ch + ch).join("")}`;
  const m = s.match(/^rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\)$/);
  if (!m || (m[4] !== undefined && Number(m[4]) === 0)) return "";
  return `#${[m[1], m[2], m[3]].map((n) => Number(n).toString(16).padStart(2, "0")).join("")}`;
}

/**
 * Cells as an HTML table that Google Docs, Word and other editors paste as a
 * real table: black rules, colours and merges kept. `cells` holds each
 * cell's HTML.
 */
export function rangeHtml(cells: string[][], metas: CellMetas, g: Range, widths?: number[]): string {
  const covered = coveredCells(metas);
  const rowsHtml: string[] = [];
  for (let r = g.r0; r <= g.r1; r++) {
    const tds: string[] = [];
    for (let c = g.c0; c <= g.c1; c++) {
      if (covered.has(cellKey(r, c))) continue;
      const m = metas[cellKey(r, c)];
      const rs = Math.min(m?.rs ?? 1, g.r1 - r + 1);
      const cs = Math.min(m?.cs ?? 1, g.c1 - c + 1);
      const width = widths && cs === 1 ? `;width:${Math.round(widths[c] * 0.75)}pt` : "";
      tds.push(`<td${rs > 1 ? ` rowspan="${rs}"` : ""}${cs > 1 ? ` colspan="${cs}"` : ""} style="border:1px solid #000000;padding:5px;vertical-align:top${m?.bg ? `;background-color:${m.bg}` : ""}${width}">${cells[r]?.[c] || "<br>"}</td>`);
    }
    rowsHtml.push(`<tr>${tds.join("")}</tr>`);
  }
  return `<table style="border-collapse:collapse;border:1px solid #000000"><tbody>${rowsHtml.join("")}</tbody></table>`;
}

/** Put a table on the clipboard as both a real table and tab-separated text. */
async function copyTable(html: string, text: string) {
  try {
    await navigator.clipboard.write([new ClipboardItem({
      "text/html": new Blob([html], { type: "text/html" }),
      "text/plain": new Blob([text], { type: "text/plain" }),
    })]);
    return true;
  } catch {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      return false;
    }
  }
}

/**
 * A table in one of two modes, switched from its tools:
 *
 *  - **Table**, like a table in Google Docs: no row numbers or column
 *    letters, each cell written in with the same tools as a text box
 *    (Return is a new line, Tab the next cell), and cells keep the size
 *    they are dragged to — never smaller than one line.
 *  - **Sheet**: a spreadsheet, with a formula bar, selection by click, drag
 *    and arrow keys, copy and paste with other spreadsheets, sorting,
 *    inserting and deleting rows and columns, and a running sum of what is
 *    selected.
 *
 * Both can colour cells and merge them, and both take a table pasted from
 * Google Docs, Word or a web page.
 */
/** What lets a cell hold pictures: keep a dropped or pasted file, and show a kept one. */
export type CellMedia = {
  dropImage: (file: File) => Promise<string | null>;
  resolveEmbed: (id: string) => string | undefined;
  replaceEmbed?: (id: string, image: string) => void;
};

/** The fields that make one table: the card's own for the first tab, or a tab's. */
const SHEET_FIELDS = ["table", "tableMode", "tableCols", "tableRows", "tableCells", "factCheck", "factView"] as const;

/**
 * A table card: one table, or several as named tabs along its top. The
 * first tab is the card's own table, so a card from before tabs is simply
 * a card with one; each further tab keeps its own table, sizes, colours and
 * fact-check. Double-click a tab to rename it.
 */
export function TableBox({ box, onChange, media, facts, history }: {
  box: BoxItem;
  onChange: (next: Change) => void;
  media?: CellMedia;
  facts?: TableFacts;
  /** The subject's own undo history, which records every change made through onChange: step back (false) or forward (true). */
  history?: (redo: boolean) => boolean;
}) {
  const tabs = box.tableTabs ?? [];
  // Tabs are versions of the table: V1, V2… with the latest last, and open first.
  const names = [box.tableName || "V1", ...tabs.map((t, i) => t.name || `V${i + 2}`)];
  const [active, setActive] = useState(() => tabs.length);
  const at = Math.min(active, names.length - 1);
  const [naming, setNaming] = useState<number | null>(null);
  const [comparing, setComparing] = useState(false);

  // The table being shown, as a card of its own, and where its changes go.
  const sheet: BoxItem = at === 0 ? box : { ...box, ...Object.fromEntries(SHEET_FIELDS.map((k) => [k, tabs[at - 1][k]])) };
  const write = (change: Change) => {
    if (at === 0) return onChange(change);
    const picked = Object.fromEntries(Object.entries(change).filter(([k]) => (SHEET_FIELDS as readonly string[]).includes(k)));
    onChange({ tableTabs: tabs.map((t, i) => (i === at - 1 ? { ...t, ...picked } : t)) });
  };
  const rename = (i: number, name: string) => {
    const clean = name.trim().slice(0, 60);
    if (i === 0) onChange({ tableName: clean || undefined });
    else onChange({ tableTabs: tabs.map((t, j) => (j === i - 1 ? { ...t, name: clean } : t)) });
    setNaming(null);
  };
  const addTab = () => {
    // A new version starts as a copy of the latest draft — its text, sizes, colours and merges, not its fact check.
    const latest: BoxItem = tabs.length ? { ...box, ...tabs[tabs.length - 1] } : box;
    const fresh = {
      name: `V${names.length + 1}`,
      tableMode: latest.tableMode ?? "doc",
      table: safeGrid(latest.table).map((row) => [...row]),
      tableCols: latest.tableCols,
      tableRows: latest.tableRows,
      tableCells: latest.tableCells,
    };
    onChange({ tableTabs: [...tabs, fresh] });
    setActive(names.length);
  };
  const removeTab = (i: number) => {
    if (names.length < 2 || !window.confirm(`Delete version “${names[i]}”?`)) return;
    if (i === 0) {
      // The second tab becomes the card's own table.
      const [next, ...rest] = tabs;
      onChange({ ...Object.fromEntries(SHEET_FIELDS.map((k) => [k, next[k]])), tableName: next.name, tableTabs: rest });
    } else onChange({ tableTabs: tabs.filter((_, j) => j !== i - 1) });
    setActive(Math.max(0, i - 1));
  };

  const strip = (
      <div className="tbl-tabs" role="tablist" aria-label="Versions" onPointerDown={(e) => e.stopPropagation()}>
        {names.map((name, i) => (
          naming === i ? (
            <input key={i} className="tbl-tab-name" autoFocus defaultValue={name} aria-label="Tab name"
              onBlur={(e) => rename(i, e.target.value)}
              onKeyDown={(e) => {
                e.stopPropagation();
                if (e.key === "Enter") rename(i, (e.target as HTMLInputElement).value);
                if (e.key === "Escape") setNaming(null);
              }} />
          ) : (
            <button key={i} role="tab" aria-selected={i === at} className={`tbl-tab${i === at ? " on" : ""}`}
              title="Double-click to rename"
              onClick={() => setActive(i)} onDoubleClick={() => setNaming(i)}>
              {name}
              {i === at && names.length > 1 && (
                <span className="tbl-tab-x" role="button" aria-label={`Delete ${name}`} title="Delete this version"
                  onClick={(e) => { e.stopPropagation(); removeTab(i); }}>×</span>
              )}
            </button>
          )
        ))}
        <button className="tbl-tab add" aria-label="New version" title="New version — a copy of the latest draft" onClick={addTab}>+</button>
        {names.length > 1 && (
          <button className="tbl-compare" title="Compare two versions side by side" onClick={() => setComparing(true)}>Compare</button>
        )}
        {comparing && (
          <CompareVersions
            versions={names.map((name, i) => ({ name, table: i === 0 ? box.table : tabs[i - 1].table }))}
            from={Math.max(0, (at === 0 ? names.length - 1 : at) - 1)}
            to={at === 0 ? names.length - 1 : at}
            onClose={() => setComparing(false)}
          />
        )}
      </div>
  );
  return (
    <div className="tbl-card">
      <TableSheet key={at} box={sheet} onChange={write} media={media} facts={facts} header={strip} isLatest={at === names.length - 1} history={history} />
    </div>
  );
}

function TableSheet({ box, onChange: apply, media, facts, header, isLatest = true, history }: {
  history?: (redo: boolean) => boolean;
  box: BoxItem;
  onChange: (next: Change) => void;
  media?: CellMedia;
  facts?: TableFacts;
  /** The version tabs, set on the same line as the fact-check buttons. */
  header?: React.ReactNode;
  /** Whether this is the latest version: the only one the fact check runs on. */
  isLatest?: boolean;
}) {
  const check = safeFactCheck(box.factCheck);
  const [checking, setChecking] = useState<{ state: "running" | "error"; job?: "check" | "produce"; message?: string } | null>(null);
  const [menu, setMenu] = useState(false);
  const runJob = async (job: "check" | "produce") => {
    setMenu(false);
    if (!facts || checking?.state === "running") return;
    if (job === "produce" && !facts.produce) return;
    setChecking({ state: "running", job });
    try {
      if (job === "check") await facts.run(box, apply);
      else await facts.produce!(box);
      setChecking(null);
    } catch (error) {
      setChecking({ state: "error", message: error instanceof Error ? error.message : job === "check" ? "The fact-check failed." : "Couldn't break down the script." });
    }
  };
  useEffect(() => {
    if (!menu) return;
    const away = (e: PointerEvent) => (e.target as Element | null)?.closest?.(".tbl-more") || setMenu(false);
    window.addEventListener("pointerdown", away, true);
    return () => window.removeEventListener("pointerdown", away, true);
  }, [menu]);
  /**
   * Undo and redo for everything done to the table — text, colours, rows,
   * merges, moves — as snapshots of the table's fields, so each step puts
   * back exactly what was there.
   */
  const past = useRef<Change[]>([]);
  const future = useRef<Change[]>([]);
  const [, setSteps] = useState(0);
  const shell = useRef<HTMLDivElement | null>(null);
  const latest = useRef(box);
  latest.current = box;
  const snapshot = (): Change => {
    const b = latest.current;
    return { table: b.table, tableMode: b.tableMode, tableCols: b.tableCols, tableRows: b.tableRows, tableCells: b.tableCells };
  };
  const onChange = (next: Change) => {
    // With the subject's history, every change is already recorded there.
    if (history) return apply(next);
    past.current.push(snapshot());
    if (past.current.length > 100) past.current.shift();
    future.current = [];
    setSteps((n) => n + 1);
    apply(next);
  };
  const travel = (back: boolean) => {
    // Leave the cell being typed in first, so what was typed is saved as a
    // step of its own — and is then the step undone.
    const active = document.activeElement as HTMLElement | null;
    if (active?.closest?.(".tbl .rich-body")) {
      active.blur();
      // Keep the keyboard on the table, so the next ⌘Z still lands here.
      shell.current?.focus({ preventScroll: true });
    }
    setTimeout(() => {
      if (history) {
        history(!back);
        setSteps((n) => n + 1);
        return;
      }
      const from = back ? past : future;
      const to = back ? future : past;
      const step = from.current.pop();
      if (!step) return;
      to.current.push(snapshot());
      setSteps((n) => n + 1);
      apply(step);
    }, 0);
  };
  const onUndoKey = (e: React.KeyboardEvent) => {
    if (!(e.metaKey || e.ctrlKey) || e.altKey) return;
    const key = e.key.toLowerCase();
    const redo = (key === "z" && e.shiftKey) || key === "y";
    if (key !== "z" && key !== "y") return;
    // Typing in a cell of a sheet undoes its own letters first.
    if ((e.target as HTMLElement).tagName === "INPUT") return;
    e.preventDefault();
    e.stopPropagation();
    travel(!redo);
  };
  const mode = box.tableMode ?? "sheet";
  const grid = safeGrid(box.table);
  const rows = grid.length;
  const cols = grid[0].length;
  const def = DEFAULTS[mode];
  const colSizes = safeSizes(box.tableCols, cols, MIN_COL, MAX_COL);
  const rowSizes = safeSizes(box.tableRows, rows, MIN_ROW, MAX_ROW);
  const metas = safeMetas(box.tableCells, rows, cols);
  const widths = colSizes.map((w) => w ?? def.col);
  const heights = rowSizes.map((h) => Math.max(def.minRow, h ?? def.row));

  /** A size being dragged, shown live and saved on release. */
  const [drag, setDrag] = useState<{ axis: "col" | "row"; i: number; size: number } | null>(null);
  const shownW = widths.map((w, i) => (drag?.axis === "col" && drag.i === i ? drag.size : w));
  const shownH = heights.map((h, i) => (drag?.axis === "row" && drag.i === i ? drag.size : h));

  const startResize = (axis: "col" | "row", i: number) => (e: React.PointerEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const from = axis === "col" ? e.clientX : e.clientY;
    // A row may have grown past its set height with what is written in it: start from what is shown.
    const tr = axis === "row" ? (e.currentTarget as HTMLElement).closest("table")?.querySelectorAll("tbody tr")[i] as HTMLElement | undefined : undefined;
    const base = axis === "col" ? widths[i] : Math.max(heights[i], tr?.offsetHeight ?? 0);
    const [min, max] = axis === "col" ? [MIN_COL, MAX_COL] : [def.minRow, MAX_ROW];
    // The board may be zoomed: a screen pixel is not a table pixel.
    const el = e.currentTarget as HTMLElement;
    const scale = el.getBoundingClientRect().width / (el.offsetWidth || 1) || 1;
    let size = base;
    const move = (ev: PointerEvent) => {
      size = Math.round(Math.min(max, Math.max(min, base + ((axis === "col" ? ev.clientX : ev.clientY) - from) / scale)));
      setDrag({ axis, i, size });
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      setDrag(null);
      if (size === base) return;
      const list = (axis === "col" ? colSizes : rowSizes).map((v, j) => (j === i ? size : v));
      onChange(axis === "col" ? { tableCols: list } : { tableRows: list });
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  /** A row or column being dragged by its grip: where it would land, drawn as a line. */
  const [moving, setMoving] = useState<{ axis: "col" | "row"; from: number; slot: number; at: number; table: { x: number; y: number; w: number; h: number } } | null>(null);
  const startMove = (axis: "col" | "row", from: number) => (e: React.PointerEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const table = (e.currentTarget as HTMLElement).closest("table");
    if (!table) return;
    const gutter = mode === "sheet" ? SHEET_GUTTER : 0;
    // The sheet's header row sits above the first data row.
    const head = mode === "sheet" ? (table.querySelector("thead") as HTMLElement | null)?.offsetHeight ?? 0 : 0;
    const sizes = axis === "col" ? shownW : shownH;
    const bounds = sizes.reduce<number[]>((acc, s) => [...acc, acc[acc.length - 1] + s], [axis === "col" ? gutter : head]);
    const box = { x: table.offsetLeft, y: table.offsetTop, w: table.offsetWidth, h: table.offsetHeight };
    const place = (ev: PointerEvent) => {
      const rect = table.getBoundingClientRect();
      const scale = rect.width / (table.offsetWidth || 1) || 1;
      const p = axis === "col" ? (ev.clientX - rect.left) / scale : (ev.clientY - rect.top) / scale;
      let slot = 0;
      let best = Infinity;
      bounds.forEach((b, i) => { if (Math.abs(b - p) < best) { best = Math.abs(b - p); slot = i; } });
      setMoving({ axis, from, slot, at: bounds[slot], table: box });
      return slot;
    };
    let slot = from;
    place(e.nativeEvent);
    const move = (ev: PointerEvent) => { slot = place(ev); };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      setMoving(null);
      if (slot === from || slot === from + 1) return;
      const to = slot > from ? slot - 1 : slot;
      const out = moveLine(grid, axis === "col" ? colSizes : rowSizes, metas, axis, from, to);
      if (axis === "col") reshape(out.grid, out.sizes, rowSizes, out.metas);
      else reshape(out.grid, colSizes, out.sizes, out.metas);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  /** Grid, sizes and cell extras changed together, so a moved row keeps its height and colour. */
  const reshape = (next: Grid, nextCols: Sizes = colSizes, nextRows: Sizes = rowSizes, nextMetas: CellMetas = metas) =>
    onChange({
      table: next,
      tableCols: safeSizes(nextCols, next[0].length, MIN_COL, MAX_COL),
      tableRows: safeSizes(nextRows, next.length, MIN_ROW, MAX_ROW),
      tableCells: safeMetas(nextMetas, next.length, next[0].length),
    });

  const ops: Ops = {
    // `n` lines at once: as many as are selected.
    insertRow: (at, n = 1) => {
      const k = Math.min(n, MAX_ROWS - rows);
      if (k < 1) return;
      let g = grid;
      let sz = rowSizes;
      for (let i = 0; i < k; i++) { g = insertRow(g, at); sz = insertAt(sz, at, null); }
      reshape(g, colSizes, sz, shiftMetas(metas, "row", at, k));
    },
    deleteRow: (at, n = 1) => {
      const k = Math.min(n, rows - 1, rows - at);
      if (k < 1) return;
      let g = grid;
      let sz = rowSizes;
      for (let i = 0; i < k; i++) { g = deleteRow(g, at); sz = removeAt(sz, at); }
      reshape(g, colSizes, sz, shiftMetas(metas, "row", at, -k));
    },
    insertCol: (at, n = 1) => {
      const k = Math.min(n, MAX_COLS - cols);
      if (k < 1) return;
      let g = grid;
      let sz = colSizes;
      for (let i = 0; i < k; i++) { g = insertCol(g, at); sz = insertAt(sz, at, null); }
      reshape(g, sz, rowSizes, shiftMetas(metas, "col", at, k));
    },
    deleteCol: (at, n = 1) => {
      const k = Math.min(n, cols - 1, cols - at);
      if (k < 1) return;
      let g = grid;
      let sz = colSizes;
      for (let i = 0; i < k; i++) { g = deleteCol(g, at); sz = removeAt(sz, at); }
      reshape(g, sz, rowSizes, shiftMetas(metas, "col", at, -k));
    },
    merge: (g) => onChange({ tableCells: safeMetas(mergeRange(metas, g.r0, g.c0, g.r1, g.c1), rows, cols) }),
    unmerge: (r, c) => {
      const next = { ...metas };
      const m = next[cellKey(r, c)];
      if (!m) return;
      next[cellKey(r, c)] = m.bg ? { bg: m.bg } : {};
      onChange({ tableCells: safeMetas(next, rows, cols) });
    },
    color: (g, bg) => {
      const next = { ...metas };
      for (let r = g.r0; r <= g.r1; r++) for (let c = g.c0; c <= g.c1; c++) {
        const { bg: _old, ...rest } = next[cellKey(r, c)] ?? {};
        void _old;
        next[cellKey(r, c)] = bg ? { ...rest, bg } : rest;
      }
      onChange({ tableCells: safeMetas(next, rows, cols) });
    },
    /** A pasted table, written in at (r, c) with its merges and colours. */
    pasteTable: (r, c, block, blockMetas) => {
      const next = pasteBlock(grid, r, c, block);
      const merged: CellMetas = { ...metas };
      for (let i = 0; i < block.length; i++) for (let j = 0; j < block[0].length; j++) delete merged[cellKey(r + i, c + j)];
      for (const [k, m] of Object.entries(blockMetas)) {
        const [i, j] = k.split(",").map(Number);
        merged[cellKey(r + i, c + j)] = m;
      }
      reshape(next, colSizes, rowSizes, merged);
    },
  };

  const switchTo = (next: "doc" | "sheet") => {
    if (next === mode) return;
    // A document table holds formatted text; a sheet holds what was typed.
    const table = grid.map((row) => row.map((v) => (next === "sheet" ? (/[<&]/.test(v) ? textOf(v) : v) : asHtml(v))));
    onChange({ tableMode: next, table });
  };

  const factView = mode === "doc" && !!box.factView && !!check && checking?.state !== "running";
  const counts = check ? { pass: 0, verify: 0, contradicts: 0, ...Object.fromEntries((["pass", "verify", "contradicts"] as const).map((k) => [k, check.claims.filter((c) => c.status === k && !c.resolved).length])) } : null;
  const resolvedCount = check ? check.claims.filter((c) => c.resolved).length : 0;
  // The script's length: the words to be spoken, header row aside.
  const wordCount = scriptRows(box.table).reduce((n, r) => n + (r.text.match(/[\p{L}\p{N}][\p{L}\p{N}'’-]*/gu)?.length ?? 0), 0);
  /** A claim marked as dealt with: its colour goes, and the check remembers it. */
  const resolveClaim = (claim: FactClaim, resolved: boolean) => {
    if (!check) return;
    apply({ factCheck: { ...check, claims: check.claims.map((c) => (c.row === claim.row && c.text === claim.text ? { ...c, resolved } : c)) } });
  };
  const props: Inner = { facts: factView && facts ? { check: check!, words: scriptColumns(grid).words, open: facts.open, resolve: resolveClaim } : null, media, grid, metas, widths: shownW, heights: shownH, startResize, startMove, moving, onChange, ops, reshape, colSizes, rowSizes };
  return (
    <div ref={shell} tabIndex={-1} className={`tbl tbl-${mode}`} onPointerDown={(e) => e.stopPropagation()} onKeyDownCapture={onUndoKey}>
      {!(facts && mode === "doc") && header && <div className="fc-bar">{header}</div>}
      {facts && mode === "doc" && (
        <div className={`fc-bar${checking?.state === "running" ? " running" : ""}`}>
          {header}
          {checking?.state === "running" ? (
            <span className="fc-running">{checking.job === "produce" ? "Breaking the script down into shots and production needs…" : "Checking the script against your research…"}</span>
          ) : (
            <>
              {check && (
                <button className={`fc-toggle${box.factView ? " on" : ""}`} aria-pressed={!!box.factView}
                  onClick={() => apply({ factView: !box.factView })}>
                  View fact check
                </button>
              )}
              {check && box.factView && counts && (
                <span className="fc-counts" aria-label="Fact-check results">
                  <span className="fc-dot pass" />{counts.pass} supported
                  <span className="fc-dot verify" />{counts.verify} to verify
                  <span className="fc-dot contradicts" />{counts.contradicts} contradicted
                  {resolvedCount > 0 && (
                    <button className="fc-restore" title="Show the resolved ones again"
                      onClick={() => apply({ factCheck: { ...check, claims: check.claims.map(({ resolved: _r, ...c }) => c) } })}>
                      ✓ {resolvedCount} resolved · restore
                    </button>
                  )}
                </span>
              )}
              <span className="fc-words" title="Words in the Words column, and about how long they take to say at 150 words a minute">
                {wordCount.toLocaleString()} words · ~{Math.floor(wordCount / 150)}:{String(Math.round(((wordCount % 150) / 150) * 60)).padStart(2, "0")}
              </span>
              {checking?.state === "error" && <span className="fc-error">{checking.message}</span>}
              {/* The script's tools, kept out of the way in the card's corner. */}
              <span className="tbl-more">
                <button className="tbl-more-btn" aria-label="Script tools" aria-haspopup="menu" aria-expanded={menu}
                  title="Script tools — fact check, production prep" onClick={() => setMenu((v) => !v)}>⋯</button>
                {menu && (
                  <span className="tbl-more-menu" role="menu">
                    {isLatest ? (
                      <>
                        <button role="menuitem" onClick={() => void runJob("check")}
                          title="Check the Words column against this subject's stories, notes and transcripts">
                          {check ? "Fact check again" : "Fact check"}
                        </button>
                        {facts.produce && (
                          <button role="menuitem" onClick={() => void runJob("produce")}
                            title="A shot list to tick off and a production prep list, made from the script and set beside it">
                            Process to production
                          </button>
                        )}
                      </>
                    ) : (
                      <span className="tbl-more-note">These run on the latest version</span>
                    )}
                  </span>
                )}
              </span>
            </>
          )}
        </div>
      )}
      {mode === "doc" ? <DocTable {...props} /> : <SheetTable {...props} />}
      <div className="sheet-tools">
        <span className="tbl-mode" role="group" aria-label="Table style">
          <button className={mode === "doc" ? "on" : ""} aria-pressed={mode === "doc"} onClick={() => switchTo("doc")}
            title="A plain table you write in, like a table in a document">Table</button>
          <button className={mode === "sheet" ? "on" : ""} aria-pressed={mode === "sheet"} onClick={() => switchTo("sheet")}
            title="A spreadsheet, with formulas">Sheet</button>
        </span>
        <button className="tbl-undo" disabled={!history && !past.current.length} onMouseDown={(e) => e.preventDefault()} onClick={() => travel(true)}
          title="Undo (⌘Z)" aria-label="Undo">↶</button>
        <button className="tbl-undo" disabled={!history && !future.current.length} onMouseDown={(e) => e.preventDefault()} onClick={() => travel(false)}
          title="Redo (⌘⇧Z)" aria-label="Redo">↷</button>
        <button disabled={rows >= MAX_ROWS} onClick={() => ops.insertRow(rows)}>+ Row</button>
        <button disabled={cols >= MAX_COLS} onClick={() => ops.insertCol(cols)}>+ Column</button>
        <button disabled={rows <= 1} onClick={() => ops.deleteRow(rows - 1)}>− Row</button>
        <button disabled={cols <= 1} onClick={() => ops.deleteCol(cols - 1)}>− Column</button>
        <CopyTableButton onCopy={() => {
          const all = { r0: 0, c0: 0, r1: rows - 1, c1: cols - 1 };
          const values = mode === "doc" ? null : evaluate(grid);
          const cells = grid.map((row, r) => row.map((v, c) => (values ? escapeHtml(display(values[r][c])) : asHtml(v))));
          const text = values ? values.map((row) => row.map(display).join("\t")).join("\n") : grid.map((row) => row.map((v) => textOf(asHtml(v)).replace(/\s*\n\s*/g, " ")).join("\t")).join("\n");
          return copyTable(rangeHtml(cells, metas, all, widths), text);
        }} />
        <span className="sheet-hint">
          {mode === "sheet" ? "=SUM(A1:A5), =AVG(B:B)… · " : "Shift-click to pick cells · "}right-click for colour, merge and more
        </span>
      </div>
    </div>
  );
}

/** "Copy table", which says so when it has. */
function CopyTableButton({ onCopy }: { onCopy: () => Promise<boolean> }) {
  const [done, setDone] = useState<"" | "ok" | "no">("");
  return (
    <button onClick={async () => { setDone((await onCopy()) ? "ok" : "no"); setTimeout(() => setDone(""), 1600); }}
      title="Copy the whole table, to paste into Google Docs, Word or a spreadsheet">
      {done === "ok" ? "Copied ✓" : done === "no" ? "Couldn't copy" : "Copy table"}
    </button>
  );
}

type Ops = {
  insertRow: (at: number, n?: number) => void;
  deleteRow: (at: number, n?: number) => void;
  insertCol: (at: number, n?: number) => void;
  deleteCol: (at: number, n?: number) => void;
  merge: (g: Range) => void;
  unmerge: (r: number, c: number) => void;
  color: (g: Range, bg: string | null) => void;
  pasteTable: (r: number, c: number, block: string[][], metas: CellMetas) => void;
};

type Inner = {
  facts: { check: FactCheck; words: number; open: TableFacts["open"]; resolve: (claim: FactClaim, resolved: boolean) => void } | null;
  media?: CellMedia;
  grid: Grid;
  metas: CellMetas;
  widths: number[];
  heights: number[];
  startResize: (axis: "col" | "row", i: number) => (e: React.PointerEvent) => void;
  startMove: (axis: "col" | "row", i: number) => (e: React.PointerEvent) => void;
  moving: { axis: "col" | "row"; at: number; table: { x: number; y: number; w: number; h: number } } | null;
  onChange: (next: Change) => void;
  ops: Ops;
  reshape: (next: Grid, cols?: Sizes, rows?: Sizes, metas?: CellMetas) => void;
  colSizes: Sizes;
  rowSizes: Sizes;
};

/** The handle to drag a row or column by. */
function Grip({ axis, onPointerDown }: { axis: "col" | "row"; onPointerDown: (e: React.PointerEvent) => void }) {
  return (
    <span className={`tbl-grip tbl-grip-${axis}`} onPointerDown={onPointerDown} onClick={(e) => e.stopPropagation()}
      title={axis === "row" ? "Drag to move this row" : "Drag to move this column"} aria-hidden>
      {axis === "row" ? "⋮⋮" : "⋯"}
    </span>
  );
}

/** Where a dragged row or column would land. */
function MoveMark({ moving }: { moving: Inner["moving"] }) {
  if (!moving) return null;
  const { table, at, axis } = moving;
  const style = axis === "col"
    ? { left: table.x + at - 1, top: table.y, width: 3, height: table.h }
    : { left: table.x, top: table.y + at - 1, width: table.w, height: 3 };
  return <div className="tbl-move-mark" style={style} />;
}

/** A cell's height and width, summed across what it spans. */
const span = (list: number[], from: number, n: number) => list.slice(from, from + n).reduce((a, b) => a + b, 0);

/** What the check found for one span of the script, and where it found it. */
function FactCard({ claim, targets, open, x, y, onEnter, onClose, onResolve, flag }: {
  onResolve: () => void;
  flag: () => FlagInput;
  claim: FactClaim;
  targets: Record<string, SourceTarget>;
  open: TableFacts["open"];
  x: number;
  y: number;
  onEnter: () => void;
  onClose: () => void;
}) {
  const left = Math.max(8, Math.min(x - 20, window.innerWidth - 340));
  const below = y + 18;
  const style = below + 260 > window.innerHeight ? { left, bottom: window.innerHeight - y + 12 } : { left, top: below };
  return (
    <div className={`fc-pop ${claim.status}`} style={style} onMouseEnter={onEnter} role="dialog" aria-label={FACT_WORDS[claim.status]}>
      <div className="fc-pop-head">
        <span className={`fc-dot ${claim.status}`} />
        <b>{FACT_WORDS[claim.status]}</b>
        <FlagButton make={flag} className="fc-pop-flag" />
        <button className="fc-pop-resolve" aria-label="Resolve" title="Resolve — dealt with, stop highlighting it" onClick={onResolve}>✓</button>
        <button className="fc-pop-x" aria-label="Close" onClick={onClose}>×</button>
      </div>
      {claim.why && <p className="fc-why">{claim.why}</p>}
      {claim.sources.length > 0 ? (
        <ul className="fc-sources">
          {claim.sources.map((s, i) => {
            const target = targets[s.ref] ?? targets[s.ref.split("#")[0]];
            return (
              <li key={i}>
                <button disabled={!target} onClick={() => { if (target) { open(target, s.quote); onClose(); } }}>
                  <span className="fc-source-name">{sourceLabel(s.ref, targets)}</span>
                  {s.quote && <span className="fc-source-quote">“{s.quote}”</span>}
                </button>
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="fc-none">Nothing in your research speaks to this yet.</p>
      )}
    </div>
  );
}

/** Insert and delete, as many rows or columns as are selected. */
function LineItems({ range, ops, close, rows, cols, sheet }: { range: Range; ops: Ops; close: () => void; rows?: boolean; cols?: boolean; sheet?: boolean }) {
  const nr = range.r1 - range.r0 + 1;
  const nc = range.c1 - range.c0 + 1;
  const plural = (n: number, one: string) => (n === 1 ? `1 ${one}` : `${n} ${one}s`);
  const rowName = nr === 1 ? `row ${range.r0 + 1}` : `rows ${range.r0 + 1}–${range.r1 + 1}`;
  const colLabel = (c: number) => (sheet ? colName(c) : String(c + 1));
  const colNameText = nc === 1 ? `column ${colLabel(range.c0)}` : `columns ${colLabel(range.c0)}–${colLabel(range.c1)}`;
  const run = (f: () => void) => () => { f(); close(); };
  return (
    <>
      {rows && (
        <>
          <button role="menuitem" onClick={run(() => ops.insertRow(range.r0, nr))}>Insert {plural(nr, "row")} above</button>
          <button role="menuitem" onClick={run(() => ops.insertRow(range.r1 + 1, nr))}>Insert {plural(nr, "row")} below</button>
        </>
      )}
      {cols && (
        <>
          <button role="menuitem" onClick={run(() => ops.insertCol(range.c0, nc))}>Insert {plural(nc, "column")} left</button>
          <button role="menuitem" onClick={run(() => ops.insertCol(range.c1 + 1, nc))}>Insert {plural(nc, "column")} right</button>
        </>
      )}
      {rows && <button role="menuitem" onClick={run(() => ops.deleteRow(range.r0, nr))}>Delete {rowName}</button>}
      {cols && <button role="menuitem" onClick={run(() => ops.deleteCol(range.c0, nc))}>Delete {colNameText}</button>}
    </>
  );
}

/** The menu items both modes share: merging and colouring. */
function CellMenuExtras({ range, metas, ops, close }: { range: Range; metas: CellMetas; ops: Ops; close: () => void }) {
  const many = range.r1 > range.r0 || range.c1 > range.c0;
  const m = metas[cellKey(range.r0, range.c0)];
  const merged = (m?.rs ?? 1) > 1 || (m?.cs ?? 1) > 1;
  return (
    <>
      {many && <button role="menuitem" onClick={() => { ops.merge(range); close(); }}>Merge cells</button>}
      {merged && <button role="menuitem" onClick={() => { ops.unmerge(range.r0, range.c0); close(); }}>Unmerge cells</button>}
      <div className="tbl-swatches" role="group" aria-label="Cell colour">
        {CELL_COLORS.map((color) => (
          <button key={color} role="menuitem" className="tbl-swatch" style={{ background: color }} aria-label={`Colour ${color}`}
            onClick={() => { ops.color(range, color); close(); }} />
        ))}
        <button role="menuitem" className="tbl-swatch none" aria-label="No colour" title="No colour" onClick={() => { ops.color(range, null); close(); }}>⌀</button>
      </div>
    </>
  );
}

/* ---------------------------------------------------------------------- */
/* Table: written in like a document                                       */
/* ---------------------------------------------------------------------- */

function DocTable({ facts, media, grid, metas, widths, heights, startResize, startMove, moving, onChange, ops }: Inner) {
  const host = useRef<HTMLTableElement | null>(null);
  const rows = grid.length;
  const cols = grid[0].length;
  const covered = coveredCells(metas);
  const [focus, setFocus] = useState<{ r: number; c: number }>({ r: 0, c: 0 });
  /** Cells picked with Shift-click, for merging or colouring together. */
  const [picked, setPickedState] = useState<Range | null>(null);
  // Kept in a ref as well, so a key pressed straight after a drag acts on what was just picked.
  const pickedRef = useRef<Range | null>(null);
  const setPicked = (g: Range | null) => {
    pickedRef.current = g;
    setPickedState(g);
  };
  const [menu, setMenu] = useState<{ range: Range; x: number; y: number } | null>(null);
  useMenuClose(menu, () => setMenu(null));

  /** While one command runs over several cells, their own saves wait for the one save of them all. */
  const batching = useRef(false);
  const dragFrom = useRef<{ r: number; c: number } | null>(null);
  const many = !!picked && (picked.r1 > picked.r0 || picked.c1 > picked.c0);
  const manyNow = () => { const g = pickedRef.current; return !!g && (g.r1 > g.r0 || g.c1 > g.c0); };
  useEffect(() => {
    const up = () => (dragFrom.current = null);
    window.addEventListener("pointerup", up);
    return () => window.removeEventListener("pointerup", up);
  }, []);
  const pickedCells = () => {
    const out: { r: number; c: number; el: HTMLElement }[] = [];
    const picked = pickedRef.current;
    if (!picked) return out;
    for (let r = picked.r0; r <= picked.r1; r++) for (let c = picked.c0; c <= picked.c1; c++) {
      if (covered.has(cellKey(r, c))) continue;
      const el = host.current?.querySelector<HTMLElement>(`[data-cell="${r}-${c}"] .rich-body`);
      if (el) out.push({ r, c, el });
    }
    return out;
  };
  /** The cells' HTML as it now stands, saved as one change (one undo step). */
  const saveCells = (cells: { r: number; c: number; html: string }[]) => {
    const next = grid.map((row) => [...row]);
    for (const { r, c, html } of cells) next[r][c] = html;
    onChange({ table: next });
  };
  /** A formatting command over every picked cell, the way Google Docs applies one across a table selection. */
  const formatAcross = (command: string, value?: string) => {
    if (!manyNow()) return false;
    const cells = pickedCells();
    batching.current = true;
    try {
      const sel = window.getSelection();
      const lit = command === "highlight" && cells.every(({ el }) => !el.textContent?.trim() || el.querySelector("mark, span[style*='background']"));
      for (const { el } of cells) {
        el.focus();
        const range = document.createRange();
        range.selectNodeContents(el);
        sel?.removeAllRanges();
        sel?.addRange(range);
        if (command === "highlight") {
          if (lit) el.querySelectorAll("mark, span[style*='background']").forEach((n) => n.replaceWith(...n.childNodes));
          else document.execCommand("hiliteColor", false, "#fde68a");
        } else if (command === "checklist") {
          if (!el.querySelector("ul")) document.execCommand("insertUnorderedList");
          el.querySelector("ul")?.setAttribute("data-check", "");
        } else document.execCommand(command, false, value);
      }
      sel?.removeAllRanges();
      saveCells(cells.map(({ r, c, el }) => ({ r, c, html: sanitizeRichText(el.innerHTML) })));
    } finally {
      setTimeout(() => (batching.current = false), 0);
    }
    return true;
  };
  // Clear what is on screen too: the cell still being typed in would otherwise write its old text back when left.
  const clearPicked = () => saveCells(pickedCells().map(({ r, c, el }) => { el.innerHTML = ""; return { r, c, html: "" }; }));
  /**
   * Dragging from one cell into another picks whole cells, as in Google Docs:
   * the cell under the pointer is found on every move, so a quick diagonal
   * drag still picks the full rectangle.
   */
  const dragPick = (e: React.PointerEvent) => {
    const from = dragFrom.current;
    if (!from || !(e.buttons & 1)) return;
    const td = (document.elementFromPoint(e.clientX, e.clientY) as HTMLElement | null)?.closest<HTMLElement>("td[data-cell]");
    if (!td || !host.current?.contains(td)) return;
    const [r, c] = td.dataset.cell!.split("-").map(Number);
    if (r === from.r && c === from.c && !pickedRef.current) return;
    const m = metas[cellKey(r, c)];
    const fm = metas[cellKey(from.r, from.c)];
    const g = {
      r0: Math.min(from.r, r), c0: Math.min(from.c, c),
      r1: Math.max(from.r + (fm?.rs ?? 1) - 1, r + (m?.rs ?? 1) - 1), c1: Math.max(from.c + (fm?.cs ?? 1) - 1, c + (m?.cs ?? 1) - 1),
    };
    const cur = pickedRef.current;
    if (cur && cur.r0 === g.r0 && cur.c0 === g.c0 && cur.r1 === g.r1 && cur.c1 === g.c1) return;
    window.getSelection()?.removeAllRanges();
    setPicked(g.r0 === g.r1 && g.c0 === g.c1 ? null : g);
  };
  const copyPicked = (e: React.ClipboardEvent, cut: boolean) => {
    const picked = pickedRef.current;
    if (!picked || !manyNow()) return;
    e.preventDefault();
    e.stopPropagation();
    const cells = grid.map((row) => row.map(asHtml));
    e.clipboardData.setData("text/html", rangeHtml(cells, metas, picked, widths));
    e.clipboardData.setData("text/plain", toTsv(grid.map((row) => row.map((v) => textOf(asHtml(v)))), picked.r0, picked.c0, picked.r1, picked.c1));
    if (cut) clearPicked();
  };

  const save = (r: number, c: number, html: string) => {
    if (batching.current) return;
    if (html === grid[r][c]) return;
    onChange({ table: grid.map((row, i) => (i === r ? row.map((v, j) => (j === c ? html : v)) : row)) });
  };
  /**
   * Arrow keys step to the next cell once the caret is at the edge of this
   * one — Up on its first line, Down on its last, Left at its very start,
   * Right at its very end — and otherwise move through the text as usual.
   */
  const moveByArrow = (e: React.KeyboardEvent): boolean => {
    const dirs: Record<string, [number, number]> = { ArrowUp: [-1, 0], ArrowDown: [1, 0], ArrowLeft: [0, -1], ArrowRight: [0, 1] };
    const dir = dirs[e.key];
    if (!dir || e.shiftKey || e.metaKey || e.ctrlKey || e.altKey) return false;
    const body = (e.target as HTMLElement).closest?.<HTMLElement>(".rich-body");
    const cell = body?.closest<HTMLElement>("td[data-cell]");
    const sel = window.getSelection();
    if (!body || !cell || !sel?.rangeCount || !sel.isCollapsed) return false;
    const caret = sel.getRangeAt(0);
    const before = document.createRange();
    before.selectNodeContents(body);
    before.setEnd(caret.startContainer, caret.startOffset);
    const after = document.createRange();
    after.selectNodeContents(body);
    after.setStart(caret.endContainer, caret.endOffset);
    const box = body.getBoundingClientRect();
    const at = caret.getClientRects()[0] ?? caret.getBoundingClientRect();
    const lineH = parseFloat(getComputedStyle(body).lineHeight) || 20;
    const empty = !body.textContent?.trim();
    const edge =
      e.key === "ArrowLeft" ? before.toString().length === 0
      : e.key === "ArrowRight" ? after.toString().length === 0
      : e.key === "ArrowUp" ? empty || !at.height || at.top - box.top < lineH * 0.9 + 6
      : empty || !at.height || box.bottom - at.bottom < lineH * 0.9 + 6;
    if (!edge) return false;
    const [r0, c0] = cell.dataset.cell!.split("-").map(Number);
    const m = metas[cellKey(r0, c0)];
    // Step off a merged cell from its far side, and land on whichever cell covers the one reached.
    let r = dir[0] > 0 ? r0 + (m?.rs ?? 1) : r0 + dir[0];
    let c = dir[1] > 0 ? c0 + (m?.cs ?? 1) : c0 + dir[1];
    if (c < 0) { r -= 1; c = cols - 1; }
    if (c >= cols) { r += 1; c = 0; }
    if (r < 0 || r >= rows) return false;
    const owner = covered.get(cellKey(r, c));
    if (owner) [r, c] = owner.split(",").map(Number);
    const target = host.current?.querySelector<HTMLElement>(`[data-cell="${r}-${c}"] .rich-body`);
    if (!target) return false;
    e.preventDefault();
    e.stopPropagation();
    target.focus({ preventScroll: false });
    const range = document.createRange();
    if (e.key === "ArrowUp" || e.key === "ArrowDown") {
      // Keep the caret's column: the nearest point on the target's last (or first) line.
      const t = target.getBoundingClientRect();
      const x = Math.min(t.right - 2, Math.max(t.left + 2, at.left || t.left));
      const y = e.key === "ArrowUp" ? t.bottom - 4 : t.top + 4;
      const doc = document as Document & { caretPositionFromPoint?: (x: number, y: number) => { offsetNode: Node; offset: number } | null };
      const pos = doc.caretPositionFromPoint?.(x, y);
      if (pos && target.contains(pos.offsetNode)) range.setStart(pos.offsetNode, pos.offset);
      else {
        const hit = document.caretRangeFromPoint?.(x, y);
        if (hit && target.contains(hit.startContainer)) range.setStart(hit.startContainer, hit.startOffset);
        else { range.selectNodeContents(target); range.collapse(e.key === "ArrowDown"); }
      }
    } else {
      range.selectNodeContents(target);
      range.collapse(e.key === "ArrowRight");
    }
    range.collapse(true);
    sel.removeAllRanges();
    sel.addRange(range);
    return true;
  };
  const focusCell = (r: number, c: number) =>
    host.current?.querySelector<HTMLElement>(`[data-cell="${r}-${c}"] .rich-body`)?.focus();
  /** The next cell along that is not hidden under a merge. */
  const step = (r: number, c: number, back: boolean) => {
    let i = r * cols + c;
    for (;;) {
      i += back ? -1 : 1;
      if (i < 0) return null;
      if (i >= rows * cols) return "end" as const;
      const key = cellKey(Math.floor(i / cols), i % cols);
      if (!covered.has(key)) return { r: Math.floor(i / cols), c: i % cols };
    }
  };
  const inPicked = (r: number, c: number) => !!picked && r >= picked.r0 && r <= picked.r1 && c >= picked.c0 && c <= picked.c1;
  const width = widths.reduce((a, b) => a + b, 0);

  // The fact-check, painted over the words it judged; redrawn as the cells are.
  const paintKey = useRef(`fc-${Math.random().toString(36).slice(2)}`);
  const painted = useRef<{ claim: FactClaim; range: DomRange }[]>([]);
  useEffect(() => {
    const key = paintKey.current;
    if (!facts || !host.current) {
      painted.current = [];
      factPaint.delete(key);
      repaintFacts();
      return;
    }
    const spans: { claim: FactClaim; range: DomRange }[] = [];
    for (const claim of facts.check.claims.filter((c) => !c.resolved)) {
      const body = host.current.querySelector<HTMLElement>(`[data-cell="${claim.row}-${facts.words}"] .rich-body`);
      const range = body && rangeOfText(body, claim.text);
      if (range) spans.push({ claim, range });
    }
    painted.current = spans;
    factPaint.set(key, spans);
    repaintFacts();
  });
  useEffect(() => () => { factPaint.delete(paintKey.current); repaintFacts(); }, []);

  /** The claim under the pointer: shown on hover, kept on a click. */
  const [factPop, setFactPop] = useState<{ claim: FactClaim; x: number; y: number; pinned: boolean } | null>(null);
  const claimAt = (x: number, y: number) => {
    for (const { claim, range } of painted.current) {
      for (const r of Array.from(range.getClientRects())) {
        if (x >= r.left - 2 && x <= r.right + 2 && y >= r.top - 2 && y <= r.bottom + 2) return claim;
      }
    }
    return null;
  };
  useEffect(() => {
    if (!factPop?.pinned) return;
    const away = (e: PointerEvent) => !(e.target as Element | null)?.closest?.(".fc-pop") && setFactPop(null);
    window.addEventListener("pointerdown", away, true);
    return () => window.removeEventListener("pointerdown", away, true);
  }, [factPop?.pinned]);

  return (
    <div className={`tbl-scroll${many ? " picking" : ""}${facts ? " fact-view" : ""}`}
      onPointerMove={dragPick}
      onMouseMove={(e) => {
        if (!facts || factPop?.pinned) return;
        const claim = claimAt(e.clientX, e.clientY);
        if (!claim) { if (factPop) setFactPop(null); return; }
        if (factPop?.claim !== claim) setFactPop({ claim, x: e.clientX, y: e.clientY, pinned: false });
      }}
      onMouseLeave={() => factPop && !factPop.pinned && setFactPop(null)}
      onClickCapture={(e) => {
        if (!facts) return;
        const claim = claimAt(e.clientX, e.clientY);
        if (claim) setFactPop({ claim, x: e.clientX, y: e.clientY, pinned: true });
      }}
      onCopyCapture={(e) => copyPicked(e, false)}
      onCutCapture={(e) => copyPicked(e, true)}
      onKeyDownCapture={(e) => {
        if (!manyNow() && moveByArrow(e)) return;
        if (!manyNow()) return;
        if (e.key === "Backspace" || e.key === "Delete") { e.preventDefault(); e.stopPropagation(); clearPicked(); }
        else if (e.key === "Escape") setPicked(null);
        else if (!e.metaKey && !e.ctrlKey && !e.altKey && e.key.length === 1) setPicked(null); // typing goes to the cell
      }}
      // A table copied from Google Docs, Word or the web fills cells from the one being typed in.
      onPasteCapture={(e) => {
        const parsed = tableFromClipboard(e.clipboardData);
        if (!parsed) return;
        e.preventDefault();
        e.stopPropagation();
        (document.activeElement as HTMLElement | null)?.blur();
        ops.pasteTable(focus.r, focus.c, parsed.cells, parsed.metas);
      }}>
      <table ref={host} style={{ width }}>
        <colgroup>{widths.map((w, c) => <col key={c} style={{ width: w }} />)}</colgroup>
        <tbody>
          {grid.map((row, r) => (
            <tr key={r} style={{ height: heights[r] }}>
              {row.map((html, c) => {
                if (covered.has(cellKey(r, c))) return null;
                const m = metas[cellKey(r, c)];
                const rs = m?.rs ?? 1;
                const cs = m?.cs ?? 1;
                return (
                  <td key={c} data-cell={`${r}-${c}`} rowSpan={rs} colSpan={cs}
                    className={inPicked(r, c) ? "picked" : undefined}
                    style={{ height: span(heights, r, rs), background: m?.bg }}
                    onFocusCapture={(e) => {
                      setFocus({ r, c });
                      // The text tools stay in one place above the table, whichever cell is being written in.
                      const cellEl = e.currentTarget as HTMLElement;
                      const tableEl = cellEl.closest("table") as HTMLElement | null;
                      cellEl.style.setProperty("--above", `${cellEl.offsetTop - (tableEl?.offsetTop ?? 0)}px`);
                      cellEl.style.setProperty("--aside", `${cellEl.offsetLeft - (tableEl?.offsetLeft ?? 0)}px`);
                    }}
                    // Capture: the text inside keeps its own presses to itself.
                    onPointerDownCapture={(e) => {
                      if (e.shiftKey) {
                        e.preventDefault();
                        const a = { r: Math.min(focus.r, r), c: Math.min(focus.c, c) };
                        const b = { r: Math.max(focus.r, r + rs - 1), c: Math.max(focus.c, c + cs - 1) };
                        setPicked({ r0: a.r, c0: a.c, r1: b.r, c1: b.c });
                      } else if (e.button === 0) {
                        setPicked(null);
                        dragFrom.current = { r, c };
                      }
                    }}
                    onContextMenu={(e) => {
                      if (window.getSelection()?.toString()) return; // keep the browser's menu for copying text
                      e.preventDefault();
                      e.stopPropagation();
                      const range = picked && inPicked(r, c) ? picked : { r0: r, c0: c, r1: r + rs - 1, c1: c + cs - 1 };
                      setMenu({ range, x: e.clientX, y: e.clientY });
                    }}>
                    {/* At least the height set for the row; taller when more is written. */}
                    <div className="tbl-cell-box" style={{ minHeight: span(heights, r, rs) - 1 }}>
                    <RichText className="tbl-rich" html={asHtml(html)} onChange={(next) => save(r, c, next)} onFormat={formatAcross}
                      onDropImage={media?.dropImage} resolveEmbed={media?.resolveEmbed} onReplaceEmbed={media?.replaceEmbed} toolsBeside
                      onTab={(back) => {
                        const next = step(r, c, back);
                        if (!next) return;
                        if (next === "end") { ops.insertRow(rows); setTimeout(() => focusCell(rows, 0), 60); return; }
                        focusCell(next.r, next.c);
                      }} />
                    </div>
                    {/* Every cell edge is a handle, so a line can be dragged anywhere along it. */}
                    <span className="tbl-col-handle" onPointerDown={startResize("col", c + cs - 1)} aria-hidden />
                    <span className="tbl-row-handle" onPointerDown={startResize("row", r + rs - 1)} aria-hidden />
                    {c === 0 && rs === 1 && <Grip axis="row" onPointerDown={startMove("row", r)} />}
                    {r === 0 && cs === 1 && <Grip axis="col" onPointerDown={startMove("col", c)} />}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
      <MoveMark moving={moving} />
      {facts && factPop && createPortal(
        <FactCard claim={factPop.claim} targets={facts.check.targets} open={facts.open} x={factPop.x} y={factPop.y}
          onResolve={() => { facts.resolve(factPop.claim, true); setFactPop(null); }}
          flag={() => {
            const c = factPop.claim;
            const cell = (r: number, col: number | null) => (col === null || !grid[r] ? "" : textOf(grid[r][col] ?? "").trim());
            const cols = scriptColumns(grid);
            return {
              kind: "fact-check" as const,
              subject: facts.check.subject,
              model: facts.check.model,
              output: `${FACT_WORDS[c.status]}: ${c.why}`,
              context: [
                { label: "Highlighted", text: c.text },
                { label: "Script line", text: cell(c.row, cols.words) },
                ...(cell(c.row, cols.visuals) ? [{ label: "Visual", text: cell(c.row, cols.visuals) }] : []),
                ...(cell(c.row - 1, cols.words) ? [{ label: "Line before", text: cell(c.row - 1, cols.words) }] : []),
                ...(cell(c.row + 1, cols.words) ? [{ label: "Line after", text: cell(c.row + 1, cols.words) }] : []),
                ...c.sources.map((src) => ({ label: `Source — ${sourceLabel(src.ref, facts.check.targets)}`, text: src.quote })),
              ],
              links: c.sources.map((src) => {
                const t = facts.check.targets[src.ref] ?? facts.check.targets[src.ref.split("#")[0]];
                return { title: sourceLabel(src.ref, facts.check.targets), ...(t?.kind === "card" ? { url: t.link } : {}) };
              }),
            };
          }}
          onEnter={() => setFactPop((p) => (p ? { ...p, pinned: true } : p))} onClose={() => setFactPop(null)} />,
        document.body,
      )}
      {menu && createPortal(
        <div className="wb-menu tbl-menu" role="menu" style={{ left: Math.min(menu.x, innerWidth - 220), top: Math.min(menu.y, innerHeight - 320) }}
          onPointerDown={(e) => e.stopPropagation()}>
          <LineItems range={menu.range} ops={ops} close={() => { setMenu(null); setPicked(null); }} rows cols />
          <CellMenuExtras range={menu.range} metas={metas} ops={ops} close={() => { setMenu(null); setPicked(null); }} />
        </div>,
        document.body,
      )}
    </div>
  );
}

/* ---------------------------------------------------------------------- */
/* Sheet: a spreadsheet                                                    */
/* ---------------------------------------------------------------------- */

type Pos = { r: number; c: number };

function SheetTable({ grid, metas, widths, heights, startResize, startMove, moving, onChange, ops, reshape, colSizes, rowSizes }: Inner) {
  const values = evaluate(grid);
  const rows = grid.length;
  const cols = grid[0].length;
  const covered = coveredCells(metas);
  const [sel, setSel] = useState<Pos>({ r: 0, c: 0 });
  const [anchor, setAnchor] = useState<Pos>({ r: 0, c: 0 });
  const [editing, setEditing] = useState<{ text: string; from: "cell" | "bar" } | null>(null);
  const [menu, setMenu] = useState<{ kind: "row" | "col" | "cell"; i: number; x: number; y: number } | null>(null);
  const [selecting, setSelecting] = useState(false);
  const host = useRef<HTMLDivElement | null>(null);
  useMenuClose(menu, () => setMenu(null));

  const clampR = (r: number) => Math.min(rows - 1, Math.max(0, r));
  const clampC = (c: number) => Math.min(cols - 1, Math.max(0, c));
  // A selection inside a merge means the merged cell.
  const owner = (p: Pos) => {
    const k = covered.get(cellKey(p.r, p.c));
    if (!k) return p;
    const [r, c] = k.split(",").map(Number);
    return { r, c };
  };
  const at = owner({ r: clampR(sel.r), c: clampC(sel.c) });
  const atMeta = metas[cellKey(at.r, at.c)];
  const r0 = Math.min(at.r, clampR(anchor.r));
  const r1 = Math.max(at.r + (atMeta?.rs ?? 1) - 1, clampR(anchor.r));
  const c0 = Math.min(at.c, clampC(anchor.c));
  const c1 = Math.max(at.c + (atMeta?.cs ?? 1) - 1, clampC(anchor.c));
  const inRange = (r: number, c: number) => r >= r0 && r <= r1 && c >= c0 && c <= c1;

  useEffect(() => {
    if (!selecting) return;
    const up = () => setSelecting(false);
    window.addEventListener("pointerup", up);
    return () => window.removeEventListener("pointerup", up);
  }, [selecting]);

  const write = (next: Grid) => onChange({ table: next });
  const setCell = (r: number, c: number, text: string) => {
    if (text === grid[r][c]) return;
    write(grid.map((row, i) => (i === r ? row.map((v, j) => (j === c ? text : v)) : row)));
  };
  const select = (p: Pos, extend = false) => {
    const next = owner({ r: clampR(p.r), c: clampC(p.c) });
    setSel(next);
    if (!extend) setAnchor(next);
  };
  const commit = (move?: [number, number]) => {
    if (editing) setCell(at.r, at.c, editing.text);
    setEditing(null);
    if (move) {
      // Step off a merged cell from its far edge.
      const m = metas[cellKey(at.r, at.c)];
      const dr = move[0] > 0 ? (m?.rs ?? 1) : move[0];
      const dc = move[1] > 0 ? (m?.cs ?? 1) : move[1];
      select({ r: at.r + dr, c: at.c + dc });
    }
    host.current?.focus();
  };
  const clearRange = () => write(grid.map((row, r) => row.map((v, c) => (inRange(r, c) ? "" : v))));

  const onKey = (e: React.KeyboardEvent) => {
    e.stopPropagation();
    if (editing) return;
    const mod = e.metaKey || e.ctrlKey;
    const moves: Record<string, [number, number]> = { ArrowUp: [-1, 0], ArrowDown: [1, 0], ArrowLeft: [0, -1], ArrowRight: [0, 1] };
    if (moves[e.key]) {
      e.preventDefault();
      const [dr, dc] = moves[e.key];
      const m = metas[cellKey(at.r, at.c)];
      const target = mod
        ? { r: dr ? (dr < 0 ? 0 : rows - 1) : sel.r, c: dc ? (dc < 0 ? 0 : cols - 1) : sel.c }
        : { r: (dr > 0 ? at.r + (m?.rs ?? 1) - 1 : sel.r) + dr, c: (dc > 0 ? at.c + (m?.cs ?? 1) - 1 : sel.c) + dc };
      select(target, e.shiftKey);
    } else if (e.key === "Tab") {
      e.preventDefault();
      const m = metas[cellKey(at.r, at.c)];
      select({ r: at.r, c: e.shiftKey ? at.c - 1 : at.c + (m?.cs ?? 1) });
    } else if (e.key === "Enter" || e.key === "F2") {
      e.preventDefault();
      setEditing({ text: grid[at.r][at.c], from: "cell" });
    } else if (e.key === "Delete" || e.key === "Backspace") {
      e.preventDefault();
      clearRange();
    } else if (mod && e.key.toLowerCase() === "a") {
      e.preventDefault();
      setAnchor({ r: 0, c: 0 });
      setSel({ r: rows - 1, c: cols - 1 });
    } else if (e.key.length === 1 && !mod && !e.altKey) {
      // Typing over a selected cell replaces it.
      e.preventDefault();
      setEditing({ text: e.key, from: "cell" });
    }
  };

  const onCopy = (e: React.ClipboardEvent, cut = false) => {
    if (editing) return;
    e.preventDefault();
    e.stopPropagation();
    e.clipboardData.setData("text/plain", toTsv(grid, r0, c0, r1, c1));
    // Shown values as a real table too, for pasting into Google Docs or Word.
    e.clipboardData.setData("text/html", rangeHtml(values.map((row) => row.map((v) => escapeHtml(display(v)))), metas, { r0, c0, r1, c1 }, widths));
    if (cut) clearRange();
  };
  const onPaste = (e: React.ClipboardEvent) => {
    if (editing) return;
    e.preventDefault();
    e.stopPropagation();
    // A table from Google Docs, Word or the web keeps its merges and colours; its text goes in as typed.
    const parsed = tableFromClipboard(e.clipboardData);
    if (parsed) {
      const block = parsed.cells.map((row) => row.map((v) => textOf(v)));
      ops.pasteTable(r0, c0, block, parsed.metas);
      setAnchor({ r: r0, c: c0 });
      setSel({ r: Math.min(MAX_ROWS - 1, r0 + block.length - 1), c: Math.min(MAX_COLS - 1, c0 + block[0].length - 1) });
      return;
    }
    const text = e.clipboardData.getData("text/plain");
    if (!text) return;
    const block = fromTsv(text);
    const next = pasteBlock(grid, r0, c0, block);
    reshape(next, colSizes, rowSizes);
    setAnchor({ r: r0, c: c0 });
    setSel({ r: Math.min(next.length - 1, r0 + block.length - 1), c: Math.min(next[0].length - 1, c0 + Math.max(...block.map((b) => b.length)) - 1) });
  };

  // What is selected, summed, as a spreadsheet shows along its bottom edge.
  const pickedNums: number[] = [];
  let filled = 0;
  for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) {
    const v = values[r][c];
    if (v !== "") filled++;
    if (typeof v === "number" && Number.isFinite(v)) pickedNums.push(v);
  }
  const many = r1 > r0 || c1 > c0;
  const sum = pickedNums.reduce((a, b) => a + b, 0);

  const raw = grid[at.r][at.c];
  const width = SHEET_GUTTER + widths.reduce((a, b) => a + b, 0);
  const sort = (c: number, desc: boolean) => {
    const header = window.confirm("Keep the first row in place as a header?");
    // Sorting moves rows, so merges and colours would land on the wrong cells: they go.
    reshape(sortRows(grid, c, desc, header), colSizes, rowSizes, {});
  };
  const cellRange = { r0, c0, r1, c1 };

  return (
    <div className="sheet" ref={host} tabIndex={0} onKeyDown={onKey}
      onCopy={(e) => onCopy(e)} onCut={(e) => onCopy(e, true)} onPaste={onPaste}>
      <div className="sheet-bar">
        <span className="sheet-ref">{many ? `${colName(c0)}${r0 + 1}:${colName(c1)}${r1 + 1}` : `${colName(at.c)}${at.r + 1}`}</span>
        <span className="sheet-fx">fx</span>
        <input
          aria-label="Formula bar"
          value={editing ? editing.text : raw}
          onFocus={() => !editing && setEditing({ text: raw, from: "bar" })}
          onChange={(e) => setEditing({ text: e.target.value, from: "bar" })}
          onBlur={() => editing?.from === "bar" && commit()}
          onKeyDown={(e) => {
            e.stopPropagation();
            if (e.key === "Enter") { e.preventDefault(); commit([1, 0]); }
            else if (e.key === "Tab") { e.preventDefault(); commit([0, e.shiftKey ? -1 : 1]); }
            else if (e.key === "Escape") { setEditing(null); host.current?.focus(); }
          }}
        />
      </div>
      <div className="tbl-scroll">
        <table style={{ width }}>
          <colgroup>
            <col style={{ width: SHEET_GUTTER }} />
            {widths.map((w, c) => <col key={c} style={{ width: w }} />)}
          </colgroup>
          <thead>
            <tr>
              <th className="sheet-corner" onClick={() => { setAnchor({ r: 0, c: 0 }); setSel({ r: rows - 1, c: cols - 1 }); host.current?.focus(); }} />
              {grid[0].map((_, c) => (
                <th key={c} className={c >= c0 && c <= c1 ? "on" : ""}
                  onClick={(e) => { setAnchor({ r: 0, c: e.shiftKey ? anchor.c : c }); setSel({ r: rows - 1, c }); host.current?.focus(); }}
                  onContextMenu={(e) => { e.preventDefault(); e.stopPropagation(); setMenu({ kind: "col", i: c, x: e.clientX, y: e.clientY }); }}>
                  {colName(c)}
                  <Grip axis="col" onPointerDown={startMove("col", c)} />
                  <span className="tbl-col-handle" onPointerDown={startResize("col", c)} onClick={(e) => e.stopPropagation()} aria-hidden />
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {grid.map((row, r) => (
              <tr key={r} style={{ height: heights[r] }}>
                <th className={r >= r0 && r <= r1 ? "on" : ""}
                  onClick={(e) => { setAnchor({ r: e.shiftKey ? anchor.r : r, c: 0 }); setSel({ r, c: cols - 1 }); host.current?.focus(); }}
                  onContextMenu={(e) => { e.preventDefault(); e.stopPropagation(); setMenu({ kind: "row", i: r, x: e.clientX, y: e.clientY }); }}>
                  {r + 1}
                  <Grip axis="row" onPointerDown={startMove("row", r)} />
                  <span className="tbl-row-handle" onPointerDown={startResize("row", r)} onClick={(e) => e.stopPropagation()} aria-hidden />
                </th>
                {row.map((cell, c) => {
                  if (covered.has(cellKey(r, c))) return null;
                  const m = metas[cellKey(r, c)];
                  const v = values[r][c];
                  const current = r === at.r && c === at.c;
                  const typing = current && editing?.from === "cell";
                  return (
                    <td
                      key={c}
                      rowSpan={m?.rs ?? 1}
                      colSpan={m?.cs ?? 1}
                      style={{ background: m?.bg, height: span(heights, r, m?.rs ?? 1) }}
                      className={[
                        typeof v === "number" ? "num" : "",
                        isError(v) ? "err" : "",
                        inRange(r, c) && many ? "in" : "",
                        current ? "cur" : "",
                      ].join(" ")}
                      title={cell.trim().startsWith("=") ? cell : undefined}
                      onPointerDown={(e) => {
                        if (typing || e.button !== 0) return;
                        if (editing) commit();
                        select({ r, c }, e.shiftKey);
                        setSelecting(true);
                        // Focus after the browser's own focus handling for this click.
                        requestAnimationFrame(() => host.current?.focus());
                      }}
                      onPointerEnter={() => selecting && select({ r, c }, true)}
                      onDoubleClick={() => setEditing({ text: cell, from: "cell" })}
                      onContextMenu={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        if (!inRange(r, c)) select({ r, c });
                        setMenu({ kind: "cell", i: 0, x: e.clientX, y: e.clientY });
                      }}
                    >
                      <span className="tbl-col-handle" onPointerDown={startResize("col", c + (m?.cs ?? 1) - 1)} aria-hidden />
                      <span className="tbl-row-handle" onPointerDown={startResize("row", r + (m?.rs ?? 1) - 1)} aria-hidden />
                      {typing ? (
                        <input
                          autoFocus
                          aria-label={`Cell ${colName(c)}${r + 1}`}
                          value={editing.text}
                          onChange={(e) => setEditing({ text: e.target.value, from: "cell" })}
                          onBlur={() => commit()}
                          onKeyDown={(e) => {
                            e.stopPropagation();
                            if (e.key === "Enter") { e.preventDefault(); commit([e.shiftKey ? -1 : 1, 0]); }
                            else if (e.key === "Tab") { e.preventDefault(); commit([0, e.shiftKey ? -1 : 1]); }
                            else if (e.key === "Escape") { setEditing(null); host.current?.focus(); }
                          }}
                        />
                      ) : (
                        <span className="sheet-val">{display(v)}</span>
                      )}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
        <MoveMark moving={moving} />
      </div>
      {many && filled > 0 && (
        <div className="sheet-status">
          {pickedNums.length > 0 && <span>Sum: {display(sum)}</span>}
          {pickedNums.length > 0 && <span>Average: {display(sum / pickedNums.length)}</span>}
          <span>Count: {filled}</span>
        </div>
      )}
      {menu && createPortal(
        <div className="wb-menu tbl-menu" role="menu" style={{ left: Math.min(menu.x, innerWidth - 220), top: Math.min(menu.y, innerHeight - 360) }}
          onPointerDown={(e) => e.stopPropagation()}>
          <LineItems
            range={
              menu.kind === "row" ? (menu.i >= r0 && menu.i <= r1 ? { r0, c0, r1, c1 } : { r0: menu.i, c0: 0, r1: menu.i, c1: 0 })
              : menu.kind === "col" ? (menu.i >= c0 && menu.i <= c1 ? { r0, c0, r1, c1 } : { r0: 0, c0: menu.i, r1: 0, c1: menu.i })
              : { r0, c0, r1, c1 }
            }
            ops={ops} close={() => setMenu(null)} rows={menu.kind !== "col"} cols={menu.kind !== "row"} sheet />
          {(menu.kind === "col" || menu.kind === "cell") && (
            <>
              <button role="menuitem" onClick={() => { sort(menu.kind === "col" ? menu.i : c0, false); setMenu(null); }}>Sort A → Z</button>
              <button role="menuitem" onClick={() => { sort(menu.kind === "col" ? menu.i : c0, true); setMenu(null); }}>Sort Z → A</button>
            </>
          )}
          {menu.kind === "cell" && (
            <>
              <button role="menuitem" onClick={() => { clearRange(); setMenu(null); }}>Clear</button>
              <CellMenuExtras range={cellRange} metas={metas} ops={ops} close={() => setMenu(null)} />
            </>
          )}
        </div>,
        document.body,
      )}
    </div>
  );
}

/** Close a menu on any press elsewhere or Escape. */
function useMenuClose(open: unknown, close: () => void) {
  useEffect(() => {
    if (!open) return;
    const esc = (e: KeyboardEvent) => e.key === "Escape" && close();
    window.addEventListener("pointerdown", close);
    window.addEventListener("keydown", esc);
    window.addEventListener("scroll", close, true);
    return () => {
      window.removeEventListener("pointerdown", close);
      window.removeEventListener("keydown", esc);
      window.removeEventListener("scroll", close, true);
    };
  });
}
