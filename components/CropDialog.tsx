"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

type Rect = { x: number; y: number; w: number; h: number };

/**
 * Crop a picture: drag the frame's corners or edges, or the frame itself,
 * then Crop keeps what is inside it. The result is a new picture at the
 * original's resolution, as a data: URL.
 */
export default function CropDialog({ src, onDone, onCancel }: { src: string; onDone: (dataUrl: string) => void; onCancel: () => void }) {
  const img = useRef<HTMLImageElement | null>(null);
  // In fractions of the picture, so the frame is independent of how big it is shown.
  const [frame, setFrame] = useState<Rect>({ x: 0.05, y: 0.05, w: 0.9, h: 0.9 });

  useEffect(() => {
    const esc = (e: KeyboardEvent) => e.key === "Escape" && onCancel();
    window.addEventListener("keydown", esc);
    return () => window.removeEventListener("keydown", esc);
  }, [onCancel]);

  const drag = (mode: string) => (e: React.PointerEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const box = img.current!.getBoundingClientRect();
    const start = { x: e.clientX, y: e.clientY, f: frame };
    const MIN = 0.05;
    const move = (ev: PointerEvent) => {
      const dx = (ev.clientX - start.x) / box.width;
      const dy = (ev.clientY - start.y) / box.height;
      let { x, y, w, h } = start.f;
      if (mode === "move") {
        x = Math.min(1 - w, Math.max(0, x + dx));
        y = Math.min(1 - h, Math.max(0, y + dy));
      } else {
        if (mode.includes("w")) { const nx = Math.min(x + w - MIN, Math.max(0, x + dx)); w += x - nx; x = nx; }
        if (mode.includes("e")) w = Math.min(1 - x, Math.max(MIN, w + dx));
        if (mode.includes("n")) { const ny = Math.min(y + h - MIN, Math.max(0, y + dy)); h += y - ny; y = ny; }
        if (mode.includes("s")) h = Math.min(1 - y, Math.max(MIN, h + dy));
      }
      setFrame({ x, y, w, h });
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  const crop = () => {
    const el = img.current;
    if (!el) return;
    const sw = Math.max(1, Math.round(frame.w * el.naturalWidth));
    const sh = Math.max(1, Math.round(frame.h * el.naturalHeight));
    const canvas = document.createElement("canvas");
    canvas.width = sw;
    canvas.height = sh;
    canvas.getContext("2d")!.drawImage(el, frame.x * el.naturalWidth, frame.y * el.naturalHeight, sw, sh, 0, 0, sw, sh);
    const png = src.startsWith("data:image/png");
    onDone(png ? canvas.toDataURL("image/png") : canvas.toDataURL("image/jpeg", 0.85));
  };

  const pct = (n: number) => `${n * 100}%`;
  return createPortal(
    <div className="crop-backdrop" onPointerDown={(e) => e.target === e.currentTarget && onCancel()}>
      <div className="crop-dialog" role="dialog" aria-label="Crop picture">
        <div className="crop-stage">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img ref={img} src={src} alt="" draggable={false} />
          <div className="crop-frame" style={{ left: pct(frame.x), top: pct(frame.y), width: pct(frame.w), height: pct(frame.h) }}
            onPointerDown={drag("move")}>
            {["nw", "n", "ne", "e", "se", "s", "sw", "w"].map((h) => (
              <span key={h} className={`crop-handle ${h}`} onPointerDown={drag(h)} />
            ))}
          </div>
        </div>
        <div className="crop-actions">
          <button className="btn ghost small" onClick={() => setFrame({ x: 0, y: 0, w: 1, h: 1 })}>Reset</button>
          <span style={{ flex: 1 }} />
          <button className="btn ghost small" onClick={onCancel}>Cancel</button>
          <button className="btn small" onClick={crop}>Crop</button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

/** A picture onto the clipboard as an image, so it pastes into documents and other apps. */
export async function copyPicture(src: string): Promise<boolean> {
  try {
    const el = new Image();
    el.src = src;
    await el.decode();
    const canvas = document.createElement("canvas");
    canvas.width = el.naturalWidth;
    canvas.height = el.naturalHeight;
    canvas.getContext("2d")!.drawImage(el, 0, 0);
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
    if (!blob) return false;
    await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]);
    return true;
  } catch {
    return false;
  }
}
