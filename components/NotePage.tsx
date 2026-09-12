"use client";

import { forwardRef, useCallback, useEffect, useRef, useState } from "react";
import { Icon } from "./icons";
import type { Note, NoteEntry } from "@/lib/notes";

/**
 * One note: a page you write on, with the quotes sitting in it.
 *
 * It reads as a single document rather than a form — your own lines are plain
 * text you type straight into, wherever they are, and they save as you go.
 * The quotes are the exception: a quote is what the article said, so it is not
 * editable at all. It goes in or out whole.
 *
 * Deliberately plain: no formatting, no toolbar. A note here is for holding
 * what a story actually said.
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
  /** Back to the article a quote came from, at the passage itself. */
  onOpenArticle: (link: string, title: string, quote: string) => void;
  onAddComment: (text: string) => void;
  onEditComment: (entryId: string, text: string) => void;
  onRemoveEntry: (entryId: string) => void;
  onOpenMenu?: () => void;
}) {
  const quotes = note.entries.filter((entry) => entry.kind === "quote").length;
  const end = useRef<HTMLTextAreaElement | null>(null);

  /**
   * Tapping the page puts the cursor at the end of it, the way tapping below
   * the text in any document does. Without this the only way in was a 34px
   * strip of empty line under the last quote, with nothing to show it was
   * there — which on a phone reads as a page you simply cannot type on.
   */
  const focusEnd = useCallback((event: React.MouseEvent) => {
    if (event.target !== event.currentTarget) return;
    const el = end.current;
    if (!el) return;
    el.focus();
    el.setSelectionRange(el.value.length, el.value.length);
  }, []);

  return (
    <div className="note-page">
      <div className="main-head">
        {onOpenMenu && (
          <button className="menu-btn" onClick={onOpenMenu} aria-label="Open feeds">
            {Icon.menu}
          </button>
        )}
        <div>
          <h1>{note.name}</h1>
          <p className="sub">
            {quotes === 0 ? "No quotes yet" : `${quotes} quote${quotes === 1 ? "" : "s"}`}
          </p>
        </div>
      </div>

      {/* eslint-disable-next-line jsx-a11y/no-static-element-interactions,
          jsx-a11y/click-events-have-key-events */}
      <div className="note-doc" onClick={focusEnd}>
        {note.entries.length === 0 && (
          <p className="note-hint">
            Highlight anything while reading and choose <strong>Add to note</strong>.
            The quote lands here as written, and the article is kept with it. Type
            anywhere on this page to write your own.
          </p>
        )}

        {note.entries.map((entry) =>
          entry.kind === "quote" ? (
            <Quote
              key={entry.id}
              entry={entry}
              onOpen={() => onOpenArticle(entry.link, entry.articleTitle, entry.text)}
              onRemove={() => onRemoveEntry(entry.id)}
            />
          ) : (
            <Line
              key={entry.id}
              text={entry.text}
              onChange={(text) => onEditComment(entry.id, text)}
              onEmpty={() => onRemoveEntry(entry.id)}
            />
          ),
        )}

        {/* Always a line waiting at the end, so the page can just be typed
            on — and always labelled, because an empty line with no placeholder
            is invisible, and an invisible text box is not one. */}
        <Line
          key={`draft-${note.entries.length}`}
          ref={end}
          text=""
          placeholder="Write a note…"
          onChange={(text) => {
            if (text.trim()) onAddComment(text);
          }}
          once
        />
        {/* The rest of the page: still the document, still tappable. */}
        <div className="note-rest" onClick={focusEnd} />
      </div>
    </div>
  );
}

/** A quote, as the article had it: read-only, and removed whole or not at all. */
function Quote({
  entry,
  onOpen,
  onRemove,
}: {
  entry: Extract<NoteEntry, { kind: "quote" }>;
  onOpen: () => void;
  onRemove: () => void;
}) {
  const [confirming, setConfirming] = useState(false);

  return (
    <div className="note-quote">
      {/* The quote itself goes back to where it came from — but not when
          something in it is selected, which means it is being copied, not
          left behind. */}
      <blockquote
        title="Open this passage in the article"
        onClick={() => {
          if ((window.getSelection()?.toString() ?? "").trim()) return;
          onOpen();
        }}
      >
        {entry.text.split(/\n\n+/).map((para, i) => (
          <p key={i}>{para}</p>
        ))}
      </blockquote>
      <div className="note-quote-foot">
        <button className="note-source" onClick={onOpen}>
          {Icon.back} {entry.articleTitle}
          {entry.sourceTitle ? ` · ${entry.sourceTitle}` : ""}
        </button>
        {confirming ? (
          <span className="note-confirm">
            <button className="link-btn danger" onClick={onRemove}>
              Delete quote
            </button>
            <button className="link-btn" onClick={() => setConfirming(false)}>
              Keep
            </button>
          </span>
        ) : (
          <button
            className="icon-btn danger note-remove"
            aria-label="Delete this quote"
            title="Delete this quote"
            onClick={() => setConfirming(true)}
          >
            {Icon.trash}
          </button>
        )}
      </div>
    </div>
  );
}

/**
 * One of your own lines: ordinary text to look at, a textarea to type in.
 * It grows with what it holds, and empties itself out of the note.
 */
const Line = forwardRef<HTMLTextAreaElement, {
  text: string;
  placeholder?: string;
  onChange: (text: string) => void;
  onEmpty?: () => void;
  /** The waiting line at the end: it hands its text over and starts again. */
  once?: boolean;
}>(function Line({ text, placeholder, onChange, onEmpty, once }, forwarded) {
  const ref = useRef<HTMLTextAreaElement | null>(null);
  const [value, setValue] = useState(text);
  /** The latest text and handler, for the commit on the way out. */
  const latest = useRef({ value, onChange });
  latest.current = { value, onChange };
  /**
   * Whether this line has already been handed over. Committing on blur
   * unmounts this one (the list it joined is longer, so the waiting line is a
   * new one), and the unmount would otherwise hand the same text over a
   * second time — the state that cleared it never got to render.
   */
  const handedOver = useRef(false);

  useEffect(() => setValue(text), [text]);

  // Leaving the page — for another note, or the article a quote came from —
  // keeps what was being typed. Blur alone would miss it: the page can go
  // while the line still has focus.
  useEffect(() => {
    if (!once) return;
    return () => {
      if (handedOver.current) return;
      const { value: last, onChange: commit } = latest.current;
      if (last.trim()) commit(last);
    };
  }, [once]);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, [value]);

  return (
    <textarea
      ref={(el) => {
        ref.current = el;
        if (typeof forwarded === "function") forwarded(el);
        else if (forwarded) forwarded.current = el;
      }}
      className="note-line"
      value={value}
      rows={1}
      placeholder={placeholder}
      onChange={(event) => {
        const next = event.target.value;
        setValue(next);
        if (once) return; // committed on blur, so it becomes a line of its own
        onChange(next);
      }}
      onBlur={() => {
        if (once) {
          if (value.trim()) {
            handedOver.current = true;
            onChange(value);
            setValue("");
          }
          return;
        }
        if (!value.trim()) onEmpty?.();
      }}
    />
  );
});
