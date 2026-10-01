"use client";

import { useState } from "react";
import { Icon } from "./icons";
import type { Note } from "@/lib/notes";
import { cardsOf, live, type Boards } from "@/lib/subjects";
import { timeAgo } from "./format";

/**
 * Every subject at a glance, the way a documents home page shows files: one
 * tile each, newest activity first, with enough on it to recognise it.
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
}: {
  notes: Note[];
  boards: Boards;
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

  const tiles = notes
    .map((note) => {
      const board = boards[note.id];
      const cards = cardsOf(note, board);
      const items = live(board);
      const lastChange = Math.max(
        note.updatedAt ?? note.at,
        ...note.entries.map((entry) => entry.at),
        ...items.map((item) => item.at),
      );
      return {
        note,
        cards,
        quotes: cards.reduce((sum, card) => sum + card.quotes.length, 0),
        insights: items.filter((item) => item.kind === "insight").length,
        suggested: items.filter((item) => item.kind === "suggest" && item.state === "pending").length,
        lastChange,
      };
    })
    .sort((a, b) => b.lastChange - a.lastChange);

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

        {tiles.map(({ note, cards, quotes, insights, suggested, lastChange }) => (
          <div key={note.id} className="subject-tile">
            <button className="subject-tile-open" onClick={() => onOpen(note.id)}>
              {/* A miniature of the page: the first few stories, as lines. */}
              <div className="subject-tile-preview" aria-hidden="true">
                {cards.slice(0, 4).map((card) => (
                  <div key={card.id} className="subject-tile-line">
                    <strong>{card.title}</strong>
                    {card.quotes[0] && <span>“{card.quotes[0].text}”</span>}
                  </div>
                ))}
                {cards.length === 0 && <span className="subject-tile-empty">No stories yet</span>}
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
    </div>
  );
}
