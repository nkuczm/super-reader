"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { BoxItem } from "@/lib/subjects";
import {
  colName, deleteCol, deleteRow, display, evaluate, fromTsv, insertAt, insertCol, insertRow, isError,
  MAX_COL, MAX_COLS, MAX_ROW, MAX_ROWS, MIN_COL, MIN_ROW, pasteBlock, removeAt, safeGrid, safeSizes, sortRows, toTsv,
  type Grid,
} from "@/lib/sheet";

type Change = Partial<BoxItem>;
type Sizes = (number | null)[];

/** Defaults per mode: a document table has room to write in, a sheet is compact. */
const DEFAULTS = { doc: { col: 160, row: 40 }, sheet: { col: 96, row: 26 } } as const;

/**
 * A table in one of two modes, switched from its tools:
 *
 *  - **Table**, like a table in Google Docs: no row numbers or column
 *    letters, each cell a place to write (Return is a new line, Tab the next
 *    cell), and cells keep the size they are dragged to — they never grow
 *    or shrink with what is typed.
 *  - **Sheet**: a spreadsheet, with a formula bar, selection by click, drag
 *    and arrow keys, copy and paste with other spreadsheets, sorting,
 *    inserting and deleting rows and columns, and a running sum of what is
 *    selected.
 */
