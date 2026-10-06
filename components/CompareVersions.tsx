"use client";

import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { textOf } from "@/lib/subjects";
import { safeGrid } from "@/lib/sheet";
import { alignRows, diffSummary, wordDiff, type Piece } from "@/lib/diff";

export type Version = { name: string; table: unknown };

/** A cell's words, whether it holds formatted text or plain. */
const cellText = (v: string) => (/[<&]/.test(v) ? textOf(v) : v).replace(/\s*\n\s*/g, " ").trim();

function Pieces({ pieces }: { pieces: Piece[] }) {
  return (
    <>
      {pieces.map((p, i) =>
        p.kind === "same" ? <span key={i}>{p.text}</span>
        : p.kind === "del" ? <del key={i} className="cmp-del">{p.text}</del>
        : <ins key={i} className="cmp-ins">{p.text}</ins>)}
    </>
  );
}

/**
 * Two versions of a table side by side: the earlier as it was, the later
 * marked up as suggestions are in a document — words taken out struck
 * through, words put in coloured, new rows and cells boxed, removed rows
 * struck through in place.
 */
export default function CompareVersions({ versions, from, to, onClose }: { versions: Version[]; from: number; to: number; onClose: () => void }) {
  const [a, setA] = useState(from);
  const [b, setB] = useState(to);
  useEffect(() => {
    const esc = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", esc);
    return () => window.removeEventListener("keydown", esc);
  }, [onClose]);

  const left = useMemo(() => safeGrid(versions[a]?.table).map((row) => row.map(cellText)), [versions, a]);
  const right = useMemo(() => safeGrid(versions[b]?.table).map((row) => row.map(cellText)), [versions, b]);
  const pairs = useMemo(() => alignRows(left, right), [left, right]);
  const summary = useMemo(() => diffSummary(left, right), [left, right]);
  const cols = Math.max(left[0]?.length ?? 1, right[0]?.length ?? 1);

  const picker = (value: number, set: (n: number) => void, label: string) => (
    <select className="input cmp-pick" aria-label={label} value={value} onChange={(e) => set(Number(e.target.value))}>
      {versions.map((v, i) => <option key={i} value={i}>{v.name}</option>)}
    </select>
  );

  return createPortal(
    <div className="overlay cmp-overlay" onMouseDown={onClose}>
      <div className="cmp-dialog" role="dialog" aria-modal="true" aria-label="Compare versions" onMouseDown={(e) => e.stopPropagation()}>
        <div className="cmp-head">
          <b>Compare</b>
          {picker(a, setA, "Earlier version")}
          <span className="cmp-arrow">→</span>
          {picker(b, setB, "Later version")}
          <span className="cmp-summary">
            {a === b ? "Pick two different versions" : (
              <>
                <span className="cmp-ins">+{summary.added} words</span>
                <span className="cmp-del">−{summary.removed} words</span>
                {summary.rowsAdded > 0 && <span>{summary.rowsAdded} row{summary.rowsAdded === 1 ? "" : "s"} added</span>}
                {summary.rowsRemoved > 0 && <span>{summary.rowsRemoved} row{summary.rowsRemoved === 1 ? "" : "s"} removed</span>}
              </>
            )}
          </span>
          <button className="dialog-close cmp-close" aria-label="Close" onClick={onClose}>×</button>
        </div>
        <div className="cmp-body">
          <section className="cmp-side">
            <h3>{versions[a]?.name}</h3>
            <table className="cmp-table">
              <tbody>
                {left.map((row, r) => (
                  <tr key={r}>{Array.from({ length: cols }, (_, c) => <td key={c}>{row[c] ?? ""}</td>)}</tr>
                ))}
              </tbody>
            </table>
          </section>
          <section className="cmp-side">
            <h3>{versions[b]?.name} <span className="cmp-sub">changes from {versions[a]?.name}</span></h3>
            <table className="cmp-table">
              <tbody>
                {pairs.map((pair, k) => {
                  if (pair.kind === "added") {
                    return <tr key={k} className="cmp-row-added">{Array.from({ length: cols }, (_, c) => <td key={c} className="cmp-cell-added"><ins className="cmp-ins">{right[pair.b][c] ?? ""}</ins></td>)}</tr>;
                  }
                  if (pair.kind === "removed") {
                    return <tr key={k} className="cmp-row-removed">{Array.from({ length: cols }, (_, c) => <td key={c} className="cmp-cell-removed"><del className="cmp-del">{left[pair.a][c] ?? ""}</del></td>)}</tr>;
                  }
                  return (
                    <tr key={k}>
                      {Array.from({ length: cols }, (_, c) => {
                        const was = left[pair.a][c];
                        const now = right[pair.b][c];
                        // A column that only one version has is a cell added (or removed) whole.
                        if (was === undefined) return <td key={c} className="cmp-cell-added"><ins className="cmp-ins">{now ?? ""}</ins></td>;
                        if (now === undefined) return <td key={c} className="cmp-cell-removed"><del className="cmp-del">{was}</del></td>;
                        if (!was && now) return <td key={c} className="cmp-cell-added"><ins className="cmp-ins">{now}</ins></td>;
                        return <td key={c}><Pieces pieces={wordDiff(was, now)} /></td>;
                      })}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </section>
        </div>
      </div>
    </div>,
    document.body,
  );
}
