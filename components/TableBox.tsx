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
export function TableBox({ box, onChange }: { box: BoxItem; onChange: (next: Change) => void }) {
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
    const base = axis === "col" ? widths[i] : heights[i];
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
    insertRow: (at) => rows < MAX_ROWS && reshape(insertRow(grid, at), colSizes, insertAt(rowSizes, at, null), shiftMetas(metas, "row", at, 1)),
    deleteRow: (at) => rows > 1 && reshape(deleteRow(grid, at), colSizes, removeAt(rowSizes, at), shiftMetas(metas, "row", at, -1)),
    insertCol: (at) => cols < MAX_COLS && reshape(insertCol(grid, at), insertAt(colSizes, at, null), rowSizes, shiftMetas(metas, "col", at, 1)),
    deleteCol: (at) => cols > 1 && reshape(deleteCol(grid, at), removeAt(colSizes, at), rowSizes, shiftMetas(metas, "col", at, -1)),
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

  const props: Inner = { grid, metas, widths: shownW, heights: shownH, startResize, startMove, moving, onChange, ops, reshape, colSizes, rowSizes };
  return (
    <div className={`tbl tbl-${mode}`} onPointerDown={(e) => e.stopPropagation()}>
      {mode === "doc" ? <DocTable {...props} /> : <SheetTable {...props} />}
      <div className="sheet-tools">
        <span className="tbl-mode" role="group" aria-label="Table style">
          <button className={mode === "doc" ? "on" : ""} aria-pressed={mode === "doc"} onClick={() => switchTo("doc")}
            title="A plain table you write in, like a table in a document">Table</button>
          <button className={mode === "sheet" ? "on" : ""} aria-pressed={mode === "sheet"} onClick={() => switchTo("sheet")}
            title="A spreadsheet, with formulas">Sheet</button>
        </span>
        <button disabled={rows >= MAX_ROWS} onClick={() => ops.insertRow(rows)}>+ Row</button>
        <button disabled={cols >= MAX_COLS} onClick={() => ops.insertCol(cols)}>+ Column</button>
        <button disabled={rows <= 1} onClick={() => ops.deleteRow(rows - 1)}>− Row</button>
        <button disabled={cols <= 1} onClick={() => ops.deleteCol(cols - 1)}>− Column</button>
        <span className="sheet-hint">
          {mode === "sheet" ? "=SUM(A1:A5), =AVG(B:B)… · " : "Shift-click to pick cells · "}right-click for colour, merge and more
        </span>
      </div>
    </div>
  );
}

type Ops = {
  insertRow: (at: number) => unknown;
  deleteRow: (at: number) => unknown;
  insertCol: (at: number) => unknown;
  deleteCol: (at: number) => unknown;
  merge: (g: Range) => void;
  unmerge: (r: number, c: number) => void;
  color: (g: Range, bg: string | null) => void;
  pasteTable: (r: number, c: number, block: string[][], metas: CellMetas) => void;
};

type Inner = {
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

function DocTable({ grid, metas, widths, heights, startResize, startMove, moving, onChange, ops }: Inner) {
  const host = useRef<HTMLTableElement | null>(null);
  const rows = grid.length;
  const cols = grid[0].length;
  const covered = coveredCells(metas);
  const [focus, setFocus] = useState<{ r: number; c: number }>({ r: 0, c: 0 });
  /** Cells picked with Shift-click, for merging or colouring together. */
  const [picked, setPicked] = useState<Range | null>(null);
  const [menu, setMenu] = useState<{ range: Range; x: number; y: number } | null>(null);
  useMenuClose(menu, () => setMenu(null));

  const save = (r: number, c: number, html: string) => {
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
    <div className="tbl-scroll"
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
                    onFocusCapture={() => setFocus({ r, c })}
                    // Capture: the text inside keeps its own presses to itself.
                    onPointerDownCapture={(e) => {
                      if (e.shiftKey) {
                        e.preventDefault();
                        const a = { r: Math.min(focus.r, r), c: Math.min(focus.c, c) };
                        const b = { r: Math.max(focus.r, r + rs - 1), c: Math.max(focus.c, c + cs - 1) };
                        setPicked({ r0: a.r, c0: a.c, r1: b.r, c1: b.c });
                      } else if (e.button === 0) setPicked(null);
                    }}
                    onContextMenu={(e) => {
                      if (window.getSelection()?.toString()) return; // keep the browser's menu for copying text
                      e.preventDefault();
                      e.stopPropagation();
                      const range = picked && inPicked(r, c) ? picked : { r0: r, c0: c, r1: r + rs - 1, c1: c + cs - 1 };
                      setMenu({ range, x: e.clientX, y: e.clientY });
                    }}>
                    {/* A fixed box: a table row would otherwise stretch to whatever is written in it. */}
                    <div className="tbl-cell-box" style={{ height: span(heights, r, rs) - 1 }}>
                    <RichText className="tbl-rich" html={asHtml(html)} onChange={(next) => save(r, c, next)}
                      onTab={(back) => {
                        const next = step(r, c, back);
                        if (!next) return;
                        if (next === "end") { ops.insertRow(rows); setTimeout(() => focusCell(rows, 0), 60); return; }
                        focusCell(next.r, next.c);
                      }} />
                    </div>
                    {r === 0 && <span className="tbl-col-handle" style={{ right: -3 }} onPointerDown={startResize("col", c + cs - 1)} aria-hidden />}
                    {c === 0 && <span className="tbl-row-handle" onPointerDown={startResize("row", r + rs - 1)} aria-hidden />}
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
          <button role="menuitem" onClick={() => { ops.insertRow(menu.range.r0); setMenu(null); }}>Insert row above</button>
          <button role="menuitem" onClick={() => { ops.insertRow(menu.range.r1 + 1); setMenu(null); }}>Insert row below</button>
          <button role="menuitem" onClick={() => { ops.insertCol(menu.range.c0); setMenu(null); }}>Insert column left</button>
          <button role="menuitem" onClick={() => { ops.insertCol(menu.range.c1 + 1); setMenu(null); }}>Insert column right</button>
          <button role="menuitem" onClick={() => { ops.deleteRow(menu.range.r0); setMenu(null); }}>Delete row</button>
          <button role="menuitem" onClick={() => { ops.deleteCol(menu.range.c0); setMenu(null); }}>Delete column</button>
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
          {(menu.kind === "row" || menu.kind === "cell") && (
            <>
              <button role="menuitem" onClick={() => { ops.insertRow(menu.kind === "row" ? menu.i : r0); setMenu(null); }}>Insert row above</button>
              <button role="menuitem" onClick={() => { ops.insertRow((menu.kind === "row" ? menu.i : r1) + 1); setMenu(null); }}>Insert row below</button>
              <button role="menuitem" onClick={() => { ops.deleteRow(menu.kind === "row" ? menu.i : r0); setMenu(null); }}>Delete row {(menu.kind === "row" ? menu.i : r0) + 1}</button>
            </>
          )}
          {(menu.kind === "col" || menu.kind === "cell") && (
            <>
              <button role="menuitem" onClick={() => { ops.insertCol(menu.kind === "col" ? menu.i : c0); setMenu(null); }}>Insert column left</button>
              <button role="menuitem" onClick={() => { ops.insertCol((menu.kind === "col" ? menu.i : c1) + 1); setMenu(null); }}>Insert column right</button>
              <button role="menuitem" onClick={() => { ops.deleteCol(menu.kind === "col" ? menu.i : c0); setMenu(null); }}>Delete column {colName(menu.kind === "col" ? menu.i : c0)}</button>
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
