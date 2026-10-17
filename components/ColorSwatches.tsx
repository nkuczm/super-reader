"use client";

import { useEffect, useRef, useState } from "react";
import { FAVORITES_EVENT, hexColor, loadFavorites, saveFavorites } from "@/lib/colors";

/**
 * A grid of colours to choose from, the reader's favourites under them, and
 * a way to add one with the system's colour picker. A favourite is taken
 * off with a right-click (or Alt-click).
 */
export default function ColorSwatches({ colors, onPick, onNone, noneLabel = "No colour", label }: {
  colors: string[];
  onPick: (color: string) => void;
  onNone?: () => void;
  noneLabel?: string;
  label: string;
}) {
  const [favorites, setFavorites] = useState<string[]>([]);
  useEffect(() => {
    const read = () => setFavorites(loadFavorites());
    read();
    window.addEventListener(FAVORITES_EVENT, read);
    return () => window.removeEventListener(FAVORITES_EVENT, read);
  }, []);
  const swatch = (color: string, favorite = false) => (
    <button key={`${favorite ? "f" : "c"}${color}`} type="button" role="menuitem" className="color-swatch" style={{ background: color }}
      aria-label={`${favorite ? "Favourite " : ""}${color}`} title={favorite ? `${color} · right-click to remove` : color}
      onClick={(e) => {
        if (favorite && e.altKey) return saveFavorites(favorites.filter((c) => c !== color));
        onPick(color);
      }}
      onContextMenu={favorite ? (e) => { e.preventDefault(); saveFavorites(favorites.filter((c) => c !== color)); } : undefined} />
  );
  return (
    <div className="color-swatches" role="group" aria-label={label} onMouseDown={(e) => e.preventDefault()}>
      <div className="color-grid">
        {colors.map((c) => swatch(c))}
        {onNone && (
          <button type="button" role="menuitem" className="color-swatch none" aria-label={noneLabel} title={noneLabel} onClick={onNone}>⌀</button>
        )}
      </div>
      <div className="color-favs-head">Favourites</div>
      <div className="color-grid">
        {favorites.map((c) => swatch(c, true))}
        <AddFavorite onAdd={(color) => saveFavorites([...favorites.filter((c) => c !== color), color])} />
      </div>
    </div>
  );
}

/**
 * The system's colour picker, as a "+" swatch. What it settles on (its
 * change event, not every step of a drag) becomes a favourite, to pick from
 * the row like any other — picking it straight away would land nowhere, as
 * the picker has taken the caret out of the writing.
 */
function AddFavorite({ onAdd }: { onAdd: (color: string) => void }) {
  const input = useRef<HTMLInputElement | null>(null);
  const add = useRef(onAdd);
  add.current = onAdd;
  useEffect(() => {
    const el = input.current;
    if (!el) return;
    const changed = () => {
      const color = hexColor(el.value);
      if (color) add.current(color);
    };
    el.addEventListener("change", changed);
    return () => el.removeEventListener("change", changed);
  }, []);
  return (
    <label className="color-swatch add" title="Add a favourite colour">
      +
      <input ref={input} type="color" aria-label="Add a favourite colour" defaultValue="#a3e635" />
    </label>
  );
}
