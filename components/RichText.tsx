"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { sanitizeRichText } from "@/lib/subjects";
import { cleanPastedHtml } from "@/lib/paste";

/** The drag type a drawing or image box carries, for dropping into text. */
export const EMBED_TYPE = "application/x-super-reader-box";

/** Arrows typed out, and what they become. */
const ARROWS: [string, string][] = [["<-->", "↔"], ["←>", "↔"], ["-->", "→"], ["<--", "←"]];

/** The height of Safari's floating form bar (✓ and arrows) above an iPhone keyboard, with a little air. */
const IOS_ACCESSORY_BAR = 50;

function caretRangeAt(x: number, y: number): Range | null {
  const doc = document as Document & {
    caretRangeFromPoint?: (x: number, y: number) => Range | null;
    caretPositionFromPoint?: (x: number, y: number) => { offsetNode: Node; offset: number } | null;
  };
  if (doc.caretRangeFromPoint) return doc.caretRangeFromPoint(x, y);
  const pos = doc.caretPositionFromPoint?.(x, y);
  if (!pos) return null;
  const range = document.createRange();
  range.setStart(pos.offsetNode, pos.offset);
  range.collapse(true);
  return range;
}

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
  resolveEmbed,
  onEmbed,
  onDropImage,
}: {
  /** A picture file dropped on the text: keep it, and say which box holds it. */
  onDropImage?: (file: File) => Promise<string | null>;
  /** The picture for a drawing or image set into the text, by its box id. */
  resolveEmbed?: (id: string) => string | undefined;
  /** A drawing or image box was dropped into the text: it now lives here. */
  onEmbed?: (id: string) => void;
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
  /** The caret is in a link of the writer's own: where to offer opening it. */
  const [inLink, setInLink] = useState<{ href: string; top: number; left: number } | null>(null);
  /** Making a link: the text it goes on, and the address being typed. */
  const [linking, setLinking] = useState<{ range: Range; value: string } | null>(null);
  /** A picture in the text under the pointer, and where its corner pin goes. */
  const [pinFor, setPinFor] = useState<{ img: HTMLImageElement; left: number; top: number } | null>(null);
  const wrap = useRef<HTMLDivElement | null>(null);

  function placePin(img: HTMLImageElement | null) {
    const box = wrap.current?.getBoundingClientRect();
    if (!img || !box) return setPinFor(null);
    const r = img.getBoundingClientRect();
    setPinFor({ img, left: r.right - box.left, top: r.bottom - box.top });
  }

  /** Drag the corner: the picture follows, any size the text has room for. */
  function startSizing(event: React.PointerEvent) {
    const img = pinFor?.img;
    const node = el.current;
    if (!img || !node) return;
    event.preventDefault();
    event.stopPropagation();
    const startX = event.clientX;
    const startW = img.getBoundingClientRect().width;
    const max = node.clientWidth;
    const target = event.currentTarget as HTMLElement;
    target.setPointerCapture(event.pointerId);
    const move = (e: PointerEvent) => {
      const w = Math.round(Math.min(max, Math.max(60, startW + (e.clientX - startX))));
      img.style.width = `${w}px`;
      img.setAttribute("data-w", String(w));
      placePin(img);
    };
    const up = () => {
      target.removeEventListener("pointermove", move);
      target.removeEventListener("pointerup", up);
      changed();
    };
    target.addEventListener("pointermove", move);
    target.addEventListener("pointerup", up);
  }

  useEffect(() => {
    const checkLink = () => {
      const node = el.current;
      const anchor = window.getSelection()?.anchorNode;
      const link =
        node && anchor && node.contains(anchor)
          ? (anchor instanceof Element ? anchor : anchor.parentElement)?.closest<HTMLAnchorElement>("a[href]")
          : null;
      if (!link || !node) return setInLink(null);
      const box = node.parentElement!.getBoundingClientRect();
      const rect = link.getBoundingClientRect();
      setInLink({ href: link.href, top: rect.bottom - box.top + 4, left: Math.max(0, rect.left - box.left) });
    };
    document.addEventListener("selectionchange", checkLink);
    return () => document.removeEventListener("selectionchange", checkLink);
  }, []);

  /** Open the address field for the selected text (or the link the caret is in). */
  function startLink() {
    const node = el.current;
    const selection = window.getSelection();
    if (!node || !selection || selection.rangeCount === 0 || !node.contains(selection.anchorNode)) return;
    const range = selection.getRangeAt(0).cloneRange();
    const anchor = selection.anchorNode;
    const existing = (anchor instanceof Element ? anchor : anchor?.parentElement)?.closest<HTMLAnchorElement>("a[href]");
    if (existing && range.collapsed) range.selectNodeContents(existing);
    setLinking({ range, value: existing?.getAttribute("href") ?? "" });
  }

  /** Put the link on the text — or take it off, given an empty address. */
  function applyLink(raw: string) {
    const target = linking;
    setLinking(null);
    const node = el.current;
    if (!target || !node) return;
    node.focus();
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(target.range);
    const value = raw.trim();
    if (!value) {
      document.execCommand("unlink");
      changed();
      return;
    }
    const href = /^[a-z][a-z0-9+.-]*:/i.test(value) ? value : `https://${value}`;
    if (!/^https?:\/\//i.test(href)) return;
    if (target.range.collapsed) {
      const a = document.createElement("a");
      a.href = href;
      a.textContent = value;
      document.execCommand("insertHTML", false, a.outerHTML);
    } else {
      document.execCommand("createLink", false, href);
    }
    changed();
  }

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
    fillEmbeds();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [html, resolveEmbed]);

  /** Give each embedded drawing or picture its image; the src is never saved. */
  function fillEmbeds() {
    const node = el.current;
    if (!node || !resolveEmbed) return;
    node.querySelectorAll<HTMLImageElement>("img[data-embed]").forEach((img) => {
      const src = resolveEmbed(img.dataset.embed!);
      if (src && img.getAttribute("src") !== src) img.setAttribute("src", src);
      img.classList.add("rt-embed");
      img.setAttribute("draggable", "false");
      const w = Number(img.getAttribute("data-w"));
      img.style.width = w ? `${w}px` : "";
    });
  }

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

  const swipe = useRef<{ x: number; y: number } | null>(null);

  /**
   * On a phone, while this box is being written in, the toolbar rides just
   * above the keyboard instead of sitting at the top of a box that may be a
   * long scroll away. The visual viewport says where the keyboard begins;
   * the page keeps room under the caret so the line being typed is never
   * behind the toolbar.
   */
  const tools = useRef<HTMLDivElement | null>(null);
  const [docked, setDocked] = useState(false);
  const [kbBottom, setKbBottom] = useState(0);
  useEffect(() => {
    if (!docked) return;
    const vv = window.visualViewport;
    const scroller = wrap.current?.closest<HTMLElement>(".main") ?? null;
    // Safari on iPhone floats its own ✓ / arrows bar over the page just above
    // the keyboard, inside what it reports as visible — so the toolbar would
    // sit behind it. With the keyboard up, it goes above that bar instead.
    const ios = /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
    const place = () => {
      const keyboard = vv ? Math.max(0, window.innerHeight - (vv.offsetTop + vv.height)) : 0;
      const bottom = keyboard + (ios && keyboard > 80 ? IOS_ACCESSORY_BAR : 0);
      setKbBottom(bottom);
      // The caret's line stays above the toolbar.
      const sel = window.getSelection();
      const bar = tools.current?.getBoundingClientRect();
      if (!sel?.rangeCount || !bar || !scroller) return;
      const r = sel.getRangeAt(0).getBoundingClientRect();
      if (r.height && r.bottom > bar.top - 8) scroller.scrollBy({ top: r.bottom - bar.top + 16 });
    };
    if (scroller) scroller.style.scrollPaddingBottom = "64px";
    place();
    // The keyboard slides in after focus, and iOS reports its size late.
    const later = [120, 350, 700].map((ms) => setTimeout(place, ms));
    vv?.addEventListener("resize", place);
    vv?.addEventListener("scroll", place);
    document.addEventListener("selectionchange", place);
    return () => {
      vv?.removeEventListener("resize", place);
      vv?.removeEventListener("scroll", place);
      document.removeEventListener("selectionchange", place);
      if (scroller) scroller.style.scrollPaddingBottom = "";
      later.forEach(clearTimeout);
    };
  }, [docked]);
  const coarse = () => typeof window !== "undefined" && window.matchMedia?.("(pointer: coarse)").matches;

  /** The list the caret is in, if any. */
  function listAtCaret(): HTMLUListElement | null {
    const node = window.getSelection()?.anchorNode;
    const elNode = node && (node.nodeType === 1 ? (node as Element) : node.parentElement);
    const list = elNode?.closest("ul");
    return list && el.current?.contains(list) ? (list as HTMLUListElement) : null;
  }

  /** Lines into a checklist, or a checklist back into plain lines. */
  function toggleChecklist() {
    el.current?.focus();
    const list = listAtCaret();
    if (list?.hasAttribute("data-check")) {
      document.execCommand("insertUnorderedList");
    } else {
      if (!list) document.execCommand("insertUnorderedList");
      listAtCaret()?.setAttribute("data-check", "");
    }
    changed();
  }

  /**
   * The highlight button as a toggle: over highlighted text it takes the
   * highlight off; anywhere else it puts one on.
   */
  function toggleHighlight() {
    const root = el.current;
    const sel = window.getSelection();
    if (!root || !sel || sel.rangeCount === 0) return format("hiliteColor", "#fde68a");
    const range = sel.getRangeAt(0);
    const lit = [...root.querySelectorAll<HTMLElement>("mark, span[style*='background']")].filter((node) => {
      if (range.intersectsNode(node)) return true;
      return node.contains(range.startContainer);
    });
    if (lit.length === 0) return format("hiliteColor", "#fde68a");
    for (const node of lit) node.replaceWith(...node.childNodes);
    root.normalize();
    changed();
  }

  /** "-->" becomes →, "<--" becomes ←, and ← followed by ">" becomes ↔, as they are typed. */
  function typeArrow() {
    const sel = window.getSelection();
    const node = sel?.anchorNode;
    if (!sel?.isCollapsed || !node || node.nodeType !== Node.TEXT_NODE) return;
    const text = node.textContent ?? "";
    const end = sel.anchorOffset;
    const before = text.slice(0, end);
    const rule = ARROWS.find(([typed]) => before.endsWith(typed));
    if (!rule) return;
    const [typed, arrow] = rule;
    node.textContent = before.slice(0, -typed.length) + arrow + text.slice(end);
    const at = end - typed.length + arrow.length;
    const range = document.createRange();
    range.setStart(node, at);
    range.collapse(true);
    sel.removeAllRanges();
    sel.addRange(range);
  }

  function format(command: string, value?: string) {
    el.current?.focus();
    document.execCommand(command, false, value);
    changed();
  }

  const toolbar = (
    <div ref={tools} className={`rich-tools${docked ? " docked" : ""}`} style={docked ? { bottom: kbBottom } : undefined}
      onMouseDown={(event) => event.preventDefault()}>
      {docked && (
        <>
          <button type="button" className="rich-undo" title="Undo" aria-label="Undo" onClick={() => format("undo")}>↶</button>
          <button type="button" className="rich-undo" title="Redo" aria-label="Redo" onClick={() => format("redo")}>↷</button>
        </>
      )}
      <button type="button" title="Bold (⌘B)" onClick={() => format("bold")}><b>B</b></button>
      <button type="button" title="Italic (⌘I)" onClick={() => format("italic")}><i>I</i></button>
      <button type="button" title="Highlight (again to remove)" onClick={toggleHighlight}>
        <mark>H</mark>
      </button>
      <button type="button" title="Bulleted list (⌘⇧8)" onClick={() => format("insertUnorderedList")}>• List</button>
      <button type="button" title="Checklist (⌘⇧9)" onClick={toggleChecklist}>☐ Check</button>
      <button type="button" title="Heading" onClick={() => format("formatBlock", "h3")}>H3</button>
      <button type="button" title="Link (⌘K)" onClick={startLink}>Link</button>
      {docked && (
        <button type="button" className="rich-done" title="Done — close the keyboard"
          aria-label="Done — close the keyboard"
            onClick={() => { (document.activeElement as HTMLElement | null)?.blur?.(); setDocked(false); }}>✓</button>
      )}
    </div>
  );

  return (
    <div className={`rich ${className ?? ""}`} ref={wrap} onMouseLeave={() => setPinFor(null)}
      onFocus={() => coarse() && setDocked(true)}
      onBlur={() => setTimeout(() => {
        if (!wrap.current?.contains(document.activeElement)) setDocked(false);
      }, 0)}>
      {pinFor && (
        <span
          className="embed-size-pin"
          style={{ left: pinFor.left, top: pinFor.top }}
          role="separator"
          aria-label="Drag to resize the picture"
          title="Drag to resize"
          onPointerDown={startSizing}
          onMouseDown={(e) => e.preventDefault()}
        />
      )}
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
      {/* Docked, the toolbar lives at the top of the page: inside a scaled
          whiteboard, "fixed" would mean fixed to the board, not the screen. */}
      {docked && typeof document !== "undefined" ? createPortal(toolbar, document.body) : toolbar}
      {linking && (
        <form
          className="rich-link-field"
          onSubmit={(event) => {
            event.preventDefault();
            applyLink(linking.value);
          }}
        >
          <input
            className="input"
            autoFocus
            type="text"
            inputMode="url"
            placeholder="Paste or type a link"
            value={linking.value}
            onChange={(event) => setLinking({ ...linking, value: event.target.value })}
            onKeyDown={(event) => {
              if (event.key === "Escape") {
                event.preventDefault();
                setLinking(null);
                el.current?.focus();
              }
            }}
          />
          <button className="btn small">Apply</button>
          {linking.value && (
            <button type="button" className="link-btn" onClick={() => applyLink("")}>Remove</button>
          )}
        </form>
      )}
      {inLink && !linking && (
        <a className="quote-chip link-chip" style={{ top: inLink.top, left: inLink.left }} href={inLink.href}
          target="_blank" rel="noopener noreferrer" onMouseDown={(event) => event.preventDefault()}>
          ↗ Open link
        </a>
      )}
      <div
        ref={el}
        className="rich-body"
        contentEditable
        suppressContentEditableWarning
        data-placeholder={placeholder}
        onInput={(event) => {
          if ((event.nativeEvent as InputEvent).inputType === "insertText") typeArrow();
          changed();
        }}
        onTouchStart={(event) => {
          const t = event.touches[0];
          swipe.current = event.touches.length === 1 ? { x: t.clientX, y: t.clientY } : null;
        }}
        onTouchEnd={(event) => {
          // On a phone, swipe right across a line to indent it, left to
          // outdent — Tab and Shift+Tab without a keyboard.
          const start = swipe.current;
          swipe.current = null;
          const t = event.changedTouches[0];
          if (!start || !t) return;
          const dx = t.clientX - start.x;
          const dy = t.clientY - start.y;
          if (Math.abs(dx) < 50 || Math.abs(dy) > 30 || Math.abs(dx) < 2 * Math.abs(dy)) return;
          const range = caretRangeAt(start.x, start.y);
          if (range && el.current?.contains(range.startContainer)) {
            const sel = window.getSelection();
            sel?.removeAllRanges();
            sel?.addRange(range);
          }
          event.preventDefault();
          format(dx > 0 ? "indent" : "outdent");
        }}
        onBlur={() => {
          if (timer.current) clearTimeout(timer.current);
          timer.current = null;
          flush();
        }}
        onClick={(event) => {
          // A click on a checklist item's box ticks it.
          const item = (event.target as HTMLElement).closest<HTMLLIElement>("ul[data-check] > li");
          if (item && event.clientX < item.getBoundingClientRect().left) {
            event.preventDefault();
            if (item.getAttribute("data-checked") === "true") item.removeAttribute("data-checked");
            else item.setAttribute("data-checked", "true");
            changed();
            return;
          }
          const web = (event.target as HTMLElement).closest<HTMLAnchorElement>("a[href]");
          if (web && (event.metaKey || event.ctrlKey)) {
            event.preventDefault();
            window.open(web.href, "_blank", "noopener,noreferrer");
            return;
          }
          const link = (event.target as HTMLElement).closest<HTMLElement>("a[data-quote]");
          if (link && onOpenQuote && (event.metaKey || event.ctrlKey)) {
            event.preventDefault();
            onOpenQuote(link.dataset.quote!);
          }
        }}
        onPaste={(event) => {
          // Formatting comes with a paste — bullets, nesting, bold, italic,
          // highlight — translated from Google Docs' clipboard shape and
          // cleaned (lib/paste.ts). Plain text when that is all there is.
          event.preventDefault();
          // A picture on the clipboard — a screenshot, an image copied from a
          // page — is set into the text at the caret, as a dropped one is.
          const pictures = onDropImage
            ? [...event.clipboardData.items].filter((i) => i.kind === "file" && i.type.startsWith("image/")).map((i) => i.getAsFile()).filter((f): f is File => !!f)
            : [];
          if (pictures.length > 0) {
            const node = el.current;
            const at = window.getSelection()?.rangeCount ? window.getSelection()!.getRangeAt(0).cloneRange() : null;
            void (async () => {
              const ids: string[] = [];
              for (const file of pictures.slice(0, 6)) {
                const id = await onDropImage!(file);
                if (id) ids.push(id);
              }
              if (!node || ids.length === 0) return;
              node.focus();
              const selection = window.getSelection();
              selection?.removeAllRanges();
              if (at && node.contains(at.startContainer)) selection?.addRange(at);
              document.execCommand("insertHTML", false, ids.map((id) => `<p><img data-embed="${id}"></p>`).join("") + "<p><br></p>");
              fillEmbeds();
              changed();
            })();
            return;
          }
          // An address pasted over selected words links them, as in a Doc.
          const plain = event.clipboardData.getData("text/plain").trim();
          const selected = window.getSelection();
          if (selected && !selected.isCollapsed && /^https?:\/\/\S+$/i.test(plain)) {
            document.execCommand("createLink", false, plain);
            changed();
            return;
          }
          const html = event.clipboardData.getData("text/html");
          if (html) {
            const clean = cleanPastedHtml(html);
            if (clean.trim()) {
              document.execCommand("insertHTML", false, clean);
              changed();
              return;
            }
          }
          document.execCommand("insertText", false, event.clipboardData.getData("text/plain"));
          changed();
        }}
        onMouseMove={(event) => {
          const img = (event.target as HTMLElement).closest?.("img.rt-embed") as HTMLImageElement | null;
          if (img) placePin(img);
        }}
        onDragOver={(event) => {
          if (onDropImage && event.dataTransfer.types.includes("Files")) {
            event.preventDefault();
            event.dataTransfer.dropEffect = "copy";
            return;
          }
          if (onEmbed && event.dataTransfer.types.includes(EMBED_TYPE)) {
            event.preventDefault();
            event.dataTransfer.dropEffect = "move";
          }
        }}
        onDrop={(event) => {
          // A photo from the desktop or another page: kept small, set in the
          // text where it was let go.
          const files = onDropImage ? [...event.dataTransfer.files].filter((f) => f.type.startsWith("image/")) : [];
          if (files.length > 0) {
            event.preventDefault();
            event.stopPropagation();
            const node = el.current;
            if (!node) return;
            const range = caretRangeAt(event.clientX, event.clientY);
            void (async () => {
              const ids: string[] = [];
              for (const file of files.slice(0, 6)) {
                const id = await onDropImage!(file);
                if (id) ids.push(id);
              }
              if (ids.length === 0) return;
              node.focus();
              const selection = window.getSelection();
              selection?.removeAllRanges();
              if (range && node.contains(range.startContainer)) selection?.addRange(range);
              else {
                const end = document.createRange();
                end.selectNodeContents(node);
                end.collapse(false);
                selection?.addRange(end);
              }
              document.execCommand("insertHTML", false, ids.map((id) => `<p><img data-embed="${id}"></p>`).join("") + "<p><br></p>");
              fillEmbeds();
              changed();
            })();
            return;
          }
          const id = onEmbed ? event.dataTransfer.getData(EMBED_TYPE) : "";
          if (!id) return;
          event.preventDefault();
          event.stopPropagation();
          const node = el.current;
          if (!node) return;
          // Where it was let go: on its own line there, breaking the text.
          const range = caretRangeAt(event.clientX, event.clientY);
          node.focus();
          const selection = window.getSelection();
          if (range && node.contains(range.startContainer)) {
            selection?.removeAllRanges();
            selection?.addRange(range);
          } else {
            const end = document.createRange();
            end.selectNodeContents(node);
            end.collapse(false);
            selection?.removeAllRanges();
            selection?.addRange(end);
          }
          document.execCommand("insertHTML", false, `<p><img data-embed="${id}"></p><p><br></p>`);
          fillEmbeds();
          onEmbed!(id);
          changed();
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
          if ((event.metaKey || event.ctrlKey) && !event.shiftKey && event.key.toLowerCase() === "k") {
            event.preventDefault();
            event.stopPropagation();
            startLink();
            return;
          }
          // ⌘⇧8 / Ctrl+Shift+8: bulleted list, as in Google Docs. By the key's
          // place, not its character — Shift+8 types "*" on one layout and
          // "(" on another.
          if ((event.metaKey || event.ctrlKey) && event.shiftKey && event.code === "Digit9") {
            event.preventDefault();
            event.stopPropagation();
            toggleChecklist();
            return;
          }
          // A new line in a checklist starts unticked, whatever the line before was.
          if (event.key === "Enter" && listAtCaret()?.hasAttribute("data-check")) {
            setTimeout(() => {
              const node = window.getSelection()?.anchorNode;
              const li = (node && (node.nodeType === 1 ? (node as Element) : node.parentElement))?.closest("li");
              if (li && !li.textContent?.trim()) li.removeAttribute("data-checked");
            }, 0);
          }
          if ((event.metaKey || event.ctrlKey) && event.shiftKey && event.code === "Digit8") {
            event.preventDefault();
            format("insertUnorderedList");
            event.stopPropagation();
            return;
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