export function TableBox({ box, onChange }: { box: BoxItem; onChange: (next: Change) => void }) {
  const mode = box.tableMode ?? "sheet";
  const grid = safeGrid(box.table);
  const rows = grid.length;
  const cols = grid[0].length;
  const colSizes = safeSizes(box.tableCols, cols, MIN_COL, MAX_COL);
  const rowSizes = safeSizes(box.tableRows, rows, MIN_ROW, MAX_ROW);
  const def = DEFAULTS[mode];
  const widths = colSizes.map((w) => w ?? def.col);
  const heights = rowSizes.map((h) => h ?? def.row);

  /** A size being dragged, shown live and saved on release. */
  const [drag, setDrag] = useState<{ axis: "col" | "row"; i: number; size: number } | null>(null);
  const shownW = widths.map((w, i) => (drag?.axis === "col" && drag.i === i ? drag.size : w));
  const shownH = heights.map((h, i) => (drag?.axis === "row" && drag.i === i ? drag.size : h));

  const startResize = (axis: "col" | "row", i: number) => (e: React.PointerEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const from = axis === "col" ? e.clientX : e.clientY;
    const base = axis === "col" ? widths[i] : heights[i];
    const [min, max] = axis === "col" ? [MIN_COL, MAX_COL] : [MIN_ROW, MAX_ROW];
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

  /** Grid and sizes changed together, so a moved row keeps its height. */
  const reshape = (next: Grid, nextCols: Sizes = colSizes, nextRows: Sizes = rowSizes) =>
    onChange({ table: next, tableCols: nextCols, tableRows: nextRows });

  const ops = {
    insertRow: (at: number) => rows < MAX_ROWS && reshape(insertRow(grid, at), colSizes, insertAt(rowSizes, at, null)),
    deleteRow: (at: number) => rows > 1 && reshape(deleteRow(grid, at), colSizes, removeAt(rowSizes, at)),
    insertCol: (at: number) => cols < MAX_COLS && reshape(insertCol(grid, at), insertAt(colSizes, at, null), rowSizes),
    deleteCol: (at: number) => cols > 1 && reshape(deleteCol(grid, at), removeAt(colSizes, at), rowSizes),
  };

  const props = { grid, widths: shownW, heights: shownH, startResize, onChange, ops, reshape, colSizes, rowSizes };
  return (
    <div className={`tbl tbl-${mode}`} onPointerDown={(e) => e.stopPropagation()}>
      {mode === "doc" ? <DocTable {...props} /> : <SheetTable {...props} />}
      <div className="sheet-tools">
        <span className="tbl-mode" role="group" aria-label="Table style">
          <button className={mode === "doc" ? "on" : ""} aria-pressed={mode === "doc"} onClick={() => onChange({ tableMode: "doc" })}
            title="A plain table you write in, like a table in a document">Table</button>
          <button className={mode === "sheet" ? "on" : ""} aria-pressed={mode === "sheet"} onClick={() => onChange({ tableMode: "sheet" })}
            title="A spreadsheet, with formulas">Sheet</button>
        </span>
        <button disabled={rows >= MAX_ROWS} onClick={() => ops.insertRow(rows)}>+ Row</button>
        <button disabled={cols >= MAX_COLS} onClick={() => ops.insertCol(cols)}>+ Column</button>
        <button disabled={rows <= 1} onClick={() => ops.deleteRow(rows - 1)}>− Row</button>
        <button disabled={cols <= 1} onClick={() => ops.deleteCol(cols - 1)}>− Column</button>
        {mode === "sheet" && <span className="sheet-hint">=SUM(A1:A5), =AVG(B:B)… · right-click a letter or number for more</span>}
      </div>
    </div>
  );
}

type Inner = {
  grid: Grid;
  widths: number[];
  heights: number[];
  startResize: (axis: "col" | "row", i: number) => (e: React.PointerEvent) => void;
  onChange: (next: Change) => void;
  ops: Record<"insertRow" | "deleteRow" | "insertCol" | "deleteCol", (at: number) => unknown>;
  reshape: (next: Grid, cols?: Sizes, rows?: Sizes) => void;
  colSizes: Sizes;
  rowSizes: Sizes;
};

/* ---------------------------------------------------------------------- */
/* Table: written in like a document                                       */
/* ---------------------------------------------------------------------- */

function DocTable({ grid, widths, heights, startResize, onChange, ops }: Inner) {
  const host = useRef<HTMLTableElement | null>(null);
  const save = (r: number, c: number, text: string) => {
    if (text === grid[r][c]) return;
    onChange({ table: grid.map((row, i) => (i === r ? row.map((v, j) => (j === c ? text.slice(0, 1000) : v)) : row)) });
  };
  const focusCell = (r: number, c: number) => host.current?.querySelector<HTMLTextAreaElement>(`textarea[data-cell="${r}-${c}"]`)?.focus();
  const [menu, setMenu] = useState<{ r: number; c: number; x: number; y: number } | null>(null);
  useMenuClose(menu, () => setMenu(null));
  const width = widths.reduce((a, b) => a + b, 0);

  return (
    <div className="tbl-scroll">
      <table ref={host} style={{ width }}>
        <colgroup>{widths.map((w, c) => <col key={c} style={{ width: w }} />)}</colgroup>
        <tbody>
          {grid.map((row, r) => (
            <tr key={r} style={{ height: heights[r] }}>
              {row.map((raw, c) => (
                <td key={c} style={{ height: heights[r] }}
                  onContextMenu={(e) => { e.preventDefault(); e.stopPropagation(); setMenu({ r, c, x: e.clientX, y: e.clientY }); }}>
                  <DocCell value={raw} id={`${r}-${c}`} onSave={(text) => save(r, c, text)}
                    onTab={(back) => {
                      const i = r * row.length + c + (back ? -1 : 1);
                      if (i < 0) return;
                      if (i >= grid.length * row.length) { ops.insertRow(grid.length); setTimeout(() => focusCell(grid.length, 0), 30); return; }
                      focusCell(Math.floor(i / row.length), i % row.length);
                    }} />
                  {r === 0 && <span className="tbl-col-handle" onPointerDown={startResize("col", c)} aria-hidden />}
                  {c === 0 && <span className="tbl-row-handle" onPointerDown={startResize("row", r)} aria-hidden />}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      {menu && createPortal(
        <div className="wb-menu tbl-menu" role="menu" style={{ left: menu.x, top: menu.y }} onPointerDown={(e) => e.stopPropagation()}>
          <button role="menuitem" onClick={() => { ops.insertRow(menu.r); setMenu(null); }}>Insert row above</button>
          <button role="menuitem" onClick={() => { ops.insertRow(menu.r + 1); setMenu(null); }}>Insert row below</button>
          <button role="menuitem" onClick={() => { ops.insertCol(menu.c); setMenu(null); }}>Insert column left</button>
          <button role="menuitem" onClick={() => { ops.insertCol(menu.c + 1); setMenu(null); }}>Insert column right</button>
          <button role="menuitem" onClick={() => { ops.deleteRow(menu.r); setMenu(null); }}>Delete row</button>
          <button role="menuitem" onClick={() => { ops.deleteCol(menu.c); setMenu(null); }}>Delete column</button>
        </div>,
        document.body,
      )}
    </div>
  );
}

/** One cell of a document table: plain writing, Return for a new line, saved when you leave it. */
function DocCell({ value, id, onSave, onTab }: { value: string; id: string; onSave: (text: string) => void; onTab: (back: boolean) => void }) {
  const [text, setText] = useState(value);
  const focused = useRef(false);
  useEffect(() => {
    if (!focused.current) setText(value);
  }, [value]);
  return (
    <textarea
      className="tbl-cell"
      data-cell={id}
      value={text}
      spellCheck
      onChange={(e) => setText(e.target.value)}
      onFocus={() => (focused.current = true)}
      onBlur={() => { focused.current = false; onSave(text); }}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === "Tab") { e.preventDefault(); onSave(text); onTab(e.shiftKey); }
      }}
    />
  );
}

/* ---------------------------------------------------------------------- */
/* Sheet: a spreadsheet                                                    */
/* ---------------------------------------------------------------------- */

type Pos = { r: number; c: number };

function SheetTable({ grid, widths, heights, startResize, onChange, ops, reshape, colSizes, rowSizes }: Inner) {
  const values = evaluate(grid);
  const rows = grid.length;
  const cols = grid[0].length;
  const [sel, setSel] = useState<Pos>({ r: 0, c: 0 });
  const [anchor, setAnchor] = useState<Pos>({ r: 0, c: 0 });
  const [editing, setEditing] = useState<{ text: string; from: "cell" | "bar" } | null>(null);
  const [menu, setMenu] = useState<{ kind: "row" | "col" | "cell"; i: number; x: number; y: number } | null>(null);
  const [selecting, setSelecting] = useState(false);
  const host = useRef<HTMLDivElement | null>(null);
  useMenuClose(menu, () => setMenu(null));

  const clampR = (r: number) => Math.min(rows - 1, Math.max(0, r));
  const clampC = (c: number) => Math.min(cols - 1, Math.max(0, c));
  const at = { r: clampR(sel.r), c: clampC(sel.c) };
  const r0 = Math.min(at.r, clampR(anchor.r));
  const r1 = Math.max(at.r, clampR(anchor.r));
  const c0 = Math.min(at.c, clampC(anchor.c));
  const c1 = Math.max(at.c, clampC(anchor.c));
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
    write(grid.map((row, i) => (i === r ? row.map((v, j) => (j === c ? text.slice(0, 1000) : v)) : row)));
  };
  const select = (p: Pos, extend = false) => {
    const next = { r: clampR(p.r), c: clampC(p.c) };
    setSel(next);
    if (!extend) setAnchor(next);
  };
  const commit = (move?: [number, number]) => {
    if (editing) setCell(at.r, at.c, editing.text);
    setEditing(null);
    if (move) select({ r: at.r + move[0], c: at.c + move[1] });
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
      // ⌘/Ctrl+arrow jumps to the edge, as in any spreadsheet.
      const target = mod
        ? { r: dr ? (dr < 0 ? 0 : rows - 1) : at.r, c: dc ? (dc < 0 ? 0 : cols - 1) : at.c }
        : { r: at.r + dr, c: at.c + dc };
      select(target, e.shiftKey);
    } else if (e.key === "Tab") {
      e.preventDefault();
      select({ r: at.r, c: at.c + (e.shiftKey ? -1 : 1) });
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
    const text = e.clipboardData.getData("text/plain");
    if (!text) return;
    const block = fromTsv(text);
    const next = pasteBlock(grid, r0, c0, block);
    reshape(next, safeSizes(colSizes, next[0].length, MIN_COL, MAX_COL), safeSizes(rowSizes, next.length, MIN_ROW, MAX_ROW));
    setAnchor({ r: r0, c: c0 });
    setSel({ r: Math.min(next.length - 1, r0 + block.length - 1), c: Math.min(next[0].length - 1, c0 + Math.max(...block.map((b) => b.length)) - 1) });
  };

  // What is selected, summed, as a spreadsheet shows along its bottom edge.
  const picked: number[] = [];
  let filled = 0;
  for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) {
    const v = values[r][c];
    if (v !== "") filled++;
    if (typeof v === "number" && Number.isFinite(v)) picked.push(v);
  }
  const many = r1 > r0 || c1 > c0;
  const sum = picked.reduce((a, b) => a + b, 0);

  const raw = grid[at.r][at.c];
  const width = 34 + widths.reduce((a, b) => a + b, 0);
  const sort = (c: number, desc: boolean) => {
    const header = window.confirm("Keep the first row in place as a header?");
    reshape(sortRows(grid, c, desc, header), colSizes, rowSizes);
  };

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
            <col style={{ width: 34 }} />
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
                  <span className="tbl-row-handle" onPointerDown={startResize("row", r)} onClick={(e) => e.stopPropagation()} aria-hidden />
                </th>
                {row.map((cell, c) => {
                  const v = values[r][c];
                  const current = r === at.r && c === at.c;
                  const typing = current && editing?.from === "cell";
                  return (
                    <td
                      key={c}
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
      </div>
      {many && filled > 0 && (
        <div className="sheet-status">
          {picked.length > 0 && <span>Sum: {display(sum)}</span>}
          {picked.length > 0 && <span>Average: {display(sum / picked.length)}</span>}
          <span>Count: {filled}</span>
        </div>
      )}
      {menu && createPortal(
        <div className="wb-menu tbl-menu" role="menu" style={{ left: menu.x, top: menu.y }} onPointerDown={(e) => e.stopPropagation()}>
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
            <button role="menuitem" onClick={() => { clearRange(); setMenu(null); }}>Clear</button>
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
