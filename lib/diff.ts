/**
 * What changed between two versions of a table, shown the way a document's
 * suggestions are: rows lined up, and within a changed cell the words taken
 * out and the words put in.
 */

export type Piece = { kind: "same" | "del" | "ins"; text: string };

/** Words, punctuation and the spaces between them, so a diff keeps the text as written and a comma is not a new word. */
const tokens = (s: string) => s.match(/\s+|[\p{L}\p{N}'’]+|[^\s\p{L}\p{N}]/gu) ?? [];

/**
 * The word-level difference from `a` to `b`: a longest-common-subsequence
 * over words, with neighbouring pieces of the same kind joined. Long cells
 * fall back to the whole cell replaced, to keep it quick.
 */
export function wordDiff(a: string, b: string): Piece[] {
  if (a === b) return a ? [{ kind: "same", text: a }] : [];
  const x = tokens(a);
  const y = tokens(b);
  if (x.length * y.length > 400_000) return [...(a ? [{ kind: "del" as const, text: a }] : []), ...(b ? [{ kind: "ins" as const, text: b }] : [])];
  const n = x.length;
  const m = y.length;
  const lcs: Uint32Array[] = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) lcs[i][j] = x[i] === y[j] ? lcs[i + 1][j + 1] + 1 : Math.max(lcs[i + 1][j], lcs[i][j + 1]);
  }
  const out: Piece[] = [];
  const push = (kind: Piece["kind"], text: string) => {
    const last = out[out.length - 1];
    if (last && last.kind === kind) last.text += text;
    else out.push({ kind, text });
  };
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (x[i] === y[j]) { push("same", x[i]); i++; j++; }
    else if (lcs[i + 1][j] >= lcs[i][j + 1]) push("del", x[i++]);
    else push("ins", y[j++]);
  }
  while (i < n) push("del", x[i++]);
  while (j < m) push("ins", y[j++]);
  // A space between a deletion and an insertion reads better inside the change than as unchanged text.
  return out;
}

export type RowPair =
  | { kind: "same" | "changed"; a: number; b: number }
  | { kind: "added"; b: number }
  | { kind: "removed"; a: number };

const norm = (row: string[]) => row.map((c) => c.replace(/\s+/g, " ").trim()).join("\u0001");

/**
 * The rows of two versions lined up: identical rows are anchors, matched in
 * order; between anchors, rows are paired up in order as edits of each
 * other, and any left over were added or removed.
 */
export function alignRows(a: string[][], b: string[][]): RowPair[] {
  const x = a.map(norm);
  const y = b.map(norm);
  const n = x.length;
  const m = y.length;
  const lcs: Uint32Array[] = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) lcs[i][j] = x[i] === y[j] ? lcs[i + 1][j + 1] + 1 : Math.max(lcs[i + 1][j], lcs[i][j + 1]);
  }
  const anchors: [number, number][] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (x[i] === y[j]) { anchors.push([i, j]); i++; j++; }
    else if (lcs[i + 1][j] >= lcs[i][j + 1]) i++;
    else j++;
  }
  anchors.push([n, m]);
  const out: RowPair[] = [];
  let pi = 0;
  let pj = 0;
  for (const [ai, bj] of anchors) {
    const gone = ai - pi;
    const come = bj - pj;
    const paired = Math.min(gone, come);
    for (let k = 0; k < paired; k++) out.push({ kind: "changed", a: pi + k, b: pj + k });
    for (let k = paired; k < gone; k++) out.push({ kind: "removed", a: pi + k });
    for (let k = paired; k < come; k++) out.push({ kind: "added", b: pj + k });
    if (ai < n && bj < m) out.push({ kind: "same", a: ai, b: bj });
    pi = ai + 1;
    pj = bj + 1;
  }
  return out;
}

/** How much changed, in words and rows, for the summary line. */
export function diffSummary(a: string[][], b: string[][]) {
  let added = 0;
  let removed = 0;
  let rowsAdded = 0;
  let rowsRemoved = 0;
  const count = (s: string) => s.match(/[\p{L}\p{N}][\p{L}\p{N}'’-]*/gu)?.length ?? 0;
  for (const pair of alignRows(a, b)) {
    if (pair.kind === "added") { rowsAdded++; added += b[pair.b].reduce((n, c) => n + count(c), 0); }
    else if (pair.kind === "removed") { rowsRemoved++; removed += a[pair.a].reduce((n, c) => n + count(c), 0); }
    else if (pair.kind === "changed") {
      const cols = Math.max(a[pair.a].length, b[pair.b].length);
      for (let c = 0; c < cols; c++) {
        for (const p of wordDiff(a[pair.a][c] ?? "", b[pair.b][c] ?? "")) {
          if (p.kind === "ins") added += count(p.text);
          if (p.kind === "del") removed += count(p.text);
        }
      }
    }
  }
  return { added, removed, rowsAdded, rowsRemoved };
}
