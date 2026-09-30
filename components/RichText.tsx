"use client";

import { useEffect, useRef } from "react";
import { sanitizeRichText } from "@/lib/subjects";

/**
 * A small formatted-text field: bold, italic, highlight, bullets, heading.
 *
 * Uncontrolled for the same reason as the note page (components/NotePage.tsx):
 * once it is on screen the browser owns the DOM, because React writing into a
 * contentEditable throws the cursor to the start of the line. It takes its
 * HTML once, and again only when a different device changed it — never from
 * its own keystrokes coming back round.
 */
export default function RichText({
  html,
  onChange,
  placeholder,
  className,
  autoFocus,
}: {
  html: string;
  onChange: (html: string) => void;
  placeholder?: string;
  className?: string;
  autoFocus?: boolean;
}) {
  const el = useRef<HTMLDivElement | null>(null);
  /** The last HTML this field produced or was given. */
  const last = useRef<string>("");
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const handler = useRef(onChange);
  handler.current = onChange;

  useEffect(() => {
    const node = el.current;
    if (!node) return;
    const clean = sanitizeRichText(html);
    // Only replace the DOM for a change that did not come from typing here.
    if (clean !== last.current && document.activeElement !== node) {
      node.innerHTML = clean;
      last.current = clean;
    }
  }, [html]);

  useEffect(() => {
    if (autoFocus) el.current?.focus();
  }, [autoFocus]);

  useEffect(
    () => () => {
      if (timer.current) {
        clearTimeout(timer.current);
        flush();
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  function flush() {
    const node = el.current;
    if (!node) return;
    const clean = sanitizeRichText(node.innerHTML);
    if (clean === last.current) return;
    last.current = clean;
    handler.current(clean);
  }

  function changed() {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      timer.current = null;
      flush();
    }, 400);
  }

  function format(command: string, value?: string) {
    el.current?.focus();
    document.execCommand(command, false, value);
    changed();
  }

  return (
    <div className={`rich ${className ?? ""}`}>
      <div className="rich-tools" onMouseDown={(event) => event.preventDefault()}>
        <button type="button" title="Bold (⌘B)" onClick={() => format("bold")}><b>B</b></button>
        <button type="button" title="Italic (⌘I)" onClick={() => format("italic")}><i>I</i></button>
        <button type="button" title="Highlight" onClick={() => format("hiliteColor", "#fde68a")}>
          <mark>H</mark>
        </button>
        <button type="button" title="Bulleted list" onClick={() => format("insertUnorderedList")}>• List</button>
        <button type="button" title="Heading" onClick={() => format("formatBlock", "h3")}>H3</button>
        <button type="button" title="Plain text" onClick={() => format("formatBlock", "p")}>¶</button>
      </div>
      <div
        ref={el}
        className="rich-body"
        contentEditable
        suppressContentEditableWarning
        data-placeholder={placeholder}
        onInput={changed}
        onBlur={() => {
          if (timer.current) clearTimeout(timer.current);
          timer.current = null;
          flush();
        }}
        onPaste={(event) => {
          // Pasted pages bring their styles with them; take the words only.
          event.preventDefault();
          document.execCommand("insertText", false, event.clipboardData.getData("text/plain"));
        }}
        onKeyDown={(event) => {
          if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "b") {
            event.preventDefault();
            format("bold");
          }
          if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "i") {
            event.preventDefault();
            format("italic");
          }
          // Stop board shortcuts (and dragging) firing from inside a field.
          event.stopPropagation();
        }}
        onPointerDown={(event) => event.stopPropagation()}
      />
    </div>
  );
}
