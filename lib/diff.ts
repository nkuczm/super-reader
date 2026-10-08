/**
 * What changed between two versions of a table, shown the way a document's
 * suggestions are: rows lined up, and within a changed cell the words taken
 * out and the words put in.
 */

export type Piece = { kind: "same" | "del" | "ins"; text: string };

/** Words, punctuation and the spaces between them, so a diff keeps the text as written and a comma is not a new word. */
const tokens = (s: string) => s.match(/\s+|[\p{L}\p{N}'’]+|[^\s\p{L}\p{N}]/gu) ?? [];

/**
 * The word-level difference from `a` to `b`, as it reads best: every change
 * shown as what was there, then what replaced it — never old and new words
 * shuffled together. See `readable()`.
 */
export function wordDiff(a: string, b: string): Piece[] {
  return readable(exactDiff(a, b));
}

/**
 * The exact word-level difference: a longest-common-subsequence over words,
 * with neighbouring pieces of the same kind joined. Long cells fall back to
 * the whole cell replaced, to keep it quick. Exact, which is what counting
 * words needs, but not how a change should be read: a rewritten phrase comes
 * out as "~~quick~~ slow brown ~~fox~~ dog", old and new words interleaved.
 */
function exactDiff(a: string, b: string): Piece[] {
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
  return out;
}

const wordsIn = (s: string) => s.match(/[\p{L}\p{N}][\p{L}\p{N}'’-]*/gu)?.length ?? 0;
/** Unchanged text this short, between two changes, reads as part of one change. */
const ABSORB_WORDS = 2;
/** A sentence this much rewritten reads better as the old sentence, then the new. */
const REWRITE_SHARE = 0.5;
/** …as does one changed in this many separate places. */
const REWRITE_PLACES = 3;

/** Joined: neighbours of one kind become one piece, empty pieces go. */
function joined(pieces: Piece[]): Piece[] {
  const out: Piece[] = [];
  for (const p of pieces) {
    if (!p.text) continue;
    const last = out[out.length - 1];
    if (last && last.kind === p.kind) last.text += p.text;
    else out.push({ ...p });
  }
  return out;
}

/** A sentence ends at . ! or ? (with any closing quote or bracket) and the space after it. */
function splitSentences(pieces: Piece[]): Piece[][] {
  const sentences: Piece[][] = [];
  let current: Piece[] = [];
  for (const p of pieces) {
    if (p.kind !== "same") {
      current.push(p);
      continue;
    }
    const ends = /[.!?]["”’)\]]*\s+/g;
    let from = 0;
    for (let m = ends.exec(p.text); m; m = ends.exec(p.text)) {
      const to = m.index + m[0].length;
      current.push({ kind: "same", text: p.text.slice(from, to) });
      sentences.push(current);
      current = [];
      from = to;
    }
    if (from < p.text.length) current.push({ kind: "same", text: p.text.slice(from) });
  }
  if (current.length) sentences.push(current);
  return sentences;
}

/**
 * One sentence's changes, each as one deletion followed by one insertion.
 * Unchanged text of a word or two between changes joins them — it goes into
 * both sides, so neither the old nor the new text changes — and a sentence
 * mostly rewritten, or changed all over, is shown whole: old, then new.
 */
function groupSentence(sentence: Piece[]): Piece[] {
  // A short unchanged run between two changes is part of the change.
  const marked = sentence.map((p, k) => {
    if (p.kind !== "same") return { ...p, absorbed: false };
    const before = sentence.slice(0, k).some((q) => q.kind !== "same");
    const after = sentence.slice(k + 1).some((q) => q.kind !== "same");
    const short = wordsIn(p.text) <= ABSORB_WORDS && p.text.length <= 24;
    return { ...p, absorbed: before && after && short && k > 0 && k < sentence.length - 1 };
  });

  const out: Piece[] = [];
  let del = "";
  let ins = "";
  let places = 0;
  const flush = () => {
    if (del || ins) places += 1;
    if (del) out.push({ kind: "del", text: del });
    if (ins) out.push({ kind: "ins", text: ins });
    del = "";
    ins = "";
  };
  for (const p of marked) {
    if (p.kind === "same" && !p.absorbed) {
      flush();
      out.push({ kind: "same", text: p.text });
    } else {
      if (p.kind !== "ins") del += p.text;
      if (p.kind !== "del") ins += p.text;
    }
  }
  flush();

  const was = sentence.filter((p) => p.kind !== "ins").map((p) => p.text).join("");
  const now = sentence.filter((p) => p.kind !== "del").map((p) => p.text).join("");
  const changed = sentence.reduce((n, p) => n + (p.kind === "same" ? 0 : wordsIn(p.text)), 0);
  const total = wordsIn(was) + wordsIn(now);
  const both = out.some((p) => p.kind === "del") && out.some((p) => p.kind === "ins");
  if (!both || total === 0 || (changed / total < REWRITE_SHARE && places < REWRITE_PLACES)) return out;

  // Rewritten: the whole sentence as it was, then as it is. Spacing around
  // it, which both versions share, stays unmarked.
  const lead = (s: string) => s.match(/^\s*/)![0];
  const trail = (s: string) => s.match(/\s*$/)![0];
  const head = lead(was) === lead(now) ? lead(was) : "";
  const tail = trail(was) === trail(now) ? trail(was) : "";
  const inner = (s: string) => s.slice(head.length, s.length - tail.length);
  return [
    { kind: "same", text: head },
    { kind: "del", text: inner(was) },
    { kind: "ins", text: inner(now) },
    { kind: "same", text: tail },
  ];
}

/**
 * A diff as a person reads one: within each sentence, every change is the
 * old words struck through and then the new ones, together, instead of the
 * two alternating word by word. The text is untouched — all but the
 * insertions is still the old text, and all but the deletions the new.
 */
export function readable(pieces: Piece[]): Piece[] {
  return joined(splitSentences(pieces).flatMap(groupSentence));
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
  const count = wordsIn;
  for (const pair of alignRows(a, b)) {
    if (pair.kind === "added") { rowsAdded++; added += b[pair.b].reduce((n, c) => n + count(c), 0); }
    else if (pair.kind === "removed") { rowsRemoved++; removed += a[pair.a].reduce((n, c) => n + count(c), 0); }
    else if (pair.kind === "changed") {
      const cols = Math.max(a[pair.a].length, b[pair.b].length);
      for (let c = 0; c < cols; c++) {
        for (const p of exactDiff(a[pair.a][c] ?? "", b[pair.b][c] ?? "")) {
          if (p.kind === "ins") added += count(p.text);
          if (p.kind === "del") removed += count(p.text);
        }
      }
    }
  }
  return { added, removed, rowsAdded, rowsRemoved };
}
