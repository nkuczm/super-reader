"use client";

import { useState } from "react";
import type { Note } from "@/lib/notes";

/** How many subjects are offered before "Show more". */
export const RECENT_SUBJECTS = 3;

/**
 * The subjects to file something in: the three used most recently (the list
 * arrives in that order), and the rest behind "Show more" — where a search
 * box and a scrolling list take over, since by then there are too many to
 * read down.
 */
export default function SubjectChoices({
  notes,
  onPick,
  label,
  keepSelection,
}: {
  /** Most recently used first. */
  notes: Note[];
  onPick: (note: Note) => void;
  /** What a row shows besides the name — "Open" for a subject already holding the story. */
  label?: (note: Note) => React.ReactNode;
  /** Pressing a row must not clear the text selected in the article. */
  keepSelection?: boolean;
}) {
  const [more, setMore] = useState(false);
  const [query, setQuery] = useState("");
  const hold = keepSelection ? (event: React.MouseEvent) => event.preventDefault() : undefined;
  const q = query.trim().toLowerCase();
  const shown = more ? notes.filter((note) => !q || note.name.toLowerCase().includes(q)) : notes.slice(0, RECENT_SUBJECTS);
  const row = (note: Note) => (
    <button key={note.id} role="menuitem" className="subject-choice" onMouseDown={hold} onClick={() => onPick(note)} title={note.name}>
      <span className="subject-choice-name">{note.name}</span>
      {label?.(note)}
    </button>
  );
  return (
    <div className="subject-choices">
      {notes.length > RECENT_SUBJECTS && !more && <div className="subject-choices-head">Recent</div>}
      {more ? (
        <>
          <input
            className="input subject-choices-search"
            autoFocus
            placeholder={`Search ${notes.length} subjects…`}
            aria-label="Search subjects"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && shown[0]) {
                event.preventDefault();
                onPick(shown[0]);
              }
              if (event.key === "Escape") {
                event.stopPropagation();
                setMore(false);
                setQuery("");
              }
            }}
          />
          <div className="subject-choices-scroll">
            {shown.map(row)}
            {shown.length === 0 && <p className="subject-choices-none">No subject matches “{query.trim()}”.</p>}
          </div>
        </>
      ) : (
        shown.map(row)
      )}
      {!more && notes.length > RECENT_SUBJECTS && (
        <button role="menuitem" className="subject-choices-more" onMouseDown={hold} onClick={() => setMore(true)}>
          Show more ({notes.length - RECENT_SUBJECTS})
        </button>
      )}
    </div>
  );
}
