"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Icon } from "./icons";
import { cleanQuoteText, type Note } from "@/lib/notes";

type Placed = { text: string; top: number; left: number };

/**
 * "Add to note", floating beside whatever has just been highlighted.
 *
 * It only watches inside the element it is given — the article's own text —
 * so selecting a headline or the chrome does nothing. On a phone the browser
 * puts its own copy/share bar over the selection, so this sits *below* the
 * selection when there is room, rather than fighting it for the same strip
 * of screen.
 */
export default function QuoteToNote({
  container,
  notes,
  onQuote,
  onCreateNote,
}: {
  container: React.RefObject<HTMLElement | null>;
  notes: Note[];
  /** Add the highlighted text to this note. */
  onQuote: (noteId: string, text: string) => void;
  /** Start a note and return its id, so a quote can go straight into it. */
  onCreateNote: (name: string) => string;
}) {
  const [placed, setPlaced] = useState<Placed | null>(null);
  const [picking, setPicking] = useState(false);
  const [newName, setNewName] = useState("");
  const [added, setAdded] = useState<string | null>(null);
  const root = useRef<HTMLDivElement | null>(null);

  const read = useCallback(() => {
    const selection = window.getSelection();
    const text = cleanQuoteText(selection?.toString() ?? "");
    const host = container.current;
    if (!selection || selection.rangeCount === 0 || !text || !host) return null;

    // Both ends have to be in the article: a selection dragged out of it is
    // picking up the page around it, not quoting the story.
    const range = selection.getRangeAt(0);
    if (!host.contains(range.startContainer) || !host.contains(range.endContainer)) {
      return null;
    }

    const rect = range.getBoundingClientRect();
    if (rect.width === 0 && rect.height === 0) return null;
    return { text, rect };
  }, [container]);

  const place = useCallback(() => {
      const hit = read();
      if (!hit) {
        setPlaced(null);
        return;
      }
      const { rect } = hit;
      const below = rect.bottom + 8;
      const fitsBelow = below + 44 < window.innerHeight;
      // Clamped to the screen: a selection can run off the bottom of the
      // viewport — a long passage, or one the page scrolled after selecting —
      // and a button placed faithfully beside it would be somewhere nobody
      // can reach.
      const top = Math.min(
        Math.max(8, fitsBelow ? below : rect.top - 44),
        window.innerHeight - 52,
      );
      setPlaced({
        text: hit.text,
        top,
        left: Math.min(
          Math.max(12, rect.left + rect.width / 2 - 70),
          window.innerWidth - 152,
        ),
      });
  }, [read]);

  useEffect(() => {
    // The menu is open over a selection the browser may have just cleared;
    // leave it where it is until the reader chooses or dismisses it.
    const show = () => {
      if (!picking) place();
    };
    // pointerup/keyup rather than selectionchange: the latter fires on every
    // character of a drag, and the button would jitter along with it.
    document.addEventListener("pointerup", show);
    document.addEventListener("keyup", show);
    return () => {
      document.removeEventListener("pointerup", show);
      document.removeEventListener("keyup", show);
    };
  }, [place, picking]);

  // Scrolling moves the words, so it moves the button with them — and drops
  // it once the selection itself is gone. Dropping it on any scroll at all
  // was wrong: a phone's momentum scroll after a selection took it away
  // before it could be used.
  useEffect(() => {
    if (!placed || picking) return;
    const follow = () => place();
    window.addEventListener("scroll", follow, true);
    return () => window.removeEventListener("scroll", follow, true);
  }, [placed, picking, place]);

  useEffect(() => {
    if (!picking) return;
    const close = (event: MouseEvent) => {
      if (!root.current?.contains(event.target as Node)) {
        setPicking(false);
        setPlaced(null);
      }
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [picking]);

  function finish(noteId: string, name: string, text: string) {
    onQuote(noteId, text);
    setPicking(false);
    setPlaced(null);
    setNewName("");
    window.getSelection()?.removeAllRanges();
    // Said out loud, because the quote lands on a page you are not looking at.
    setAdded(`Added to ${name}`);
    setTimeout(() => setAdded(null), 2200);
  }

  return (
    <>
      {placed && (
        <div
          ref={root}
          className="quote-pop"
          style={{ top: placed.top, left: placed.left }}
        >
          {!picking ? (
            <button
              className="btn small quote-add"
              // mousedown would clear the selection before the click lands.
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => {
                // One note is not a choice worth making.
                if (notes.length === 1) {
                  finish(notes[0].id, notes[0].name, placed.text);
                } else {
                  setPicking(true);
                }
              }}
            >
              {Icon.note} Add to note
            </button>
          ) : (
            <div className="quote-menu" role="menu">
              {notes.map((note) => (
                <button
                  key={note.id}
                  role="menuitem"
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => finish(note.id, note.name, placed.text)}
                >
                  {note.name}
                </button>
              ))}
              <div className="quote-new">
                <input
                  className="input"
                  placeholder="New note…"
                  value={newName}
                  autoFocus
                  onChange={(event) => setNewName(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" && newName.trim()) {
                      finish(onCreateNote(newName.trim()), newName.trim(), placed.text);
                    }
                    if (event.key === "Escape") {
                      setPicking(false);
                      setPlaced(null);
                    }
                  }}
                />
                <button
                  className="btn small"
                  disabled={!newName.trim()}
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() =>
                    finish(onCreateNote(newName.trim()), newName.trim(), placed.text)
                  }
                >
                  Add
                </button>
              </div>
            </div>
          )}
        </div>
      )}
      {added && (
        <div className="quote-toast" role="status">
          {added}
        </div>
      )}
    </>
  );
}
