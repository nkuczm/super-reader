"use client";

import BoardThumb from "./BoardThumb";

import { useEffect, useState } from "react";
import { Icon } from "./icons";
import type { Note } from "@/lib/notes";
import { cardsOf, isPinned, live, type Boards } from "@/lib/subjects";
import { sortSubjects, type SortDir, type SubjectSort } from "@/lib/subject-order";
import { timeAgo } from "./format";

const LAYOUT_KEY = "super-reader:subjects-layout:v1";
const SORT_LABEL: Record<SubjectSort, string> = { opened: "Last opened", edited: "Last edited", created: "Date created", name: "Name" };

const PIN_ICON = (
  <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" strokeLinecap="round">
    <path d="M9 3h6l-1 6 4 4H6l4-4z" /><path d="M12 13v8" />
  </svg>
);
const GRID_ICON = (
  <svg viewBox="0 0 24 24" width="15" height="15" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.8">
    <rect x="4" y="4" width="7" height="7" rx="1.5" /><rect x="13" y="4" width="7" height="7" rx="1.5" /><rect x="4" y="13" width="7" height="7" rx="1.5" /><rect x="13" y="13" width="7" height="7" rx="1.5" />
  </svg>
);
const LIST_ICON = (
  <svg viewBox="0 0 24 24" width="15" height="15" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
    <path d="M9 6h11M9 12h11M9 18h11" /><circle cx="4.5" cy="6" r="1" /><circle cx="4.5" cy="12" r="1" /><circle cx="4.5" cy="18" r="1" />
  </svg>
);

const shortDate = (t: number) =>
  new Date(t).toLocaleDateString(undefined, { day: "numeric", month: "short", ...(new Date(t).getFullYear() !== new Date().getFullYear() ? { year: "numeric" } : {}) });

/**
 * Every subject at a glance, the way a documents home page shows files: as
 * tiles with a picture of each board, or as a list with its dates side by
 * side — sorted by when each was last opened, last edited or made, or by
 * name, with pinned subjects always first. Layout and order are this
 * device's; pins travel with the subject.
 */
