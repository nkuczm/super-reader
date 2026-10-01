"use client";

import { useEffect, useRef, useState } from "react";
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
  onOpenQuote,
}: {
  /**
   * Quotes in the text are links to their passage. With this set, the caret
   * in one shows a "Go to passage" chip, and ⌘/Ctrl-click follows it.
   */
  onOpenQuote?: (id: string) => void;
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
  /** The quote the caret is in, and where to show its chip. */
  const [inQuote, setInQuote] = useState<{ id: string; top: number; left: number } | null>(null);

  useEffect(() => {
    if (!onOpenQuote) return;
    const check = () => {
      const node = el.current;
      const selection = window.getSelection();
      const anchor = selection?.anchorNode;
      const link =
        node && anchor && node.contains(anchor)
          ? (anchor instanceof Element ? anchor : anchor.parentElement)?.closest<HTMLElement>("a[data-quote]")
          : null;
      if (!link || !node) {
        setInQuote(null);
        return;
      }
      const box = node.parentElement!.getBoundingClientRect();
      const rect = link.getBoundingClientRect();
      setInQuote({ id: link.dataset.quote!, top: rect.top - box.top, left: Math.max(0, rect.left - box.left) });
    };
    document.addEventListener("selectionchange", check);
    return () => document.removeEventListener("selectionchange", check);
  }, [onOpenQuote]);

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
    if (el.current) keepQuotesTight(el.current);
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
      {inQuote && onOpenQuote && (
        <button
          type="button"
          className="quote-chip"
          style={{ top: inQuote.top, left: inQuote.left }}
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => onOpenQuote(inQuote.id)}
        >
          ↗ Go to passage
        </button>
      )}
      <div className="rich-tools" onMouseDown={(event) => event.preventDefault()}>
        <button type="button" title="Bold (⌘B)" onClick={() => format("bold")}><b>B</b></button>
        <button type="button" title="Italic (⌘I)" onClick={() => format("italic")}><i>I</i></button>
        <button type="button" title="Highlight" onClick={() => format("hiliteColor", "#fde68a")}>
          <mark>H</mark>
        </button>
        <button type="button" title="Bulleted list" onClick={() => format("insertUnorderedList")}>• List</button>
        <button type="button" title="Heading" onClick={() => format("formatBlock", "h3")}>H3</button>
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
        onClick={(event) => {
          const link = (event.target as HTMLElement).closest<HTMLElement>("a[data-quote]");
          if (link && onOpenQuote && (event.metaKey || event.ctrlKey)) {
            event.preventDefault();
            onOpenQuote(link.dataset.quote!);
          }
        }}
        onPaste={(event) => {
          // Pasted pages bring their styles with them; take the words only.
          event.preventDefault();
          document.execCommand("insertText", false, event.clipboardData.getData("text/plain"));
        }}
        onKeyDown={(event) => {
          // Tab indents, Shift+Tab outdents: in a list that nests the bullet a
          // level (and changes its style); elsewhere it indents the line.
          if (event.key === "Tab" && !event.metaKey && !event.ctrlKey && !event.altKey) {
            event.preventDefault();
            format(event.shiftKey ? "outdent" : "indent");
            event.stopPropagation();
            return;
          }
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

/**
 * A quote is its words between quotation marks, and nothing else.
 *
 * Browsers keep typing inside a link when the caret sits at its edge, so
 * text written just before or after a quote would silently become part of
 * it — and follow it to the article. After every edit anything outside the
 * marks is moved out of the link, the caret with it. A line break that cloned
 * the link into the next bullet leaves an empty or duplicate copy, which is
 * unwrapped so each quote is linked once.
 */
export function keepQuotesTight(root: HTMLElement) {
  const seen = new Set<string>();
  for (const link of [...root.querySelectorAll<HTMLAnchorElement>("a[data-quote]")]) {
    const id = link.dataset.quote ?? "";
    const text = link.textContent ?? "";
    if (seen.has(id) || !text.trim()) {
      link.replaceWith(...link.childNodes);
      continue;
    }
    seen.add(id);
    // Only a link holding plain text is trimmed; one with formatting inside
    // is left alone rather than risk mangling it.
    if (link.childNodes.length !== 1 || link.firstChild?.nodeType !== Node.TEXT_NODE) continue;
    const open = text.indexOf("\u201c");
    const close = text.lastIndexOf("\u201d");
    if (open < 0 || close < open) continue;
    const before = text.slice(0, open);
    const after = text.slice(close + 1);
    if (!before && !after) continue;
    const selection = window.getSelection();
    const caretInside = selection?.anchorNode === link.firstChild;
    const caretAt = selection?.anchorOffset ?? 0;
    link.firstChild!.textContent = text.slice(open, close + 1);
    let caretNode: Text | null = null;
    let caretOffset = 0;
    if (before) {
      const node = document.createTextNode(before);
      link.before(node);
      if (caretInside && caretAt <= open) {
        caretNode = node;
        caretOffset = caretAt;
      }
    }
    if (after) {
      const node = document.createTextNode(after);
      link.after(node);
      if (caretInside && caretAt > close) {
        caretNode = node;
        caretOffset = caretAt - close - 1;
      }
    }
    if (caretNode && selection) {
      const range = document.createRange();
      range.setStart(caretNode, Math.min(caretOffset, caretNode.length));
      range.collapse(true);
      selection.removeAllRanges();
      selection.addRange(range);
    }
  }
}
