/**
 * A small spreadsheet: the cells of a subject's table, and formulas over
 * them in the Google Sheets manner — `=SUM(A1:A5)`, `=B2*3`, `=AVG(B:B)`.
 *
 * Cells hold what was typed; values are worked out on display, so nothing
 * computed is ever stored or synced. A formula that cannot be worked out
 * shows an error code (#REF!, #NAME?, #DIV/0!, #CYCLE!) rather than a guess.
 */

export type Grid = string[][];
export type Value = number | string;

export const MAX_ROWS = 100;
export const MAX_COLS = 26;
const MAX_CELL = 10_000;

/** A table as stored: strings only, within bounds, rows of equal length. */
export function safeGrid(input: unknown): Grid {
  if (!Array.isArray(input)) return [["", ""], ["", ""]];
  const rows = input.slice(0, MAX_ROWS).map((row) =>
    (Array.isArray(row) ? row : []).slice(0, MAX_COLS).map((c) => (typeof c === "string" ? c.slice(0, MAX_CELL) : "")),
  );
  const width = Math.max(1, ...rows.map((r) => r.length));
  if (rows.length === 0) rows.push([]);
  return rows.map((r) => [...r, ...Array(width - r.length).fill("")]);
}

export function colName(c: number) {
  return String.fromCharCode(65 + c);
}

const ERRORS = ["#REF!", "#NAME?", "#DIV/0!", "#CYCLE!", "#VALUE!", "#ERROR!"];
export const isError = (v: Value) => typeof v === "string" && ERRORS.includes(v);

class SheetError extends Error {}

type Token = { t: "num" | "str" | "ref" | "name" | "op"; v: string };

