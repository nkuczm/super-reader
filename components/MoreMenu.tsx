"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";

/** The ⋯ menu that holds everything a header does not need to show. */
export default function MoreMenu({ label = "More", children }: { label?: string; children: (close: () => void) => React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement | null>(null);
  const menu = useRef<HTMLDivElement | null>(null);
  // Hung from the button's right edge, the menu would leave the screen if a
  // narrow bar wrapped the button to its left: nudged back in, then.
  useLayoutEffect(() => {
    const el = menu.current;
    if (!open || !el) return;
    const { left, right } = el.getBoundingClientRect();
    const shift = left < 8 ? 8 - left : right > window.innerWidth - 8 ? window.innerWidth - 8 - right : 0;
    if (shift) el.style.transform = `translateX(${Math.round(shift)}px)`;
  }, [open]);
  useEffect(() => {
    if (!open) return;
    const away = (event: PointerEvent) => {
      if (!ref.current?.contains(event.target as globalThis.Node)) setOpen(false);
    };
    const esc = (event: KeyboardEvent) => event.key === "Escape" && setOpen(false);
    document.addEventListener("pointerdown", away);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("pointerdown", away);
      document.removeEventListener("keydown", esc);
    };
  }, [open]);
  return (
    <div className="more-wrap" ref={ref}>
      <button className="btn ghost small more-btn" aria-label={label} title={label} aria-haspopup="menu" aria-expanded={open}
        onClick={() => setOpen((o) => !o)}>
        ⋯
      </button>
      {open && (
        <div className="more-menu" role="menu" ref={menu}>
          {children(() => setOpen(false))}
        </div>
      )}
    </div>
  );
}
