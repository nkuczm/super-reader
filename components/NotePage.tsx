"use client";

import { useEffect, useRef, useState } from "react";
import { Icon } from "./icons";
import type { Note, NoteEntry } from "@/lib/notes";

/**
 * One note: its quotes and the lines you wrote around them, in the order they
 * were added.
 *
 * Deliberately plain. There is no formatting, no toolbar and no autosave
 * indicator — a note here is for holding what a story actually said, and
 * anything more would be a worse text editor than the one the reader already
 * has somewhere else.
 */
export default function NotePage({
  note,
  onOpenArticle,
  onAddComment,
  onEditComment,
  onRemoveEntry,
  onOpenMenu,
}: {
  note: Note;
  /** Back to the article a quote came from. */
  onOpenArticle: (link: string, title: string) => void;
  onAddComment: (text: string) => void;
  onEditComment: (entryId: string, text: string) => void;
  onRemoveEntry: (entryId: string) => void;
  onOpenMenu?: () => void;
}) {
  const [draft, setDraft] = useState("");
  const [confirming, setConfirming] = useState<string | null>(null);

  function addComment() {
    const text = draft.trim();
    if (!text) return;
    onAddComment(text);
    setDraft("");
  }

  return (
    <div className="note-page">
      <div className="list-head">
        {onOpenMenu && (
          <button className="menu-btn" onClick={onOpenMenu} aria-label="Open feeds">
            {Icon.menu}
          </button>
        )}
        <div>
          <h1>{note.name}</h1>
          <p className="sub">
            {note.entries.length === 0
              ? "Empty"
              : `${note.entries.filter((e) => e.kind === "quote").length} quote${
                  note.entries.filter((e) => e.kind === "quote").length === 1 ? "" : "s"
                }`}
          </p>
        </div>
      </div>

      {note.entries.length === 0 ? (
        <div className="state">
          <h2>Nothing in this note yet.</h2>
          <p>
            Highlight anything while reading an article and choose{" "}
            <strong>Add to note</strong>. The quote lands here as written, and
            the article is kept so it is still there when you come back.
          </p>
        </div>
      ) : (
        <ul className="note-entries">
          {note.entries.map((entry) => (
            <li key={entry.id} className={`note-entry ${entry.kind}`}>
              {entry.kind === "quote" ? (
                <Quote
                  entry={entry}
                  onOpen={() => onOpenArticle(entry.link, entry.articleTitle)}
                />
              ) : (
                <Comment
                  text={entry.text}
                  onChange={(text) => onEditComment(entry.id, text)}
                />
              )}
              {confirming === entry.id ? (
                <span className="note-confirm">
                  <button
                    className="link-btn danger"
                    onClick={() => {
                      onRemoveEntry(entry.id);
                      setConfirming(null);
                    }}
                  >
                    Delete
                  </button>
                  <button className="link-btn" onClick={() => setConfirming(null)}>
                    Keep
                  </button>
                </span>
              ) : (
                <button
                  className="icon-btn danger note-remove"
                  aria-label={
                    entry.kind === "quote" ? "Delete this quote" : "Delete this line"
                  }
                  onClick={() => setConfirming(entry.id)}
                >
                  {Icon.trash}
                </button>
              )}
            </li>
          ))}
        </ul>
      )}

      <div className="note-compose">
        <textarea
          className="input note-input"
          placeholder="Write a note…"
          rows={3}
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            // Enter adds the line; a newline inside one needs Shift.
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              addComment();
            }
          }}
        />
        <button className="btn small" onClick={addComment} disabled={!draft.trim()}>
          Add
        </button>
      </div>
    </div>
  );
}

/** A quote, as the article had it. Read-only by design. */
function Quote({
  entry,
  onOpen,
}: {
  entry: Extract<NoteEntry, { kind: "quote" }>;
  onOpen: () => void;
}) {
  return (
    <div className="note-quote">
      <blockquote>
        {entry.text.split(/\n\n+/).map((para, i) => (
          <p key={i}>{para}</p>
        ))}
      </blockquote>
      <button className="note-source" onClick={onOpen}>
        {Icon.back} {entry.articleTitle}
        {entry.sourceTitle ? ` · ${entry.sourceTitle}` : ""}
      </button>
    </div>
  );
}

/** One of your own lines. Grows with what you type; saves as you go. */
function Comment({
  text,
  onChange,
}: {
  text: string;
  onChange: (text: string) => void;
}) {
  const ref = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, [text]);

  return (
    <textarea
      ref={ref}
      className="note-comment"
      value={text}
      rows={1}
      onChange={(event) => onChange(event.target.value)}
    />
  );
}
