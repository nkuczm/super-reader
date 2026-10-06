"use client";

import { useState } from "react";
import { addFlag, type FlagInput } from "@/lib/flags";

/**
 * Flag an AI result for tuning: asks for an optional note, then keeps the
 * result with its context (see lib/flags.ts).
 */
export default function FlagButton({ make, className }: { make: () => FlagInput; className?: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      className={`ai-flag${done ? " on" : ""}${className ? ` ${className}` : ""}`}
      title={done ? "Flagged — see Settings → Flagged AI results" : "Flag this AI result, to tune it later"}
      aria-label="Flag this AI result"
      onPointerDown={(e) => e.stopPropagation()}
      onMouseDown={(e) => e.preventDefault()}
      onClick={(e) => {
        e.stopPropagation();
        if (done) return;
        const note = window.prompt("Flag this AI result. What's off about it? (optional)");
        if (note === null) return;
        addFlag({ ...make(), ...(note.trim() ? { note: note.trim() } : {}) });
        setDone(true);
      }}
    >
      ⚑
    </button>
  );
}
