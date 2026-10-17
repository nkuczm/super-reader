"use client";

import { useEffect, useRef, useState } from "react";
import { FAVORITES_EVENT, SHADES, hexColor, loadFavorites, loadRecent, pushRecent, saveFavorites, type ColorUse } from "@/lib/colors";

/**
 * Colours to choose from, set out by hue (across) and shade (down); the
 * reader's favourites under them, with a way to add one with the system's
 * colour picker; and along the bottom the five colours last chosen here.
 * The last one chosen is ringed wherever it shows. A favourite is taken off
 * with a right-click (or Alt-click).
 */
export default function ColorSwatches({ use, onPick, onNone, noneLabel = "No colour", label }: {
  /** Highlights or table cells: each keeps its own recent colours. */
  use: ColorUse;
  onPick: (color: string) => void;
  onNone?: () => void;
  noneLabel?: string;
  label: string;
}) {
  const [favorites, setFavorites] = useState<string[]>([]);
  const [recent, setRecent] = useState<string[]>([]);
  const pick = (color: string) => {
    pushRecent(use, color);
    onPick(color);
  };
  useEffect(() => {
    const read = () => {
      setFavorites(loadFavorites());
      setRecent(loadRecent(use));
    };
    read();
    window.addEventListener(FAVORITES_EVENT, read);
    return () => window.removeEventListener(FAVORITES_EVENT, read);
  }, [use]);
  const swatch = (color: string, favorite = false, row = "c") => (
    <button key={`${row}${color}`} type="button" role="menuitem" className={`color-swatch${color === recent[0] ? " latest" : ""}`} style={{ background: color }}
      aria-label={`${favorite ? "Favourite " : ""}${color}`} title={favorite ? `${color} · right-click to remove` : color}
      onClick={(e) => {
        if (favorite && e.altKey) return saveFavorites(favorites.filter((c) => c !== color));
        pick(color);
      }}
      onContextMenu={favorite ? (e) => { e.preventDefault(); saveFavorites(favorites.filter((c) => c !== color)); } : undefined} />
  );
  return (
    <div className="color-swatches" role="group" aria-label={label} onMouseDown={(e) => e.preventDefault()}>
      {SHADES.map((row, i) => (
        <div key={i} className="color-grid">{row.map((c) => swatch(c))}</div>
      ))}
      {onNone && (
        <button type="button" role="menuitem" className="color-none" aria-label={noneLabel} title={noneLabel} onClick={onNone}>⌀ {noneLabel}</button>
      )}
      <div className="color-favs-head">Favourites</div>
      <div className="color-grid">
        {favorites.map((c) => swatch(c, true, "f"))}
        <AddFavorite onAdd={(color) => saveFavorites([...favorites.filter((c) => c !== color), color])} />
      </div>
      {recent.length > 0 && (
        <>
          <div className="color-favs-head">Recent</div>
          <div className="color-grid">{recent.map((c) => swatch(c, false, "r"))}</div>
        </>
      )}
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
