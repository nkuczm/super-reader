"use client";

import { Fragment, useCallback, useMemo, useRef, useState } from "react";
import { Icon } from "./icons";
import { isQuote, type Note, type NoteEntry } from "@/lib/notes";
import { CARET_SPACE, flowOf, foldFlow, readFlow } from "@/lib/note-flow";

/**
 * One note: a page of writing with the quotes highlighted in it.
 *
 * It is a single text box, not a stack of fields. The quoted passages sit in
 * the writing as highlighted words, so the cursor goes either side of one and
 * carries on. A quote cannot be rewritten — it says what the article said —
 * but it comes out whole, either with the cross beside it or with a backspace
 * from the character after it, the way any other thing in a line of text does.
 *
 * Deliberately plain: no formatting, no toolbar.
 */
export default function NotePage({
  note,
  onOpenArticle,
  onCommitEntries,
  onOpenMenu,
}: {
  note: Note;
  /** Back to the article a quote came from, at the passage itself. */
  onOpenArticle: (link: string, title: string, quote: string) => void;
  /**
   * The note's contents after an edit, and every entry the page knew of when
   * it made them — so that anything which arrived meanwhile is not mistaken
   * for something the reader deleted.
   */
  onCommitEntries: (entries: NoteEntry[], known: ReadonlySet<string>) => void;
  onOpenMenu?: () => void;
}) {
  const quotes = note.entries.filter(isQuote).length;

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

      {/* Keyed by the note, so opening another one builds a fresh page rather
          than editing this one's DOM into that one's. */}
      <NoteFlow
        key={note.id}
        initialEntries={note.entries}
        onOpenArticle={onOpenArticle}
        onCommit={onCommitEntries}
      />
    </div>
  );
}

/**
 * The writing surface.
 *
 * Rendered once, from the entries the note had when the page opened, and then
 * left alone: after that the browser owns this DOM. React re-rendering into a
 * contentEditable is what throws the cursor back to the start of the line
 * mid-sentence, so this component holds no state at all — every edit is read
 * back out of the DOM and handed upwards, and the placeholder is shown and
 * hidden through a ref rather than by rendering again.
 */
