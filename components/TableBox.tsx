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
};

export function TableBox({ box, onChange: apply, media }: { box: BoxItem; onChange: (next: Change) => void; media?: CellMedia }) {
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

  const props: Inner = { media, grid, metas, widths: shownW, heights: shownH, startResize, startMove, moving, onChange, ops, reshape, colSizes, rowSizes };
  return (
    <div ref={shell} tabIndex={-1} className={`tbl tbl-${mode}`} onPointerDown={(e) => e.stopPropagation()} onKeyDownCapture={onUndoKey}>
      {mode === "doc" ? <DocTable {...props} /> : <SheetTable {...props} />}
      <div className="sheet-tools">
        <span className="tbl-mode" role="group" aria-label="Table style">
          <button className={mode === "doc" ? "on" : ""} aria-pressed={mode === "doc"} onClick={() => switchTo("doc")}
            title="A plain table you write in, like a table in a document">Table</button>
          <button className={mode === "sheet" ? "on" : ""} aria-pressed={mode === "sheet"} onClick={() => switchTo("sheet")}
            title="A spreadsheet, with formulas">Sheet</button>
        </span>
        <button className="tbl-undo" disabled={!past.current.length} onMouseDown={(e) => e.preventDefault()} onClick={() => travel(true)}
          title="Undo (⌘Z)" aria-label="Undo">↶</button>
        <button className="tbl-undo" disabled={!future.current.length} onMouseDown={(e) => e.preventDefault()} onClick={() => travel(false)}
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

function DocTable({ media, grid, metas, widths, heights, startResize, startMove, moving, onChange, ops }: Inner) {
  const host = useRef<HTMLTableElement | null>(null);
  const rows = grid.length;
  const cols = grid[0].length;
  const covered = coveredCells(metas);
  const [focus, setFocus] = useState<{ r: number; c: number }>({ r: 0, c: 0 });
  /** Cells picked with Shift-click, for merging or colouring together. */
  const [picked, setPicked] = useState<Range | null>(null);
  const [menu, setMenu] = useState<{ range: Range; x: number; y: number } | null>(null);
  useMenuClose(menu, () => setMenu(null));

  /** While one command runs over several cells, their own saves wait for the one save of them all. */
  const batching = useRef(false);
  const dragFrom = useRef<{ r: number; c: number } | null>(null);
  const many = !!picked && (picked.r1 > picked.r0 || picked.c1 > picked.c0);
  useEffect(() => {
    const up = () => (dragFrom.current = null);
    window.addEventListener("pointerup", up);
    return () => window.removeEventListener("pointerup", up);
  }, []);
  const pickedCells = () => {
    const out: { r: number; c: number; el: HTMLElement }[] = [];
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
    if (!many) return false;
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
  const clearPicked = () => saveCells(pickedCells().map(({ r, c }) => ({ r, c, html: "" })));
  const copyPicked = (e: React.ClipboardEvent, cut: boolean) => {
    if (!many || !picked) return;
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

  return (
    <div className={`tbl-scroll${many ? " picking" : ""}`}
      onCopyCapture={(e) => copyPicked(e, false)}
      onCutCapture={(e) => copyPicked(e, true)}
      onKeyDownCapture={(e) => {
        if (!many) return;
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
                    // Dragging from one cell into another selects whole cells, as in Google Docs.
                    onPointerEnter={(e) => {
                      const from = dragFrom.current;
                      if (!from || !(e.buttons & 1) || (from.r === r && from.c === c)) return;
                      window.getSelection()?.removeAllRanges();
                      setPicked({ r0: Math.min(from.r, r), c0: Math.min(from.c, c), r1: Math.max(from.r, r + rs - 1), c1: Math.max(from.c, c + cs - 1) });
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
                      onDropImage={media?.dropImage} resolveEmbed={media?.resolveEmbed}
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
