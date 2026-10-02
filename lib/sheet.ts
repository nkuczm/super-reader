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
const MAX_CELL = 1000;

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
