"use client";

import { useRef, useState } from "react";
import { DEFAULT_DRAWING_HEIGHT, DRAWING_WIDTH, safeImage, safeStrokes, type BoxItem, type Stroke } from "@/lib/subjects";
import { EMBED_TYPE } from "./RichText";
import { colName, display, evaluate, isError, MAX_COLS, MAX_ROWS, safeGrid, type Grid } from "@/lib/sheet";

const COLORS = ["#111111", "#2563eb", "#dc2626", "#16a34a", "#f59e0b"];
const PEN_SIZES = [2, 5];
export const DRAWING_HEIGHT = DEFAULT_DRAWING_HEIGHT;

/** A handle to drag a drawing or picture into a text box's text. */
function EmbedGrip({ id }: { id: string }) {
  return (
    <span
      className="embed-grip"
      draggable
      title="Drag into a text box to set it in the text — then drag its corner to size it"
      onPointerDown={(e) => e.stopPropagation()}
      onDragStart={(event) => {
        event.dataTransfer.setData(EMBED_TYPE, id);
        event.dataTransfer.effectAllowed = "move";
      }}
    >
      ⠿
    </span>
  );
}

/** Every number pair in a stroke's path, for the eraser to test against. */
function pointsOf(d: string): [number, number][] {
  const nums = d.match(/-?\d+(\.\d+)?/g)?.map(Number) ?? [];
  const out: [number, number][] = [];
  for (let i = 0; i + 1 < nums.length; i += 2) out.push([nums[i], nums[i + 1]]);
  return out;
}

/**
 * A drawing pad: strokes in a fixed 600-wide space so a sketch keeps its
 * shape at any width, on any device. Saved when each stroke ends. ⌘Z and
 * ⌘⇧Z undo and redo while the pad is in use; the tools show only then too.
 */