function NoteFlow({
  initialEntries,
  onOpenArticle,
  onCommit,
}: {
  initialEntries: NoteEntry[];
  onOpenArticle: (link: string, title: string, quote: string) => void;
  onCommit: (entries: NoteEntry[], known: ReadonlySet<string>) => void;
}) {
  const surface = useRef<HTMLDivElement | null>(null);
  const hint = useRef<HTMLParagraphElement | null>(null);
  /** What the note held at the last read, for the next fold to build on. */
  const entries = useRef<NoteEntry[]>(initialEntries);
  /**
   * The page as it stood when it opened, and never again.
   *
   * Every commit hands a new entries array upwards and it comes straight back
   * down as a prop, so anything derived from the prop is derived afresh on
   * every keystroke — and React writing that back into a contentEditable puts
   * the cursor at the start of the line each time. Typed "He " and the page
   * held " eH". Captured at mount instead, through the one hook that promises
   * to run its initialiser once.
   */
  const [pieces] = useState(() => flowOf(initialEntries));
  /**
   * The callbacks, reachable from JSX that must not be rebuilt to see them.
   */
  const handlers = useRef({ onOpenArticle, onCommit });
  handlers.current = { onOpenArticle, onCommit };

  const commit = useCallback(() => {
    const el = surface.current;
    if (!el) return;
    const { quoteIds, runs } = readFlow(el);
    const known = new Set(entries.current.map((entry) => entry.id));
    const next = foldFlow(entries.current, quoteIds, runs);
    entries.current = next;
    if (hint.current) hint.current.hidden = next.length > 0;
    handlers.current.onCommit(next, known);
  }, []);

  /**
   * Enter puts in a line break and nothing else.
   *
   * Left to itself the browser answers Enter by cutting the page into nested
   * blocks of its own invention, which the quotes then live somewhere inside.
   * A plain newline in the text keeps this a flat run of words and highlights,
   * which is the only reason reading it back is simple.
   */
  const insertText = useCallback((text: string) => {
    const el = surface.current;
    const selection = window.getSelection();
    if (!el || !selection || selection.rangeCount === 0) return;
    const range = selection.getRangeAt(0);
    range.deleteContents();
    const node = document.createTextNode(text);
    range.insertNode(node);

    let caretNode: Text = node;
    let caretOffset = node.length;

    // A line break with nothing after it has nowhere to put the cursor, so
    // the browser leaves it in front of the break and the next thing typed
    // lands back on the line above. A standing space gives it somewhere to
    // be; it is stripped on the way back out, like the others.
    const after = document.createRange();
    after.setStartAfter(node);
    after.setEnd(el, el.childNodes.length);
    if (text.includes("\n") && after.toString().length === 0) {
      const standing = document.createTextNode(CARET_SPACE);
      node.parentNode?.insertBefore(standing, node.nextSibling);
      caretNode = standing;
      caretOffset = 0;
    }

    const caret = document.createRange();
    caret.setStart(caretNode, caretOffset);
    caret.collapse(true);
    selection.removeAllRanges();
    selection.addRange(caret);
  }, []);

  const written = useMemo(
    () =>
      pieces.map((piece, index) =>
        piece.kind === "text" ? (
          // Never nothing: an empty run still needs somewhere for the cursor
          // to go. Between two quotes that has to be a real space you can aim
          // at — a hair's width of nothing there means the tap lands on a
          // highlight instead, and opens the article rather than letting you
          // write. Elsewhere a zero-width space does, since the start of the
          // line and the rest of the page are targets of their own.
          <Fragment key={`text-${index}`}>
            {piece.text ||
              (index > 0 && index < pieces.length - 1 ? " " : CARET_SPACE)}
          </Fragment>
        ) : (
          /* The quoted words themselves, highlighted where they sit. One
             thing to the cursor: it cannot be typed into, and a backspace
             from the character after it takes the whole quote out — which is
             the only way it goes, and how deleting a quote was always meant
             to work. Nothing else sits beside it in the line, because a
             button there would be exactly where a reader clicks to write
             after the quote. */
          <mark
            key={piece.quote.id}
            className="note-quote-mark"
            data-quote-id={piece.quote.id}
            contentEditable={false}
            title={`From “${piece.quote.articleTitle}”${
              piece.quote.sourceTitle ? ` · ${piece.quote.sourceTitle}` : ""
            } — open it there`}
            onClick={() => {
              // Selecting inside a quote means copying it, not leaving.
              if ((window.getSelection()?.toString() ?? "").trim()) return;
              handlers.current.onOpenArticle(
                piece.quote.link,
                piece.quote.articleTitle,
                piece.quote.text,
              );
            }}
          >
            {piece.quote.text}
          </mark>
        ),
      ),
    [pieces],
  );

  return (
    <div className="note-doc">
      <p className="note-hint" ref={hint} hidden={initialEntries.length > 0}>
        Highlight anything while reading and choose <strong>Add to note</strong>.
        The quote lands here as written, and the article is kept with it. Type
        anywhere on this page to write around it.
      </p>

      <div
        ref={surface}
        className="note-flow"
        contentEditable
        suppressContentEditableWarning
        role="textbox"
        aria-multiline="true"
        aria-label="Note"
        onInput={commit}
        onKeyDown={(event) => {
          if (event.key !== "Enter") return;
          event.preventDefault();
          insertText("\n");
          commit();
        }}
        onPaste={(event) => {
          // Plain text only: this page holds words and quotes, and nothing
          // pasted in should be able to bring styling — or a stray element a
          // quote could end up hiding inside — with it.
          event.preventDefault();
          insertText(event.clipboardData.getData("text/plain"));
          commit();
        }}
      >
        {written}
      </div>
    </div>
  );
}
