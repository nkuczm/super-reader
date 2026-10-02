"use client";

import { useRef, useState } from "react";
import { DRAWING_WIDTH, safeImage, safeStrokes, type BoxItem, type Stroke } from "@/lib/subjects";

const COLORS = ["#111111", "#2563eb", "#dc2626", "#16a34a", "#f59e0b"];
const PEN_SIZES = [2, 5];
export const DRAWING_HEIGHT = 300;

/**
 * A drawing pad: strokes in a fixed 600-wide space so a sketch keeps its
 * shape at any width, on any device. Saved when each stroke ends.
 */
export function DrawingPad({ box, onChange }: { box: BoxItem; onChange: (next: Partial<BoxItem>) => void }) {
  const strokes = safeStrokes(box.drawing);
  const height = Math.min(1200, Math.max(120, Number(box.height) || DRAWING_HEIGHT));
  const [color, setColor] = useState(COLORS[0]);
  const [size, setSize] = useState(PEN_SIZES[0]);
  const [live, setLive] = useState<string | null>(null);
  const svg = useRef<SVGSVGElement | null>(null);
  const path = useRef<string[]>([]);

  const point = (event: React.PointerEvent) => {
    const rect = svg.current!.getBoundingClientRect();
    const scale = DRAWING_WIDTH / rect.width;
    const x = Math.round((event.clientX - rect.left) * scale * 10) / 10;
    const y = Math.round((event.clientY - rect.top) * scale * 10) / 10;
    return `${x} ${y}`;
  };

  const finish = () => {
    if (path.current.length === 0) return;
    // A single tap still leaves a dot.
    const parts = path.current.length === 1 ? [path.current[0], path.current[0]] : path.current;
    const d = `M ${parts[0]} ${parts.slice(1).map((p) => `L ${p}`).join(" ")}`;
    path.current = [];
    setLive(null);
    onChange({ drawing: [...strokes, { d, color, w: size }] });
  };

  return (
    <div className="drawing">
      <div className="drawing-tools" onPointerDown={(e) => e.stopPropagation()}>
        {COLORS.map((c) => (
          <button key={c} className={`drawing-color${c === color ? " on" : ""}`} style={{ background: c }}
            aria-label={`Pen colour ${c}`} onClick={() => setColor(c)} />
        ))}
        {PEN_SIZES.map((w) => (
          <button key={w} className={`drawing-size${w === size ? " on" : ""}`} aria-label={`Pen size ${w}`} onClick={() => setSize(w)}>
            <span style={{ width: w + 2, height: w + 2 }} />
          </button>
        ))}
        <button className="link-btn" disabled={strokes.length === 0} onClick={() => onChange({ drawing: strokes.slice(0, -1) })}>
          Undo
        </button>
        <button className="link-btn" disabled={strokes.length === 0} onClick={() => onChange({ drawing: [] })}>
          Clear
        </button>
        <button className="link-btn" onClick={() => onChange({ height: Math.min(1200, height + 150) })}>Taller</button>
      </div>
      <svg
        ref={svg}
        className="drawing-canvas"
        viewBox={`0 0 ${DRAWING_WIDTH} ${height}`}
        onPointerDown={(event) => {
          event.stopPropagation();
          event.preventDefault();
          (event.target as Element).setPointerCapture?.(event.pointerId);
          path.current = [point(event)];
          setLive(`M ${path.current[0]}`);
        }}
        onPointerMove={(event) => {
          if (path.current.length === 0) return;
          path.current.push(point(event));
          setLive(`M ${path.current[0]} ${path.current.slice(1).map((p) => `L ${p}`).join(" ")}`);
        }}
        onPointerUp={finish}
        onPointerCancel={finish}
      >
        {strokes.map((s, i) => (
          <path key={i} d={s.d} stroke={s.color} strokeWidth={s.w} fill="none" strokeLinecap="round" strokeLinejoin="round" />
        ))}
        {live && <path d={live} stroke={color} strokeWidth={size} fill="none" strokeLinecap="round" strokeLinejoin="round" />}
      </svg>
    </div>
  );
}

export function ImageView({ box, onChange }: { box: BoxItem; onChange: (next: Partial<BoxItem>) => void }) {
  const src = safeImage(box.image);
  return (
    <figure className="subject-image">
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
