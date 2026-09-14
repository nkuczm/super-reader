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
  onOpenNote,
  onMoveQuote,
}: {
  container: React.RefObject<HTMLElement | null>;
  notes: Note[];
  /** Add the highlighted text to this note; hands back the quote's own id. */
  onQuote: (noteId: string, text: string) => string | void;
  /** Start a note and return its id, so a quote can go straight into it. */
  onCreateNote: (name: string) => string;
  /** Open a note — where the "Added to…" bubble goes when it is tapped. */
  onOpenNote?: (noteId: string) => void;
  /** Send a quote that has just been filed to a different note instead. */
  onMoveQuote?: (entryId: string, toNoteId: string) => void;
}) {
  const [placed, setPlaced] = useState<Placed | null>(null);
  const [picking, setPicking] = useState(false);
  const [newName, setNewName] = useState("");
  /**
   * The quote just filed: what it says, where it went, and which entry it is —
   * enough for the bubble to open that note, or move the quote to another.
   */
  const [added, setAdded] = useState<
    { noteId: string; noteName: string; entryId?: string } | null
  >(null);
  const [changing, setChanging] = useState(false);
  const [renaming, setRenaming] = useState("");
  const hide = useRef<ReturnType<typeof setTimeout> | null>(null);
  const root = useRef<HTMLDivElement | null>(null);
  /**
   * On a touch screen the button is docked to the bottom of the screen rather
   * than put beside the selection.
   *
   * iOS draws its own copy/paste callout over the selection — above it, or
   * below it when there is no room above — so *neither* side of a selection is
   * safe to put anything on. Out of the way at the bottom is the only place
   * that is always reachable, and it is where a thumb already is.
   */
  const [docked, setDocked] = useState(false);
  useEffect(() => {
    setDocked(window.matchMedia?.("(pointer: coarse)").matches ?? false);
  }, []);

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
      if (docked) {
        // Position comes from the stylesheet; only the text matters here.
        setPlaced({ text: hit.text, top: 0, left: 0 });
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
  }, [read, docked]);

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

  /** Keep the bubble up while it is being used, and take it away after. */
  const linger = useCallback((ms: number) => {
    if (hide.current) clearTimeout(hide.current);
    hide.current = setTimeout(() => {
      setAdded(null);
      setChanging(false);
    }, ms);
  }, []);

  function finish(noteId: string, name: string, text: string) {
    const entryId = onQuote(noteId, text) || undefined;
    setPicking(false);
    setPlaced(null);
    setNewName("");
    window.getSelection()?.removeAllRanges();
    // Said out loud, because the quote lands on a page you are not looking at
    // — and worth saying for long enough to be answered: the bubble opens that
    // note, or sends the quote to a different one.
    setAdded({ noteId, noteName: name, entryId });
    setChanging(false);
    linger(6000);
  }

  /** Send the quote that was just filed somewhere else instead. */
  function moveTo(noteId: string, name: string) {
    if (added?.entryId && onMoveQuote) onMoveQuote(added.entryId, noteId);
    setAdded((current) => (current ? { ...current, noteId, noteName: name } : current));
    setChanging(false);
    setRenaming("");
    linger(4000);
  }

  return (
    <>
      {placed && (
        <div
          ref={root}
          className={`quote-pop${docked ? " docked" : ""}`}
          style={docked ? undefined : { top: placed.top, left: placed.left }}
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
          {changing && (
            <div className="quote-menu toast-menu" role="menu">
              {notes
                .filter((note) => note.id !== added.noteId)
                .map((note) => (
                  <button
                    key={note.id}
                    role="menuitem"
                    onClick={() => moveTo(note.id, note.name)}
                  >
                    {note.name}
                  </button>
                ))}
              <div className="quote-new">
                <input
                  className="input"
                  placeholder="New note…"
                  value={renaming}
                  autoFocus
                  onChange={(event) => setRenaming(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" && renaming.trim()) {
                      moveTo(onCreateNote(renaming.trim()), renaming.trim());
                    }
                  }}
                />
                <button
                  className="btn small"
                  disabled={!renaming.trim()}
                  onClick={() => moveTo(onCreateNote(renaming.trim()), renaming.trim())}
                >
                  Add
                </button>
              </div>
            </div>
          )}
          <div className="quote-toast-row">
            <button
              className="quote-toast-open"
              onClick={() => {
                setAdded(null);
                onOpenNote?.(added.noteId);
              }}
            >
              Added to <strong>{added.noteName}</strong>
              {Icon.chevron}
            </button>
            <button
              className="quote-toast-change"
              aria-expanded={changing}
              onClick={() => {
                setChanging((open) => !open);
                // Given a choice to make, the bubble waits rather than leaving
                // mid-decision.
                linger(20000);
              }}
            >
              Change
            </button>
          </div>
        </div>
      )}
    </>
  );
}