export function DrawingPad({ box, onChange }: { box: BoxItem; onChange: (next: Partial<BoxItem>) => void }) {
  const strokes = safeStrokes(box.drawing);
  const height = Math.min(1200, Math.max(80, Number(box.height) || DRAWING_HEIGHT));
  const [color, setColor] = useState(COLORS[0]);
  const [size, setSize] = useState(PEN_SIZES[0]);
  const [erasing, setErasing] = useState(false);
  const [live, setLive] = useState<string | null>(null);
  const svg = useRef<SVGSVGElement | null>(null);
  const path = useRef<string[]>([]);
  /** Undo and redo, as whole stroke lists, for this visit. */
  const past = useRef<Stroke[][]>([]);
  const future = useRef<Stroke[][]>([]);
  /** Strokes as they stand mid-erase, before the change is saved. */
  const erased = useRef<Stroke[] | null>(null);
  const [, redraw] = useState(0);

  const commit = (next: Stroke[]) => {
    past.current.push(strokes);
    future.current = [];
    onChange({ drawing: next });
  };

  const toPoint = (event: React.PointerEvent): [number, number] => {
    const rect = svg.current!.getBoundingClientRect();
    const scale = DRAWING_WIDTH / rect.width;
    return [
      Math.round((event.clientX - rect.left) * scale * 10) / 10,
      Math.round((event.clientY - rect.top) * scale * 10) / 10,
    ];
  };

  const eraseAt = (x: number, y: number) => {
    const current = erased.current ?? strokes;
    const r = 10;
    const kept = current.filter(
      (s) => !pointsOf(s.d).some(([px, py]) => (px - x) ** 2 + (py - y) ** 2 <= (r + s.w) ** 2),
    );
    if (kept.length !== current.length) {
      erased.current = kept;
      redraw((n) => n + 1);
    }
  };

  const finish = () => {
    if (erasing) {
      if (erased.current && erased.current.length !== strokes.length) commit(erased.current);
      erased.current = null;
      path.current = [];
      return;
    }
    if (path.current.length === 0) return;
    // A single tap still leaves a dot.
    const parts = path.current.length === 1 ? [path.current[0], path.current[0]] : path.current;
    const d = `M ${parts[0]} ${parts.slice(1).map((p) => `L ${p}`).join(" ")}`;
    path.current = [];
    setLive(null);
    commit([...strokes, { d, color, w: size }]);
  };

  const shown = erased.current ?? strokes;

  return (
    <div
      className="drawing"
      tabIndex={0}
      onKeyDown={(event) => {
        if (!(event.metaKey || event.ctrlKey)) return;
        const key = event.key.toLowerCase();
        const redo = (key === "z" && event.shiftKey) || key === "y";
        if (key !== "z" && key !== "y") return;
        event.preventDefault();
        event.stopPropagation();
        if (redo) {
          const next = future.current.pop();
          if (!next) return;
          past.current.push(strokes);
          onChange({ drawing: next });
        } else {
          const prev = past.current.pop();
          if (!prev) return;
          future.current.push(strokes);
          onChange({ drawing: prev });
        }
      }}
    >
      <div className="drawing-tools" onPointerDown={(e) => e.stopPropagation()}>
        <EmbedGrip id={box.id} />
        {COLORS.map((c) => (
          <button key={c} className={`drawing-color${c === color && !erasing ? " on" : ""}`} style={{ background: c }}
            aria-label={`Pen colour ${c}`} onClick={() => { setColor(c); setErasing(false); }} />
        ))}
        {PEN_SIZES.map((w) => (
          <button key={w} className={`drawing-size${w === size && !erasing ? " on" : ""}`} aria-label={`Pen size ${w}`}
            onClick={() => { setSize(w); setErasing(false); }}>
            <span style={{ width: w + 2, height: w + 2 }} />
          </button>
        ))}
        <button className={`drawing-eraser${erasing ? " on" : ""}`} aria-pressed={erasing} title="Eraser — drag over a line to remove it"
          onClick={() => setErasing((e) => !e)}>
          <svg viewBox="0 0 24 24" width="15" height="15" aria-hidden="true">
            <path d="M16 3l5 5-10 10H6l-3-3z M9 9l6 6" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
          </svg>
        </button>
      </div>
      <div className="drawing-frame">
        <svg
          ref={svg}
          className={`drawing-canvas${erasing ? " erasing" : ""}`}
          viewBox={`0 0 ${DRAWING_WIDTH} ${height}`}
          onPointerDown={(event) => {
            event.stopPropagation();
            event.preventDefault();
            (event.currentTarget.parentElement?.parentElement as HTMLElement | null)?.focus({ preventScroll: true });
            (event.target as Element).setPointerCapture?.(event.pointerId);
            const [x, y] = toPoint(event);
            if (erasing) {
              path.current = ["e"];
              eraseAt(x, y);
              return;
            }
            path.current = [`${x} ${y}`];
            setLive(`M ${path.current[0]}`);
          }}
          onPointerMove={(event) => {
            if (path.current.length === 0) return;
            const [x, y] = toPoint(event);
            if (erasing) return eraseAt(x, y);
            path.current.push(`${x} ${y}`);
            setLive(`M ${path.current[0]} ${path.current.slice(1).map((p) => `L ${p}`).join(" ")}`);
          }}
          onPointerUp={finish}
          onPointerCancel={finish}
        >
          {shown.map((s, i) => (
            <path key={i} d={s.d} stroke={s.color} strokeWidth={s.w} fill="none" strokeLinecap="round" strokeLinejoin="round" />
          ))}
          {live && <path d={live} stroke={color} strokeWidth={size} fill="none" strokeLinecap="round" strokeLinejoin="round" />}
        </svg>
        <span
          className="drawing-pin"
          role="separator"
          aria-label="Drag to make the drawing taller or shorter"
          title="Drag to resize"
          onPointerDown={(event) => {
            event.stopPropagation();
            event.preventDefault();
            const rect = svg.current!.getBoundingClientRect();
            const scale = DRAWING_WIDTH / rect.width;
            const startY = event.clientY;
            const startH = height;
            const target = event.currentTarget;
            target.setPointerCapture(event.pointerId);
            let next = startH;
            const move = (e: PointerEvent) => {
              next = Math.round(Math.min(1200, Math.max(80, startH + (e.clientY - startY) * scale)));
              svg.current?.setAttribute("viewBox", `0 0 ${DRAWING_WIDTH} ${next}`);
            };
            const up = () => {
              target.removeEventListener("pointermove", move);
              target.removeEventListener("pointerup", up);
              target.removeEventListener("pointercancel", up);
              if (next !== startH) onChange({ height: next });
            };
            target.addEventListener("pointermove", move);
            target.addEventListener("pointerup", up);
            target.addEventListener("pointercancel", up);
          }}
        />
      </div>
    </div>
  );
}

export function ImageView({ box, onChange }: { box: BoxItem; onChange: (next: Partial<BoxItem>) => void }) {
  const src = safeImage(box.image);
  return (
    <figure className="subject-image">
      <EmbedGrip id={box.id} />
      {src ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={src} alt={box.caption || ""} />
      ) : (
        <p className="sub">This picture is kept on the device it was added from.</p>
      )}
      <input
        className="subject-image-caption"
        placeholder="Add a caption…"
        defaultValue={box.caption ?? ""}
        onPointerDown={(e) => e.stopPropagation()}
        onBlur={(e) => e.target.value !== (box.caption ?? "") && onChange({ caption: e.target.value.slice(0, 300) })}
      />
    </figure>
  );
}