function tokenize(src: string): Token[] {
  const out: Token[] = [];
  let i = 0;
  while (i < src.length) {
    const ch = src[i];
    if (/\s/.test(ch)) { i++; continue; }
    const rest = src.slice(i);
    let m: RegExpMatchArray | null;
    if ((m = rest.match(/^\d+(\.\d+)?|^\.\d+/))) out.push({ t: "num", v: m[0] });
    else if ((m = rest.match(/^"([^"]*)"/))) out.push({ t: "str", v: m[1] });
    else if (
      (m = rest.match(/^\$?[A-Za-z]{1,2}\$?\d+(?![A-Za-z0-9_(])/)) ||
      (m = rest.match(/^[A-Za-z]{1,2}(?=\s*:)/)) ||
      (out.at(-1)?.v === ":" && (m = rest.match(/^[A-Za-z]{1,2}(?![A-Za-z0-9_(])/)))
    )
      out.push({ t: "ref", v: m[0].replace(/\$/g, "").toUpperCase() });
    else if ((m = rest.match(/^[A-Za-z_][A-Za-z0-9_.]*/))) out.push({ t: "name", v: m[0].toUpperCase() });
    else if ((m = rest.match(/^(<=|>=|<>|[-+*/^(),:<>=&%])/))) out.push({ t: "op", v: m[0] });
    else throw new SheetError("#ERROR!");
    i += m![0].length;
  }
  return out;
}

/** "B3" → [row 2, col 1]; a bare column ("B") has no row. */
function parseRef(ref: string): { r: number | null; c: number } {
  const m = ref.match(/^([A-Z]{1,2})(\d*)$/);
  if (!m) throw new SheetError("#REF!");
  const c = m[1].length === 1 ? m[1].charCodeAt(0) - 65 : 26 + (m[1].charCodeAt(0) - 65) * 26 + m[1].charCodeAt(1) - 65;
  return { r: m[2] ? Number(m[2]) - 1 : null, c };
}

const num = (v: Value): number => {
  if (typeof v === "number") return v;
  if (isError(v)) throw new SheetError(v);
  if (v.trim() === "") return 0;
  const n = Number(v.replace(/[,$%]/g, ""));
  if (Number.isNaN(n)) throw new SheetError("#VALUE!");
  return v.trim().endsWith("%") ? n / 100 : n;
};

/** Numbers only, as Sheets does for SUM and friends: text and blanks are skipped. */
const numbers = (args: Value[][]) =>
  args.flat().flatMap((v) => {
    if (isError(v)) throw new SheetError(v as string);
    if (typeof v === "number") return [v];
    const t = v.trim().replace(/[,$]/g, "");
    if (t === "" || Number.isNaN(Number(t.replace(/%$/, "")))) return [];
    return [t.endsWith("%") ? Number(t.slice(0, -1)) / 100 : Number(t)];
  });

const median = (xs: number[]) => {
  if (xs.length === 0) throw new SheetError("#DIV/0!");
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
};
const mean = (xs: number[]) => {
  if (xs.length === 0) throw new SheetError("#DIV/0!");
  return xs.reduce((a, b) => a + b, 0) / xs.length;
};

const FUNCTIONS: Record<string, (args: Value[][]) => Value> = {
  SUM: (a) => numbers(a).reduce((x, y) => x + y, 0),
  AVERAGE: (a) => mean(numbers(a)),
  AVG: (a) => mean(numbers(a)),
  MEDIAN: (a) => median(numbers(a)),
  MIN: (a) => (numbers(a).length ? Math.min(...numbers(a)) : 0),
  MAX: (a) => (numbers(a).length ? Math.max(...numbers(a)) : 0),
  COUNT: (a) => numbers(a).length,
  COUNTA: (a) => a.flat().filter((v) => v !== "").length,
  PRODUCT: (a) => numbers(a).reduce((x, y) => x * y, 1),
  STDEV: (a) => {
    const xs = numbers(a);
    if (xs.length < 2) throw new SheetError("#DIV/0!");
    const m = mean(xs);
    return Math.sqrt(xs.reduce((s, x) => s + (x - m) ** 2, 0) / (xs.length - 1));
  },
  ROUND: (a) => {
    const [x, d = [0]] = a;
    const p = 10 ** num(d[0] ?? 0);
    return Math.round(num(x[0] ?? 0) * p) / p;
  },
  ABS: (a) => Math.abs(num(a[0]?.[0] ?? 0)),
  SQRT: (a) => {
    const x = num(a[0]?.[0] ?? 0);
    if (x < 0) throw new SheetError("#VALUE!");
    return Math.sqrt(x);
  },
  IF: (a) => (truthy(a[0]?.[0] ?? 0) ? (a[1]?.[0] ?? 1) : (a[2]?.[0] ?? 0)),
  CONCAT: (a) => a.flat().map(String).join(""),
};

const truthy = (v: Value) => (typeof v === "number" ? v !== 0 : v.toUpperCase() === "TRUE" || (v !== "" && v !== "0" && v.toUpperCase() !== "FALSE"));

/** Every value in the grid, formulas worked out. */
export function evaluate(grid: Grid): Value[][] {
  const memo = new Map<string, Value>();
  const visiting = new Set<string>();

  const cell = (r: number, c: number): Value => {
    if (r < 0 || c < 0 || r >= grid.length || c >= (grid[0]?.length ?? 0)) return "";
    const key = `${r},${c}`;
    if (memo.has(key)) return memo.get(key)!;
    if (visiting.has(key)) throw new SheetError("#CYCLE!");
    visiting.add(key);
    let value: Value;
    try {
      value = valueOf(grid[r][c] ?? "");
    } catch (error) {
      value = error instanceof SheetError ? error.message : "#ERROR!";
    }
    visiting.delete(key);
    memo.set(key, value);
    return value;
  };

  const valueOf = (raw: string): Value => {
    const text = raw.trim();
    if (!text.startsWith("=") || text.length === 1) {
      const n = Number(text.replace(/,/g, ""));
      return text !== "" && !Number.isNaN(n) ? n : raw;
    }
    const tokens = tokenize(text.slice(1));
    let i = 0;
    const peek = () => tokens[i];
    const take = (v?: string) => {
      const tok = tokens[i];
      if (!tok || (v !== undefined && tok.v !== v)) throw new SheetError("#ERROR!");
      i++;
      return tok;
    };

    const range = (a: string, b: string): Value[] => {
      const from = parseRef(a);
      const to = parseRef(b);
      const r0 = Math.min(from.r ?? 0, to.r ?? 0);
      const r1 = from.r === null || to.r === null ? grid.length - 1 : Math.max(from.r, to.r);
      const out: Value[] = [];
      for (let r = r0; r <= r1; r++)
        for (let c = Math.min(from.c, to.c); c <= Math.max(from.c, to.c); c++) out.push(cell(r, c));
      return out;
    };

    // Lowest precedence first: comparison, &, + -, * /, ^, unary, %.
    const comparison = (): Value => {
      let left = concat();
      while (peek()?.t === "op" && ["=", "<>", "<", ">", "<=", ">="].includes(peek().v)) {
        const op = take().v;
        const right = concat();
        const [a, b] = typeof left === "number" && typeof right === "number" ? [left, right] : [String(left), String(right)];
        const result = op === "=" ? a === b : op === "<>" ? a !== b : op === "<" ? a < b : op === ">" ? a > b : op === "<=" ? a <= b : a >= b;
        left = result ? 1 : 0;
      }
      return left;
    };
    const concat = (): Value => {
      let left = additive();
      while (peek()?.v === "&") {
        take();
        left = `${left}${additive()}`;
      }
      return left;
    };
    const additive = (): Value => {
      let left = term();
      while (peek()?.t === "op" && (peek().v === "+" || peek().v === "-")) {
        const op = take().v;
        const right = term();
        left = op === "+" ? num(left) + num(right) : num(left) - num(right);
      }
      return left;
    };
    const term = (): Value => {
      let left = power();
      while (peek()?.t === "op" && (peek().v === "*" || peek().v === "/")) {
        const op = take().v;
        const right = num(power());
        if (op === "/" && right === 0) throw new SheetError("#DIV/0!");
        left = op === "*" ? num(left) * right : num(left) / right;
      }
      return left;
    };
    const power = (): Value => {
      const base = unary();
      if (peek()?.v === "^") {
        take();
        return num(base) ** num(power());
      }
      return base;
    };
    const unary = (): Value => {
      if (peek()?.v === "-") { take(); return -num(unary()); }
      if (peek()?.v === "+") { take(); return num(unary()); }
      let v = primary();
      while (peek()?.v === "%") { take(); v = num(v) / 100; }
      return v;
    };
    /** One argument of a function: a range gives many values. */
    const argument = (): Value[] => {
      const tok = peek();
      if (tok?.t === "ref" && tokens[i + 1]?.v === ":") {
        take();
        take(":");
        return range(tok.v, take().v);
      }
      return [comparison()];
    };
    const primary = (): Value => {
      const tok = take();
      if (tok.t === "num") return Number(tok.v);
      if (tok.t === "str") return tok.v;
      if (tok.t === "ref") {
        if (peek()?.v === ":") throw new SheetError("#VALUE!");
        const { r, c } = parseRef(tok.v);
        if (r === null) throw new SheetError("#REF!");
        if (r >= grid.length || c >= (grid[0]?.length ?? 0)) throw new SheetError("#REF!");
        return cell(r, c);
      }
      if (tok.t === "name") {
        if (tok.v === "TRUE") return 1;
        if (tok.v === "FALSE") return 0;
        const fn = FUNCTIONS[tok.v];
        if (!fn) throw new SheetError("#NAME?");
        take("(");
        const args: Value[][] = [];
        if (peek()?.v !== ")") {
          args.push(argument());
          while (peek()?.v === ",") {
            take();
            args.push(argument());
          }
        }
        take(")");
        return fn(args);
      }
      if (tok.v === "(") {
        const v = comparison();
        take(")");
        return v;
      }
      throw new SheetError("#ERROR!");
    };

    const result = comparison();
    if (i !== tokens.length) throw new SheetError("#ERROR!");
    return result;
  };

  return grid.map((row, r) => row.map((_, c) => cell(r, c)));
}

/** A value as shown in its cell. */
export function display(v: Value): string {
  if (typeof v === "number") {
    if (!Number.isFinite(v)) return "#DIV/0!";
    return Number.isInteger(v) ? v.toLocaleString("en-US") : Number(v.toPrecision(10)).toLocaleString("en-US", { maximumFractionDigits: 6 });
  }
  return v;
}

/* ---------- editing a table's shape ---------- */

/** Column widths and row heights, in pixels, kept within reason. */
export const MIN_COL = 36;
export const MAX_COL = 800;
export const MIN_ROW = 20;
export const MAX_ROW = 600;
export function safeSizes(input: unknown, count: number, min: number, max: number): (number | null)[] {
  const list = Array.isArray(input) ? input : [];
  return Array.from({ length: count }, (_, i) => {
    const n = list[i];
    return typeof n === "number" && Number.isFinite(n) ? Math.round(Math.min(max, Math.max(min, n))) : null;
  });
}

/** An array with an item put in at `at` (sizes and rows alike). */
export function insertAt<T>(list: T[], at: number, item: T): T[] {
  return [...list.slice(0, at), item, ...list.slice(at)];
}
export function removeAt<T>(list: T[], at: number): T[] {
  return list.filter((_, i) => i !== at);
}

export function insertRow(grid: Grid, at: number): Grid {
  if (grid.length >= MAX_ROWS) return grid;
  return insertAt(grid, at, Array(grid[0]?.length ?? 1).fill(""));
}
export function deleteRow(grid: Grid, at: number): Grid {
  return grid.length <= 1 ? grid : removeAt(grid, at);
}
export function insertCol(grid: Grid, at: number): Grid {
  if ((grid[0]?.length ?? 0) >= MAX_COLS) return grid;
  return grid.map((row) => insertAt(row, at, ""));
}
export function deleteCol(grid: Grid, at: number): Grid {
  return (grid[0]?.length ?? 0) <= 1 ? grid : grid.map((row) => removeAt(row, at));
}

/**
 * Rows ordered by one column's shown value: numbers before text, numbers
 * by size, text alphabetically, blanks always last. The first row stays
 * put when `header` is set.
 */
export function sortRows(grid: Grid, col: number, descending = false, header = false): Grid {
  const values = evaluate(grid);
  const order = grid.map((_, i) => i).slice(header ? 1 : 0);
  const key = (i: number) => values[i][col];
  order.sort((a, b) => {
    const x = key(a);
    const y = key(b);
    const blankX = x === "";
    const blankY = y === "";
    if (blankX || blankY) return blankX === blankY ? a - b : blankX ? 1 : -1;
    let d: number;
    if (typeof x === "number" && typeof y === "number") d = x - y;
    else if (typeof x === "number") d = -1;
    else if (typeof y === "number") d = 1;
    else d = String(x).localeCompare(String(y), undefined, { numeric: true, sensitivity: "base" });
    return (descending ? -d : d) || a - b;
  });
  return [...(header ? [grid[0]] : []), ...order.map((i) => grid[i])];
}

/** A block of cells as tab-separated text, the way spreadsheets copy. */
export function toTsv(grid: Grid, r0: number, c0: number, r1: number, c1: number): string {
  const lines: string[] = [];
  for (let r = r0; r <= r1; r++) {
    const cells: string[] = [];
    for (let c = c0; c <= c1; c++) {
      const v = grid[r]?.[c] ?? "";
      cells.push(/[\t\n"]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
    }
    lines.push(cells.join("\t"));
  }
  return lines.join("\n");
}

/** Tab-separated text (from a spreadsheet, or a table copied anywhere) as rows of cells. */
export function fromTsv(text: string): string[][] {
  const src = text.replace(/\r\n?/g, "\n").replace(/\n$/, "");
  const rows: string[][] = [[]];
  let cell = "";
  let i = 0;
  let quoted = false;
  while (i < src.length) {
    const ch = src[i];
    if (quoted) {
      if (ch === '"' && src[i + 1] === '"') { cell += '"'; i += 2; continue; }
      if (ch === '"') { quoted = false; i++; continue; }
      cell += ch; i++; continue;
    }
    if (ch === '"' && cell === "") { quoted = true; i++; continue; }
    if (ch === "\t") { rows[rows.length - 1].push(cell); cell = ""; i++; continue; }
    if (ch === "\n") { rows[rows.length - 1].push(cell); rows.push([]); cell = ""; i++; continue; }
    cell += ch; i++;
  }
  rows[rows.length - 1].push(cell);
  return rows;
}

/** `block` written into `grid` at (r, c), growing the grid as needed within its limits. */
export function pasteBlock(grid: Grid, r: number, c: number, block: string[][]): Grid {
  const rows = Math.min(MAX_ROWS, Math.max(grid.length, r + block.length));
  const cols = Math.min(MAX_COLS, Math.max(grid[0]?.length ?? 1, c + Math.max(...block.map((b) => b.length))));
  const out: Grid = Array.from({ length: rows }, (_, i) => Array.from({ length: cols }, (_, j) => grid[i]?.[j] ?? ""));
  block.forEach((line, i) => line.forEach((v, j) => {
    if (r + i < rows && c + j < cols) out[r + i][c + j] = v.slice(0, MAX_CELL);
  }));
  return out;
}

/* ---------- cell colours and merged cells ---------- */

/** Per-cell extras, keyed "row,col": a background colour, and how many rows and columns a merged cell spans. */
export type CellMeta = { bg?: string; rs?: number; cs?: number };
export type CellMetas = Record<string, CellMeta>;
export const cellKey = (r: number, c: number) => `${r},${c}`;

const COLOR = /^#[0-9a-f]{6}$/i;

/** Cell extras as stored: real colours, spans that stay inside the grid and never overlap. */
export function safeMetas(input: unknown, rows: number, cols: number): CellMetas {
  const out: CellMetas = {};
  if (!input || typeof input !== "object") return out;
  const covered = new Set<string>();
  const entries = Object.entries(input as Record<string, unknown>)
    .map(([k, v]) => {
      const [r, c] = k.split(",").map(Number);
      return { r, c, v: (v && typeof v === "object" ? v : {}) as CellMeta };
    })
    .filter(({ r, c }) => Number.isInteger(r) && Number.isInteger(c) && r >= 0 && c >= 0 && r < rows && c < cols)
    .sort((a, b) => a.r - b.r || a.c - b.c);
  for (const { r, c, v } of entries) {
    if (covered.has(cellKey(r, c))) continue;
    const meta: CellMeta = {};
    if (typeof v.bg === "string" && COLOR.test(v.bg)) meta.bg = v.bg.toLowerCase();
    const rs = Math.min(rows - r, Math.max(1, Math.floor(Number(v.rs) || 1)));
    const cs = Math.min(cols - c, Math.max(1, Math.floor(Number(v.cs) || 1)));
    let clash = false;
    for (let i = r; i < r + rs; i++) for (let j = c; j < c + cs; j++) if ((i !== r || j !== c) && covered.has(cellKey(i, j))) clash = true;
    if (!clash && (rs > 1 || cs > 1)) {
      meta.rs = rs;
      meta.cs = cs;
      for (let i = r; i < r + rs; i++) for (let j = c; j < c + cs; j++) if (i !== r || j !== c) covered.add(cellKey(i, j));
    }
    if (Object.keys(meta).length) out[cellKey(r, c)] = meta;
  }
  return out;
}

/** The cells hidden under a merge, each pointing at the cell that covers it. */
export function coveredCells(metas: CellMetas): Map<string, string> {
  const out = new Map<string, string>();
  for (const [k, m] of Object.entries(metas)) {
    const [r, c] = k.split(",").map(Number);
    for (let i = r; i < r + (m.rs ?? 1); i++) for (let j = c; j < c + (m.cs ?? 1); j++) if (i !== r || j !== c) out.set(cellKey(i, j), k);
  }
  return out;
}

/**
 * Cell extras after rows (or columns) were inserted (`delta` > 0) or
 * deleted (`delta` < 0) at `at`: later cells move with their line, a merge
 * across the change grows or shrinks, and a deleted line's own extras go.
 */
export function shiftMetas(metas: CellMetas, axis: "row" | "col", at: number, delta: number): CellMetas {
  const out: CellMetas = {};
  for (const [k, m] of Object.entries(metas)) {
    let [r, c] = k.split(",").map(Number);
    const meta = { ...m };
    const pos = axis === "row" ? r : c;
    const span = (axis === "row" ? meta.rs : meta.cs) ?? 1;
    let nextPos = pos;
    let nextSpan = span;
    if (delta > 0) {
      if (pos >= at) nextPos = pos + delta;
      else if (pos + span > at) nextSpan = span + delta;
    } else {
      const n = -delta;
      const end = at + n;
      if (pos >= end) nextPos = pos - n;
      else if (pos >= at) {
        // Its anchor was deleted: what is left of the merge starts where the deletion did.
        const left = pos + span - end;
        if (left <= 0) continue;
        nextPos = at;
        nextSpan = left;
      } else if (pos + span > at) nextSpan = span - Math.min(n, pos + span - at);
    }
    if (axis === "row") { r = nextPos; meta.rs = nextSpan; } else { c = nextPos; meta.cs = nextSpan; }
    if (meta.rs === 1) delete meta.rs;
    if (meta.cs === 1) delete meta.cs;
    if (Object.keys(meta).length) out[cellKey(r, c)] = meta;
  }
  return out;
}

/** A rectangle merged into its top-left cell, swallowing any merges inside it. */
export function mergeRange(metas: CellMetas, r0: number, c0: number, r1: number, c1: number): CellMetas {
  const out: CellMetas = {};
  for (const [k, m] of Object.entries(metas)) {
    const [r, c] = k.split(",").map(Number);
    if (r >= r0 && r <= r1 && c >= c0 && c <= c1) {
      if (r === r0 && c === c0 && m.bg) out[k] = { bg: m.bg };
      continue;
    }
    out[k] = m;
  }
  if (r1 > r0 || c1 > c0) out[cellKey(r0, c0)] = { ...out[cellKey(r0, c0)], rs: r1 - r0 + 1, cs: c1 - c0 + 1 };
  return out;
}

/**
 * Line `from` (a row or a column) moved to sit at `to`, counted before the
 * move. Its cells, size and colours go with it; a merge that the move would
 * tear apart is undone rather than stretched over the wrong cells.
 */
export function moveLine<S>(grid: Grid, sizes: S[], metas: CellMetas, axis: "row" | "col", from: number, to: number) {
  const n = axis === "row" ? grid.length : grid[0].length;
  const order = Array.from({ length: n }, (_, i) => i);
  order.splice(from, 1);
  order.splice(Math.max(0, Math.min(n - 1, to)), 0, from);
  const where = new Map(order.map((old, i) => [old, i]));
  const nextGrid = axis === "row" ? order.map((i) => grid[i]) : grid.map((row) => order.map((i) => row[i]));
  const nextSizes = order.map((i) => sizes[i]);
  const nextMetas: CellMetas = {};
  for (const [k, m] of Object.entries(metas)) {
    const [r, c] = k.split(",").map(Number);
    const pos = axis === "row" ? r : c;
    const span = (axis === "row" ? m.rs : m.cs) ?? 1;
    const meta = { ...m };
    // A merge across lines survives only if its lines are still side by side, in order.
    if (span > 1) {
      const ok = Array.from({ length: span }, (_, i) => where.get(pos + i)!).every((p, i, all) => i === 0 || p === all[i - 1] + 1);
      if (!ok) { delete meta.rs; delete meta.cs; }
    }
    const np = where.get(pos)!;
    const key = axis === "row" ? cellKey(np, c) : cellKey(r, np);
    if (Object.keys(meta).length) nextMetas[key] = meta;
  }
  return { grid: nextGrid, sizes: nextSizes, metas: nextMetas };
}