export default function SubjectsHome({
  notes,
  boards,
  onOpen,
  onCreate,
  onRename,
  onDelete,
  onOpenMenu,
  accountStrip,
  opened,
  onPin,
}: {
  notes: Note[];
  boards: Boards;
  /** When each subject was last opened or added to, on this device. */
  opened: Record<string, number>;
  onPin: (id: string, pinned: boolean) => void;
  onOpen: (id: string) => void;
  onCreate: (name: string) => void;
  onRename: (id: string, name: string) => void;
  onDelete: (id: string) => void;
  onOpenMenu?: () => void;
  accountStrip?: React.ReactNode;
}) {
  const [naming, setNaming] = useState(false);
  /** The tile being renamed, and the tile asking whether to delete. */
  const [renaming, setRenaming] = useState<{ id: string; draft: string } | null>(null);
  const [confirming, setConfirming] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [layout, setLayout] = useState<{ view: "grid" | "list"; by: SubjectSort; dir: SortDir }>({ view: "grid", by: "opened", dir: "desc" });
  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(LAYOUT_KEY) ?? "null");
      if (saved && (saved.view === "grid" || saved.view === "list") && saved.by in SORT_LABEL && (saved.dir === "asc" || saved.dir === "desc")) setLayout(saved);
    } catch {
      /* the defaults */
    }
  }, []);
  const choose = (next: Partial<typeof layout>) =>
    setLayout((current) => {
      const value = { ...current, ...next };
      try {
        localStorage.setItem(LAYOUT_KEY, JSON.stringify(value));
      } catch {
        /* not remembered */
      }
      return value;
    });
  /** A column heading: sorts by it, and a second click turns the order round. */
  const sortBy = (by: SubjectSort) =>
    choose(layout.by === by ? { dir: layout.dir === "desc" ? "asc" : "desc" } : { by, dir: by === "name" ? "asc" : "desc" });

  const unsorted = notes
    .map((note) => {
      const board = boards[note.id];
      const cards = cardsOf(note, board);
      const items = live(board);
      // What was written, not which view or tab was last switched to, nor a pin.
      const lastChange = Math.max(
        note.updatedAt ?? note.at,
        ...note.entries.map((entry) => entry.at),
        ...items.filter((item) => item.kind !== "meta" && item.kind !== "pin").map((item) => item.at),
      );
      return {
        note,
        cards,
        quotes: cards.reduce((sum, card) => sum + card.quotes.length, 0),
        insights: items.filter((item) => item.kind === "insight").length,
        suggested: items.filter((item) => item.kind === "suggest" && item.state === "pending").length,
        lastChange,
        id: note.id,
        name: note.name,
        pinned: isPinned(board),
        created: note.at,
        opened: opened[note.id] ?? 0,
        edited: lastChange,
      };
    });
  const tiles = sortSubjects(unsorted, layout.by, layout.dir);

  const create = () => {
    const trimmed = name.trim();
    if (!trimmed) return;
    onCreate(trimmed);
    setName("");
    setNaming(false);
  };

  return (
    <div className="subjects-home">
      <div className="main-head">
        {onOpenMenu && (
          <button className="menu-btn" onClick={onOpenMenu} aria-label="Open feeds">
            {Icon.menu}
          </button>
        )}
        <div>
          <h1>Subjects</h1>
          <p className="sub">{notes.length} subject{notes.length === 1 ? "" : "s"}</p>
        </div>
      </div>
      {accountStrip}

      {notes.length > 0 && (
        <div className="subjects-toolbar">
          <label className="subjects-sort">
            <span>Sort</span>
            <select className="select" value={layout.by} onChange={(e) => choose({ by: e.target.value as SubjectSort, dir: e.target.value === "name" ? "asc" : "desc" })}>
              {(Object.keys(SORT_LABEL) as SubjectSort[]).map((by) => <option key={by} value={by}>{SORT_LABEL[by]}</option>)}
            </select>
            <button className="icon-btn subtle subjects-dir" title={layout.dir === "desc" ? "Newest first — click for oldest" : "Oldest first — click for newest"}
              aria-label={`Order: ${layout.by === "name" ? (layout.dir === "asc" ? "A to Z" : "Z to A") : layout.dir === "desc" ? "newest first" : "oldest first"}`}
              onClick={() => choose({ dir: layout.dir === "desc" ? "asc" : "desc" })}>
              {layout.by === "name" ? (layout.dir === "asc" ? "A→Z" : "Z→A") : layout.dir === "desc" ? "↓" : "↑"}
            </button>
          </label>
          <div className="seg subjects-view" role="tablist" aria-label="Layout">
            <button role="tab" aria-selected={layout.view === "grid"} className={layout.view === "grid" ? "on" : ""} title="Tiles" aria-label="Tiles" onClick={() => choose({ view: "grid" })}>{GRID_ICON}</button>
            <button role="tab" aria-selected={layout.view === "list"} className={layout.view === "list" ? "on" : ""} title="List" aria-label="List" onClick={() => choose({ view: "list" })}>{LIST_ICON}</button>
          </div>
        </div>
      )}

      {layout.view === "list" ? (
        <div className={`subjects-list by-${layout.by}`} role="table" aria-label="Subjects">
          <div className="subjects-list-head" role="row">
            <span role="columnheader" className="col-pin" aria-label="Pinned" />
            {(["name", "created", "opened", "edited"] as const).map((by) => (
              <button key={by} role="columnheader" aria-sort={layout.by === by ? (layout.dir === "asc" ? "ascending" : "descending") : "none"}
                className={`col-${by}${layout.by === by ? " on" : ""}`} onClick={() => sortBy(by)}>
                {by === "name" ? "Name" : by === "created" ? "Created" : by === "opened" ? "Last opened" : "Edited"}
                {layout.by === by && <span aria-hidden="true">{layout.dir === "asc" ? " ↑" : " ↓"}</span>}
              </button>
            ))}
            <span role="columnheader" className="col-actions" aria-label="Actions" />
          </div>
          {naming ? (
            <form className="subjects-list-new" onSubmit={(event) => { event.preventDefault(); create(); }}>
              <input className="input" autoFocus placeholder="Name the subject" value={name}
                onChange={(event) => setName(event.target.value)} onKeyDown={(event) => event.key === "Escape" && setNaming(false)} />
              <button className="btn small" type="submit">Create</button>
            </form>
          ) : (
            <button className="subjects-list-add" onClick={() => setNaming(true)}>{Icon.plus} New subject</button>
          )}
          {tiles.map(({ note, cards, quotes, pinned, created, opened: openedAt, edited }) => (
            <div key={note.id} role="row" className={`subjects-list-row${pinned ? " pinned" : ""}`}>
              <span role="cell" className="col-pin">
                <button className={`icon-btn subtle pin-btn${pinned ? " on" : ""}`} aria-pressed={pinned}
                  aria-label={pinned ? `Unpin ${note.name}` : `Pin ${note.name} to the top`} title={pinned ? "Unpin" : "Pin to the top"}
                  onClick={() => onPin(note.id, !pinned)}>{PIN_ICON}</button>
              </span>
              <span role="cell" className="col-name">
                {renaming?.id === note.id ? (
                  <form className="subjects-list-rename" onSubmit={(event) => {
                    event.preventDefault();
                    if (renaming.draft.trim()) onRename(note.id, renaming.draft.trim());
                    setRenaming(null);
                  }}>
                    <input className="input" autoFocus aria-label="Subject name" value={renaming.draft}
                      onFocus={(event) => event.currentTarget.select()}
                      onChange={(event) => setRenaming({ id: note.id, draft: event.target.value })}
                      onKeyDown={(event) => event.key === "Escape" && setRenaming(null)}
                      onBlur={(event) => event.currentTarget.form?.requestSubmit()} />
                  </form>
                ) : (
                  <button className="subjects-list-open" onClick={() => onOpen(note.id)}>
                    <span className="subjects-list-name">{note.name}</span>
                    <span className="subjects-list-sub">
                      {cards.length} {cards.length === 1 ? "story" : "stories"}{quotes > 0 && ` · ${quotes} quote${quotes === 1 ? "" : "s"}`}
                    </span>
                  </button>
                )}
              </span>
              <span role="cell" className="col-created" title={new Date(created).toLocaleString()}>{shortDate(created)}</span>
              <span role="cell" className="col-opened" title={openedAt ? new Date(openedAt).toLocaleString() : "Not opened on this device"}>
                {openedAt ? timeAgo(new Date(openedAt).toISOString()) : "—"}
              </span>
              <span role="cell" className="col-edited" title={new Date(edited).toLocaleString()}>{timeAgo(new Date(edited).toISOString())}</span>
              <span role="cell" className="col-actions">
                {confirming === note.id ? (
                  <span className="subjects-list-confirm" role="alertdialog" aria-label={`Delete ${note.name}?`}>
                    <button className="btn small danger-btn" autoFocus onClick={() => { setConfirming(null); onDelete(note.id); }}>Delete</button>
                    <button className="btn ghost small" onClick={() => setConfirming(null)}>Keep</button>
                  </span>
                ) : (
                  <>
                    <button className="icon-btn" aria-label={`Rename ${note.name}`} onClick={() => { setConfirming(null); setRenaming({ id: note.id, draft: note.name }); }}>{Icon.pencil}</button>
                    <button className="icon-btn danger" aria-label={`Delete ${note.name}`} onClick={() => { setRenaming(null); setConfirming(note.id); }}>{Icon.trash}</button>
                  </>
                )}
              </span>
            </div>
          ))}
        </div>
      ) : (
      <div className="subjects-grid">
        <div className="subject-tile new">
          {naming ? (
            <form
              className="subject-tile-form"
              onSubmit={(event) => {
                event.preventDefault();
                create();
              }}
            >
              <input
                className="input"
                autoFocus
                placeholder="Name the subject"
                value={name}
                onChange={(event) => setName(event.target.value)}
                onKeyDown={(event) => event.key === "Escape" && setNaming(false)}
              />
              <button className="btn small" type="submit">Create</button>
            </form>
          ) : (
            <button className="subject-tile-new" onClick={() => setNaming(true)}>
              <span className="subject-tile-plus">{Icon.plus}</span>
              New subject
            </button>
          )}
        </div>

        {tiles.map(({ note, cards, quotes, insights, suggested, lastChange, pinned }) => (
          <div key={note.id} className={`subject-tile${pinned ? " pinned" : ""}`}>
            <button className={`icon-btn pin-btn tile-pin${pinned ? " on" : ""}`} aria-pressed={pinned}
              aria-label={pinned ? `Unpin ${note.name}` : `Pin ${note.name} to the top`} title={pinned ? "Unpin" : "Pin to the top"}
              onClick={() => onPin(note.id, !pinned)}>{PIN_ICON}</button>
            <button className="subject-tile-open" onClick={() => onOpen(note.id)}>
              {/* The whole whiteboard, zoomed all the way out. */}
              <div className="subject-tile-preview" aria-hidden="true">
                <BoardThumb board={boards[note.id]} cards={cards} />
              </div>
              <div className="subject-tile-meta">
                <span className="subject-tile-name">{note.name}</span>
                <span className="subject-tile-sub">
                  {cards.length} {cards.length === 1 ? "story" : "stories"}
                  {quotes > 0 && ` · ${quotes} quote${quotes === 1 ? "" : "s"}`}
                  {insights > 0 && ` · ${insights} insights`}
                  {suggested > 0 && ` · ${suggested} suggested`}
                </span>
                <span className="subject-tile-sub">Edited {timeAgo(new Date(lastChange).toISOString())}</span>
              </div>
            </button>
            {renaming?.id === note.id ? (
              <form
                className="subject-tile-edit"
                onSubmit={(event) => {
                  event.preventDefault();
                  if (renaming.draft.trim()) onRename(note.id, renaming.draft.trim());
                  setRenaming(null);
                }}
              >
                <input
                  className="input"
                  autoFocus
                  aria-label="Subject name"
                  value={renaming.draft}
                  onFocus={(event) => event.currentTarget.select()}
                  onChange={(event) => setRenaming({ id: note.id, draft: event.target.value })}
                  onKeyDown={(event) => event.key === "Escape" && setRenaming(null)}
                />
                <div className="subject-tile-edit-row">
                  <button className="btn small" type="submit">Save</button>
                  <button className="btn ghost small" type="button" onClick={() => setRenaming(null)}>Cancel</button>
                </div>
              </form>
            ) : confirming === note.id ? (
              <div className="subject-tile-edit" role="alertdialog" aria-label={`Delete ${note.name}?`}>
                <p>Delete “{note.name}”? Its quotes and board go with it.</p>
                <div className="subject-tile-edit-row">
                  <button className="btn small danger-btn" autoFocus onClick={() => { setConfirming(null); onDelete(note.id); }}>
                    Delete
                  </button>
                  <button className="btn ghost small" onClick={() => setConfirming(null)}>Keep</button>
                </div>
              </div>
            ) : (
              <div className="subject-tile-actions">
                <button
                  className="icon-btn"
                  aria-label={`Rename ${note.name}`}
                  onClick={() => {
                    setConfirming(null);
                    setRenaming({ id: note.id, draft: note.name });
                  }}
                >
                  {Icon.pencil}
                </button>
                <button
                  className="icon-btn danger"
                  aria-label={`Delete ${note.name}`}
                  onClick={() => {
                    setRenaming(null);
                    setConfirming(note.id);
                  }}
                >
                  {Icon.trash}
                </button>
              </div>
            )}
          </div>
        ))}
      </div>
      )}
    </div>
  );
}