/**
 * A picture made small enough to keep: at most 1400px on its long side, as a
 * JPEG (or PNG where it has transparency worth keeping), so a phone photo
 * of several megabytes becomes a couple of hundred kilobytes.
 */
export async function shrinkImage(file: File, max = 1400): Promise<string> {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error("That file isn't a picture this browser can open."));
      el.src = url;
    });
    const scale = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(img.naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(img.naturalHeight * scale));
    const ctx = canvas.getContext("2d")!;
    const png = file.type === "image/png" && file.size < 400_000;
    if (!png) {
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
    }
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    return png ? canvas.toDataURL("image/png") : canvas.toDataURL("image/jpeg", 0.8);
  } finally {
    URL.revokeObjectURL(url);
  }
}

export type { Stroke };

/**
 * A little spreadsheet. Cells keep what was typed; a cell starting with "="
 * is a formula (SUM, AVERAGE/AVG, MEDIAN, MIN, MAX, COUNT, ROUND, IF…) over
 * other cells by their letters and numbers, worked out as it is shown.
 */
export function TableBox({ box, onChange }: { box: BoxItem; onChange: (next: Partial<BoxItem>) => void }) {
  const grid = safeGrid(box.table);
  const values = evaluate(grid);
  const [editing, setEditing] = useState<{ r: number; c: number; text: string } | null>(null);
  const rows = grid.length;
  const cols = grid[0].length;

  const save = (next: Grid) => onChange({ table: next });
  const commit = (move?: [number, number]) => {
    if (!editing) return;
    const { r, c, text } = editing;
    if (text !== grid[r][c]) save(grid.map((row, i) => (i === r ? row.map((v, j) => (j === c ? text.slice(0, 1000) : v)) : row)));
    if (!move) return setEditing(null);
    const nr = Math.min(rows - 1, Math.max(0, r + move[0]));
    const nc = Math.min(cols - 1, Math.max(0, c + move[1]));
    setEditing({ r: nr, c: nc, text: grid[nr][nc] === undefined ? "" : nr === r && nc === c ? text : grid[nr][nc] });
  };

  return (
    <div className="sheet" onPointerDown={(e) => e.stopPropagation()}>
      <div className="sheet-scroll">
        <table>
          <thead>
            <tr>
              <th className="sheet-corner" />
              {grid[0].map((_, c) => <th key={c}>{colName(c)}</th>)}
            </tr>
          </thead>
          <tbody>
            {grid.map((row, r) => (
              <tr key={r}>
                <th>{r + 1}</th>
                {row.map((raw, c) => {
                  const on = editing?.r === r && editing.c === c;
                  const v = values[r][c];
                  return (
                    <td
                      key={c}
                      className={`${typeof v === "number" ? "num" : ""}${isError(v) ? " err" : ""}${raw.trim().startsWith("=") ? " formula" : ""}`}
                      title={raw.trim().startsWith("=") ? raw : undefined}
                      onClick={() => !on && (editing ? commit() : null, setEditing({ r, c, text: raw }))}
                    >
                      {on ? (
                        <input
                          autoFocus
                          aria-label={`Cell ${colName(c)}${r + 1}`}
                          value={editing.text}
                          onChange={(e) => setEditing({ ...editing, text: e.target.value })}
                          onBlur={() => commit()}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") { e.preventDefault(); commit([e.shiftKey ? -1 : 1, 0]); }
                            else if (e.key === "Tab") { e.preventDefault(); e.stopPropagation(); commit([0, e.shiftKey ? -1 : 1]); }
                            else if (e.key === "Escape") setEditing(null);
                          }}
                        />
                      ) : (
                        display(v)
                      )}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="sheet-tools">
        <button disabled={rows >= MAX_ROWS} onClick={() => save([...grid, Array(cols).fill("")])}>+ Row</button>
        <button disabled={cols >= MAX_COLS} onClick={() => save(grid.map((row) => [...row, ""]))}>+ Column</button>
        <button disabled={rows <= 1} onClick={() => { setEditing(null); save(grid.slice(0, -1)); }}>− Row</button>
        <button disabled={cols <= 1} onClick={() => { setEditing(null); save(grid.map((row) => row.slice(0, -1))); }}>− Column</button>
        <span className="sheet-hint">Type = for a formula: =SUM(A1:A5), =AVG(B:B), =MEDIAN(…)</span>
      </div>
    </div>
  );
}
