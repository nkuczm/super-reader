"use client";

import { createContext, useContext, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import CropDialog, { copyPicture, pastedWidth } from "./CropDialog";
import { sanitizeRichText } from "@/lib/subjects";
import { cleanPastedHtml } from "@/lib/paste";
import { CITE_OPEN_EVENT, CITE_TYPE, CITES_CHANGED_EVENT, citeCardHtml, citeChipHtml, citeFor, citeTextHtml, refreshCiteChips, type Cite } from "@/lib/cite";
import { refreshSubjectChips, subjectChipHtml, subjectsMatching, SUBJECT_OPEN_EVENT, SUBJECTS_CHANGED_EVENT, type SubjectRef } from "@/lib/subject-links";

/**
 * Where the text tools go instead of beside the text: the document gives its
 * one fixed bar at the top, so the buttons stay put whichever block is being
 * written in, rather than moving with the caret.
 */
export const ToolsHostContext = createContext<HTMLElement | null>(null);

/** The tools as the fixed bar shows them before any text has been clicked into. */
export const TOOL_LABELS = ["↶", "↷", "B", "I", "H", "• List", "1. List", "a. List", "☐ Check", "H3", "Link", "◈ Subject"];

/** The drag type a drawing or image box carries, for dropping into text. */
export const EMBED_TYPE = "application/x-super-reader-box";

/** Arrows typed out, and what they become. */
const ARROWS: [string, string][] = [["<-->", "↔"], ["←>", "↔"], ["-->", "→"], ["<--", "←"]];

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

/** Put the caret where a point is, inside the field — or at its end. */
function caretInto(node: HTMLElement, x: number, y: number) {
  const range = caretRangeAt(x, y);
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
}

/** The caret so many characters into an element's text. */
function caretAtText(root: Node, offset: number) {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let left = offset;
  const range = document.createRange();
  range.selectNodeContents(root);
  range.collapse(true);
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    const length = n.nodeValue?.length ?? 0;
    if (left <= length) {
      range.setStart(n, left);
      range.collapse(true);
      break;
    }
    left -= length;
  }
  const sel = window.getSelection();
  sel?.removeAllRanges();
  sel?.addRange(range);
}

/**
 * A citation chip at the caret, with a space after it so writing carries on
 * past it. Put straight into the text: the browser's insertHTML, at the end
 * of a line, sets an inline chip outside its paragraph.
 */
function insertChip(cite: Cite) {
  const selection = window.getSelection();
  if (!selection?.rangeCount) return;
  const range = selection.getRangeAt(0);
  range.deleteContents();
  const holder = document.createElement("span");
  // On a line (or a bullet) of its own the story goes in as a card; among words, as a chip.
  holder.innerHTML = onEmptyLine() ? citeCardHtml(cite) : citeChipHtml(cite);
  const chip = holder.firstChild!;
  range.insertNode(chip);
  const space = document.createTextNode("\u00a0");
  chip.parentNode!.insertBefore(space, chip.nextSibling);
  const after = document.createRange();
  after.setStart(space, 1);
  after.collapse(true);
  selection.removeAllRanges();
  selection.addRange(after);
}

/** Whether the caret is on a line — a paragraph, a bullet — with nothing else on it. */
function onEmptyLine(): boolean {
  const selection = window.getSelection();
  const at = selection?.anchorNode;
  if (!selection?.isCollapsed || !at) return false;
  const holder = (at instanceof Element ? at : at.parentElement)?.closest("li, p, div, h3, blockquote, .rich-body");
  if (!holder) return false;
  return !(holder.textContent ?? "").replace(/[\u200b\u00a0\s]/g, "") && !holder.querySelector("img, a[data-cite], a[data-subject]");
}

/**
 * The browser leaves the caret inside a chip it has just put in, where
 * nothing can be typed: move it out past the chip, and put a space there so
 * writing carries on.
 */
function stepPastChip() {
  const selection = window.getSelection();
  const at = selection?.anchorNode;
  const chip = (at instanceof Element ? at : at?.parentElement)?.closest("a[data-cite=chip], a[data-cite=card], a[data-subject]");
  if (!selection || !chip) return;
  const after = document.createRange();
  after.setStartAfter(chip);
  after.collapse(true);
  selection.removeAllRanges();
  selection.addRange(after);
  document.execCommand("insertText", false, "\u00a0");
}

/**
 * A story card let go over some text (the whiteboard drags cards by pointer,
 * not by the browser's drag and drop): its citation chip goes in where it
 * landed. True when there was text there to take it.
 */
export function dropCiteAt(x: number, y: number, cite: Cite, except?: Element | null): boolean {
  const node = document.elementsFromPoint(x, y)
    .map((el) => el.closest<HTMLElement>(".rich-body"))
    .find((el): el is HTMLElement => !!el && !except?.contains(el));
  if (!node) return false;
  caretInto(node, x, y);
  insertChip(cite);
  return true;
}

/** A click on a citation: its card, or the story itself with ⌘/Ctrl. True when handled. */
export function followCite(target: EventTarget | null, event: { metaKey: boolean; ctrlKey: boolean; preventDefault: () => void }): boolean {
  const cite = (target as HTMLElement | null)?.closest?.<HTMLAnchorElement>("a[data-cite]");
  if (!cite) return false;
  event.preventDefault();
  if (event.metaKey || event.ctrlKey) window.open(cite.href, "_blank", "noopener,noreferrer");
  else window.dispatchEvent(new CustomEvent(CITE_OPEN_EVENT, { detail: cite.href }));
  return true;
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
  onTab,
  onFormat,
  onReplaceEmbed,
  toolsBeside,
  quoteSource,
  onPasteLink,
}: {
  /** A lone address pasted at the caret: make it a story of the subject, and return its citation to set in as a chip. */
  onPasteLink?: (url: string) => Cite | null;
  /** The story this text's quotes come from: copied out, they stay linked to it. */
  quoteSource?: Cite;
  /** Keep the text tools beside the card always (as in a table, where they would otherwise move the table or cover it). */
  toolsBeside?: boolean;
  /** A picture set into the text was cropped: its box takes the new picture. */
  onReplaceEmbed?: (id: string, image: string) => void;
  /** A formatting command about to run; return true to say it was handled elsewhere (several table cells at once). */
  onFormat?: (command: string, value?: string) => boolean;
  /** Tab outside a list goes here instead of indenting (a table cell moves to the next cell). */
  onTab?: (back: boolean) => void;
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
  /**
   * Linking a subject: "[[" typed (or the toolbar's Subject button) opens a
   * list of subjects under the caret, filtered by what is typed after it.
   */
  const [subjectPick, setSubjectPick] = useState<{ query: string; left: number; top: number; index: number } | null>(null);
  /** What is typed just before the caret, when it is "[[" and a name being looked for. */
  const subjectQuery = () => {
    const sel = window.getSelection();
    const node = sel?.anchorNode;
    if (!sel?.isCollapsed || !node || node.nodeType !== Node.TEXT_NODE || !el.current?.contains(node)) return null;
    const m = (node.textContent ?? "").slice(0, sel.anchorOffset).match(/\[\[([^[\]\n]{0,40})$/);
    return m ? { node: node as Text, offset: sel.anchorOffset, query: m[1] } : null;
  };
  const watchSubjectPick = () => {
    const found = subjectQuery();
    const box = wrap.current?.getBoundingClientRect();
    if (!found || !box) {
      setSubjectPick(null);
      return;
    }
    const caret = document.createRange();
    caret.setStart(found.node, found.offset);
    const r = caret.getBoundingClientRect();
    setSubjectPick((p) => ({ query: found.query, left: Math.max(0, r.left - box.left), top: r.bottom - box.top + 4, index: p && p.query === found.query ? p.index : 0 }));
  };
  const insertSubject = (subject: SubjectRef) => {
    const found = subjectQuery();
    const sel = window.getSelection();
    if (!sel) return;
    // Put straight into the text where "[[name" was typed: the browser's
    // insertHTML, at the end of a line, sets an inline chip outside its paragraph.
    const range = document.createRange();
    if (found) {
      range.setStart(found.node, found.offset - found.query.length - 2);
      range.setEnd(found.node, found.offset);
    } else if (sel.rangeCount && el.current?.contains(sel.anchorNode)) {
      range.setStart(sel.getRangeAt(0).startContainer, sel.getRangeAt(0).startOffset);
    } else return;
    range.deleteContents();
    const holder = document.createElement("span");
    holder.innerHTML = subjectChipHtml(subject);
    const chip = holder.firstChild!;
    range.insertNode(chip);
    const space = document.createTextNode("\u00a0");
    chip.parentNode!.insertBefore(space, chip.nextSibling);
    const after = document.createRange();
    after.setStart(space, 1);
    after.collapse(true);
    sel.removeAllRanges();
    sel.addRange(after);
    refreshSubjectChips(el.current!);
    setSubjectPick(null);
    changed();
  };
  // Chips show their subject's name as it is now, and say when it is gone.
  useEffect(() => {
    const refresh = () => el.current && refreshSubjectChips(el.current);
    refresh();
    window.addEventListener(SUBJECTS_CHANGED_EVENT, refresh);
    return () => window.removeEventListener(SUBJECTS_CHANGED_EVENT, refresh);
  }, []);
  // Headline chips follow their story's title once its page has been read.
  useEffect(() => {
    const refresh = () => el.current && refreshCiteChips(el.current) && changed();
    window.addEventListener(CITES_CHANGED_EVENT, refresh);
    return () => window.removeEventListener(CITES_CHANGED_EVENT, refresh);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  /** A picture in the text under the pointer, and where its corner pin goes. */
  const [pinFor, setPinFor] = useState<{ img: HTMLImageElement; left: number; top: number } | null>(null);
  const wrap = useRef<HTMLDivElement | null>(null);
  /** A picture clicked on: outlined, its corner handle kept showing, and ⌘C / Delete act on it. */
  const [pickedImg, setPickedImg] = useState<HTMLImageElement | null>(null);
  const [imgMenu, setImgMenu] = useState<{ img: HTMLImageElement; left: number; top: number } | null>(null);
  const [cropping, setCropping] = useState<HTMLImageElement | null>(null);
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!pickedImg) return;
    pickedImg.classList.add("rt-picked");
    const away = (e: PointerEvent) => {
      const t = e.target as Element | null;
      if (t === pickedImg || t?.closest?.(".embed-size-pin, .rt-img-menu")) return;
      setPickedImg(null);
      setImgMenu(null);
    };
    window.addEventListener("pointerdown", away, true);
    return () => {
      pickedImg.classList.remove("rt-picked");
      window.removeEventListener("pointerdown", away, true);
    };
  }, [pickedImg]);
  /** Copy the picture, then take it out of the text — paste puts it back wherever it is wanted. */
  /** The width a picture in the text is shown at, as set by its corner handle. */
  const widthOf = (img: HTMLImageElement) => Number(img.getAttribute("data-w")) || undefined;
  const cutImg = async (img: HTMLImageElement) => {
    const ok = await copyPicture(img.src, widthOf(img));
    if (!ok) return;
    img.remove();
    setPickedImg(null);
    setPinFor(null);
    setImgMenu(null);
    changed();
  };
  const copyImg = async (img: HTMLImageElement) => {
    const ok = await copyPicture(img.src, widthOf(img));
    setCopied(ok);
    if (ok) setTimeout(() => setCopied(false), 1400);
  };

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

  /**
   * Quotes copied out of a story's notes keep their way back: a quote links
   * to its passage by an id only this card knows, so on the clipboard it
   * becomes the same words cited to the story.
   */
  function copyQuotes(event: React.ClipboardEvent, cut: boolean) {
    const selection = window.getSelection();
    if (!quoteSource || !selection || selection.isCollapsed || !selection.rangeCount) return;
    const holder = document.createElement("div");
    holder.appendChild(selection.getRangeAt(0).cloneContents());
    // A selection inside one quote carries none of its link: the quote is around it.
    const inside = (selection.anchorNode instanceof Element ? selection.anchorNode : selection.anchorNode?.parentElement)?.closest("a[data-quote]");
    if (!holder.querySelector("a[data-quote]") && !inside) return;
    holder.querySelectorAll("a[data-quote]").forEach((a) => {
      a.outerHTML = citeTextHtml(quoteSource, a.textContent ?? "");
    });
    const html = inside && !holder.querySelector("a[data-cite]") ? citeTextHtml(quoteSource, holder.textContent ?? "") : holder.innerHTML;
    event.preventDefault();
    event.clipboardData.setData("text/html", html);
    event.clipboardData.setData("text/plain", selection.toString());
    if (cut) {
      document.execCommand("delete");
      changed();
    }
  }

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
    // A story in the subject: a citation, which goes to its card.
    const cite = citeFor(href);
    if (cite) {
      if (target.range.collapsed) insertChip(cite);
      else document.execCommand("insertHTML", false, citeTextHtml(cite, target.range.toString()));
      changed();
      return;
    }
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
    refreshSubjectChips(node);
    refreshCiteChips(node);
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

  // Leaving the page — closing the tab, switching away — writes what was just
  // typed at once, rather than after the short pause that batches keystrokes.
  useEffect(() => {
    const now = () => {
      if (!timer.current) return;
      clearTimeout(timer.current);
      timer.current = null;
      flush();
    };
    const onHide = () => document.visibilityState === "hidden" && now();
    window.addEventListener("pagehide", now);
    document.addEventListener("visibilitychange", onHide);
    return () => {
      window.removeEventListener("pagehide", now);
      document.removeEventListener("visibilitychange", onHide);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
  const [vvTop, setVvTop] = useState(0);
  useEffect(() => {
    if (!docked) return;
    const vv = window.visualViewport;
    const scroller = wrap.current?.closest<HTMLElement>(".main") ?? null;
    // Pinned to the TOP of what is visible. The bottom edge on an iPhone is
    // a moving target — the keyboard, Safari's own ✓ / arrows bar, and
    // whether iOS shrinks the page or overlays it all vary from one moment to
    // the next — and a toolbar tracking it kept ending up behind that bar.
    // The top of the visual viewport is where the reader's eyes already are.
    const place = () => {
      setVvTop(vv ? vv.offsetTop : 0);
      // The caret's line stays below the toolbar.
      const sel = window.getSelection();
      const bar = tools.current?.getBoundingClientRect();
      if (!sel?.rangeCount || !bar || !scroller) return;
      const r = sel.getRangeAt(0).getBoundingClientRect();
      if (r.height && r.top < bar.bottom + 8) scroller.scrollBy({ top: r.top - bar.bottom - 24 });
    };
    if (scroller) scroller.style.scrollPaddingTop = "64px";
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
      if (scroller) scroller.style.scrollPaddingTop = "";
      later.forEach(clearTimeout);
    };
  }, [docked]);
  const coarse = () => typeof window !== "undefined" && window.matchMedia?.("(pointer: coarse)").matches;

  /**
   * Once the toolbar's own place has scrolled (or panned) off the screen,
   * it stands beside the card instead, upright, centred on what is still
   * visible of the card — so the tools are always within reach of the text
   * being written.
   */
  const [focused, setFocused] = useState(false);
  const [side, setSide] = useState<{ left: number; top: number } | null>(null);
  const toolsHost = useContext(ToolsHostContext);
  const hosted = Boolean(toolsHost) && !docked;
  useEffect(() => {
    if (!focused || docked || hosted) {
      setSide(null);
      return;
    }
    let frame = 0;
    let last = "";
    const tick = () => {
      frame = requestAnimationFrame(tick);
      const host = wrap.current;
      if (!host) return;
      const card = host.closest<HTMLElement>(".subject-box, .subject-card") ?? host;
      const anchor = (host.closest("table") as HTMLElement | null) ?? host;
      const a = anchor.getBoundingClientRect();
      const c = card.getBoundingClientRect();
      const vh = window.innerHeight;
      const vw = window.innerWidth;
      // Where the toolbar would sit: just above the text (or its table).
      const off = toolsBeside || a.top - 40 < 0 || a.top > vh - 20;
      const visible = c.bottom > 40 && c.top < vh - 40;
      let next: { left: number; top: number } | null = null;
      if (off && visible) {
        const h = tools.current?.offsetHeight || 280;
        const w = tools.current?.offsetWidth || 40;
        let left = c.left - w - 8;
        if (left < 4) left = c.right + 8;
        if (left + w > vw - 4) left = Math.max(4, vw - w - 4);
        const middle = (Math.max(c.top, 8) + Math.min(c.bottom, vh - 8)) / 2;
        const top = Math.min(vh - h - 8, Math.max(8, middle - h / 2));
        next = { left: Math.round(left), top: Math.round(top) };
      }
      const key = next ? `${next.left},${next.top}` : "";
      if (key !== last) {
        last = key;
        setSide(next);
      }
    };
    tick();
    return () => cancelAnimationFrame(frame);
  }, [focused, docked, hosted]);

  /** The list the caret is in, if any. */
  function listAtCaret(): HTMLUListElement | null {
    const node = window.getSelection()?.anchorNode;
    const elNode = node && (node.nodeType === 1 ? (node as Element) : node.parentElement);
    const list = elNode?.closest("ul");
    return list && el.current?.contains(list) ? (list as HTMLUListElement) : null;
  }

  /** The numbered list the caret is in, if any. */
  function orderedAtCaret(): HTMLOListElement | null {
    const node = window.getSelection()?.anchorNode;
    const elNode = node && (node.nodeType === 1 ? (node as Element) : node.parentElement);
    const list = elNode?.closest("ol");
    return list && el.current?.contains(list) ? (list as HTMLOListElement) : null;
  }

  /**
   * Lines into a numbered list (1, 2, 3) or a lettered one (a, b, c — or A,
   * B, C); the same again turns it back into lines. `start` is where it
   * counts from, when typed as "3." or "c)".
   */
  function toggleNumbered(lettered: boolean | "upper", start = 1) {
    const kind = lettered === "upper" ? "A" : lettered ? "a" : "1";
    if (onFormat?.(lettered ? "letteredList" : "insertOrderedList")) return;
    el.current?.focus();
    const list = orderedAtCaret();
    if (list && (list.getAttribute("type") ?? "1") === kind && start === 1) {
      document.execCommand("insertOrderedList");
    } else {
      if (!list) document.execCommand("insertOrderedList");
      let ol = orderedAtCaret();
      // The browser joins a new list onto one just above it. Numbers after
      // numbers carry on, as in a Doc; a list of the other kind starts afresh.
      const sel = window.getSelection();
      const node = sel?.anchorNode;
      const li = (node && (node.nodeType === 1 ? (node as Element) : node.parentElement))?.closest("li");
      if (!list && ol && li?.parentElement === ol && li.previousElementSibling && ((ol.getAttribute("type") ?? "1") !== kind || start > 1)) {
        const inLi = document.createRange();
        inLi.selectNodeContents(li);
        inLi.setEnd(sel!.anchorNode!, sel!.anchorOffset);
        const offset = inLi.toString().length;
        const fresh = document.createElement("ol");
        for (let item: Element | null = li; item; ) {
          const next: Element | null = item.nextElementSibling;
          fresh.append(item);
          item = next;
        }
        ol.after(fresh);
        ol = fresh;
        caretAtText(li, offset);
      }
      if (kind === "1") ol?.removeAttribute("type");
      else ol?.setAttribute("type", kind);
      if (start > 1) ol?.setAttribute("start", String(start));
      else ol?.removeAttribute("start");
    }
    changed();
  }

  /**
   * As in a Doc: a number or a letter followed by "." or ")" and then a
   * space, at the start of a line, starts a numbered or lettered list
   * counting from there ("3." from 3, "c)" from c, "A." in capitals); "-",
   * "*" or "•" starts a bulleted one. True when it did.
   */
  function listFromTyping(): boolean {
    const sel = window.getSelection();
    const root = el.current;
    if (!root || !sel?.isCollapsed || !sel.anchorNode || sel.anchorNode.nodeType !== Node.TEXT_NODE) return false;
    const block = (sel.anchorNode.parentElement?.closest("p, div, h3, li, blockquote") ?? root) as HTMLElement;
    if (!root.contains(block) || block.closest("li")) return false;
    const before = document.createRange();
    before.setStart(block, 0);
    before.setEnd(sel.anchorNode, sel.anchorOffset);
    const typed = before.toString().replace(/\u00a0/g, " ").trim();
    const number = typed.match(/^(\d{1,3})[.)]$/);
    const letter = typed.match(/^([a-zA-Z])[.)]$/);
    const bullet = /^[-*•–]$/.test(typed);
    if (!number && !letter && !bullet) return false;
    sel.removeAllRanges();
    sel.addRange(before);
    document.execCommand("delete");
    if (bullet) format("insertUnorderedList");
    else if (number) toggleNumbered(false, Math.max(1, Number(number[1])));
    else {
      const upper = letter![1] === letter![1].toUpperCase();
      toggleNumbered(upper ? "upper" : true, letter![1].toLowerCase().charCodeAt(0) - 96);
    }
    return true;
  }

  /** Lines into a checklist, or a checklist back into plain lines. */
  function toggleChecklist() {
    if (onFormat?.("checklist")) return;
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
    if (onFormat?.("highlight")) return;
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
    if (command !== "undo" && command !== "redo" && onFormat?.(command, value)) return;
    el.current?.focus();
    document.execCommand(command, false, value);
    changed();
  }

  const toolbar = (
    <div ref={tools} className={`rich-tools${docked ? " docked" : hosted ? " hosted" : side ? " side" : ""}`}
      style={docked ? { top: vvTop } : side ? { left: side.left, top: side.top } : undefined}
      onMouseDown={(event) => event.preventDefault()}>
      {(docked || hosted) && (
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
      <button type="button" title="Numbered list (⌘⇧7) — or type 1. and a space" onClick={() => toggleNumbered(false)}>1. List</button>
      <button type="button" title="Lettered list — or type a. and a space" onClick={() => toggleNumbered(true)}>a. List</button>
      <button type="button" title="Checklist (⌘⇧9)" onClick={toggleChecklist}>☐ Check</button>
      <button type="button" title="Heading" onClick={() => format("formatBlock", "h3")}>H3</button>
      <button type="button" title="Link (⌘K)" onClick={startLink}>Link</button>
      <button type="button" title="Link another subject — or type [[" onClick={() => {
        el.current?.focus();
        document.execCommand("insertText", false, "[[");
        watchSubjectPick();
      }}>◈ Subject</button>
      {docked && (
        <button type="button" className="rich-done" title="Done — close the keyboard"
          aria-label="Done — close the keyboard"
            onClick={() => { (document.activeElement as HTMLElement | null)?.blur?.(); setDocked(false); }}>✓</button>
      )}
    </div>
  );

  return (
    <div className={`rich ${className ?? ""}`} ref={wrap} onMouseLeave={() => !pickedImg && setPinFor(null)}
      onFocus={() => { setFocused(true); if (coarse()) setDocked(true); }}
      // Beside a table, the tools wait a moment before going, so moving to the next cell does not flicker them.
      onBlur={() => setTimeout(() => {
        if (!wrap.current?.contains(document.activeElement)) { setDocked(false); setFocused(false); }
      }, toolsBeside ? 160 : 0)}>
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
      {imgMenu && (
        <div className="rt-img-menu" style={{ left: imgMenu.left, top: imgMenu.top }} onMouseDown={(e) => e.preventDefault()}>
          {onReplaceEmbed && imgMenu.img.dataset.embed && (
            <button type="button" onClick={() => { setCropping(imgMenu.img); setImgMenu(null); }}>Crop</button>
          )}
          <button type="button" onClick={() => { void cutImg(imgMenu.img); }}>Cut</button>
          <button type="button" onClick={() => { void copyImg(imgMenu.img); setImgMenu(null); }}>Copy</button>
          <button type="button" onClick={() => { imgMenu.img.remove(); setImgMenu(null); setPickedImg(null); setPinFor(null); changed(); }}>Remove</button>
        </div>
      )}
      {copied && <span className="rt-img-copied">Picture copied</span>}
      {cropping && (
        <CropDialog src={cropping.src} onCancel={() => setCropping(null)}
          onDone={(image) => {
            const id = cropping.dataset.embed;
            if (id) onReplaceEmbed?.(id, image);
            cropping.setAttribute("src", image);
            setCropping(null);
            requestAnimationFrame(() => placePin(cropping));
          }} />
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
      {hosted
        ? focused && toolsHost ? createPortal(toolbar, toolsHost) : null
        : (docked || side) && typeof document !== "undefined" ? createPortal(toolbar, document.body) : toolbar}
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
      {subjectPick && (() => {
        const options = subjectsMatching(subjectPick.query);
        return (
          <div className="subject-pick" role="listbox" aria-label="Link a subject" style={{ left: subjectPick.left, top: subjectPick.top }}
            onMouseDown={(event) => event.preventDefault()}>
            <div className="subject-pick-head">Link a subject{subjectPick.query ? ` · “${subjectPick.query}”` : ""}</div>
            {options.map((s, i) => (
              <button key={s.id} type="button" role="option" aria-selected={i === subjectPick.index}
                className={i === subjectPick.index ? "on" : ""} onClick={() => insertSubject(s)}>
                <span aria-hidden="true">◈</span> {s.name}
              </button>
            ))}
            {options.length === 0 && <div className="subject-pick-none">No subject matches.</div>}
          </div>
        );
      })()}
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
          watchSubjectPick();
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
          setSubjectPick(null);
          if (timer.current) clearTimeout(timer.current);
          timer.current = null;
          flush();
        }}
        onMouseDown={(event) => {
          // A subject chip opens its subject on press: by the time a click
          // arrived, focusing the text would have brought up its toolbar and
          // moved the chip from under the pointer.
          const subjectChip = (event.target as HTMLElement).closest?.<HTMLElement>("a[data-subject]");
          if (!subjectChip || event.button !== 0) return;
          event.preventDefault();
          event.stopPropagation();
          if (!subjectChip.classList.contains("missing")) window.dispatchEvent(new CustomEvent(SUBJECT_OPEN_EVENT, { detail: subjectChip.dataset.subject }));
        }}
        onDoubleClick={(event) => {
          const img = (event.target as HTMLElement).closest?.("img.rt-embed") as HTMLImageElement | null;
          const box = wrap.current?.getBoundingClientRect();
          if (!img || !box) return;
          event.preventDefault();
          setPickedImg(img);
          setImgMenu({ img, left: event.clientX - box.left, top: event.clientY - box.top + 8 });
        }}
        onClick={(event) => {
          // A click on a picture picks it: its corner handle stays to resize it.
          const picture = (event.target as HTMLElement).closest?.("img.rt-embed") as HTMLImageElement | null;
          if (picture) {
            setPickedImg(picture);
            placePin(picture);
            return;
          }
          // A click on a checklist item's box ticks it.
          const item = (event.target as HTMLElement).closest<HTMLLIElement>("ul[data-check] > li");
          if (item && event.clientX < item.getBoundingClientRect().left) {
            event.preventDefault();
            if (item.getAttribute("data-checked") === "true") item.removeAttribute("data-checked");
            else item.setAttribute("data-checked", "true");
            changed();
            return;
          }
          // A subject chip is opened on press (below); its click has nothing left to do.
          if ((event.target as HTMLElement).closest?.("a[data-subject]")) {
            event.preventDefault();
            return;
          }
          if (followCite(event.target, event)) return;
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
        onCopy={(event) => quoteSource && copyQuotes(event, false)}
        onCut={(event) => quoteSource && copyQuotes(event, true)}
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
              const ids: { id: string; w: number | null }[] = [];
              for (const file of pictures.slice(0, 6)) {
                // A picture copied from here comes back at the size it was copied at.
                const w = await pastedWidth(file);
                const id = await onDropImage!(file);
                if (id) ids.push({ id, w });
              }
              if (!node || ids.length === 0) return;
              node.focus();
              const selection = window.getSelection();
              selection?.removeAllRanges();
              if (at && node.contains(at.startContainer)) selection?.addRange(at);
              document.execCommand("insertHTML", false, ids.map(({ id, w }) => `<p><img data-embed="${id}"${w ? ` data-w="${w}"` : ""}></p>`).join("") + "<p><br></p>");
              fillEmbeds();
              changed();
            })();
            return;
          }
          // An address pasted over selected words links them, as in a Doc.
          const plain = event.clipboardData.getData("text/plain").trim();
          const selected = window.getSelection();
          // The address of a story in the subject becomes its citation.
          const cite = event.clipboardData.getData("text/html").includes("data-cite") ? null : citeFor(plain);
          if (cite) {
            if (selected && !selected.isCollapsed) document.execCommand("insertHTML", false, citeTextHtml(cite, selected.toString()));
            else insertChip(cite);
            changed();
            return;
          }
          if (selected && !selected.isCollapsed && /^https?:\/\/\S+$/i.test(plain)) {
            document.execCommand("createLink", false, plain);
            changed();
            return;
          }
          // A link pasted on its own becomes a story in the subject, cited here as a chip.
          if (onPasteLink && /^https?:\/\/\S+$/i.test(plain)) {
            const story = onPasteLink(plain);
            if (story) {
              insertChip(story);
              changed();
              return;
            }
          }
          const html = event.clipboardData.getData("text/html");
          if (html) {
            const clean = cleanPastedHtml(html);
            if (clean.trim()) {
              document.execCommand("insertHTML", false, clean);
              // Ending on a chip leaves the caret on it, where nothing can be typed.
              stepPastChip();
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
          else if (pickedImg) placePin(pickedImg);
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
            return;
          }
          if (event.dataTransfer.types.includes(CITE_TYPE)) {
            event.preventDefault();
            event.dataTransfer.dropEffect = "copy";
          }
        }}
        onDrop={(event) => {
          // A story card dropped on the text: its citation, where it was let go.
          const citing = event.dataTransfer.getData(CITE_TYPE);
          if (citing && el.current) {
            event.preventDefault();
            event.stopPropagation();
            try {
              caretInto(el.current, event.clientX, event.clientY);
              insertChip(JSON.parse(citing) as Cite);
              changed();
            } catch { /* not a citation after all */ }
            return;
          }
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
          // The subject list under the caret takes the arrows, Enter and Escape while it is open.
          if (subjectPick) {
            const options = subjectsMatching(subjectPick.query);
            if (event.key === "ArrowDown" || event.key === "ArrowUp") {
              event.preventDefault();
              const n = Math.max(1, options.length);
              setSubjectPick({ ...subjectPick, index: (subjectPick.index + (event.key === "ArrowDown" ? 1 : n - 1)) % n });
              return;
            }
            if ((event.key === "Enter" || event.key === "Tab") && options[subjectPick.index]) {
              event.preventDefault();
              event.stopPropagation();
              insertSubject(options[subjectPick.index]);
              return;
            }
            if (event.key === "Escape") {
              event.preventDefault();
              event.stopPropagation();
              setSubjectPick(null);
              return;
            }
          }
          // With a picture picked, ⌘C copies the picture and Delete removes it.
          if (pickedImg && el.current?.contains(pickedImg)) {
            const key = event.key.toLowerCase();
            if ((event.metaKey || event.ctrlKey) && (key === "c" || key === "x") && window.getSelection()?.isCollapsed !== false) {
              event.preventDefault();
              event.stopPropagation();
              if (key === "c") void copyImg(pickedImg);
              else void cutImg(pickedImg);
              return;
            }
            if (event.key === "Backspace" || event.key === "Delete") {
              event.preventDefault();
              event.stopPropagation();
              pickedImg.remove();
              setPickedImg(null);
              setPinFor(null);
              changed();
              return;
            }
            if (event.key === "Escape") { setPickedImg(null); setImgMenu(null); }
          }
          // Tab indents, Shift+Tab outdents: in a list that nests the bullet a
          // level (and changes its style); elsewhere it indents the line.
          if (event.key === "Tab" && !event.metaKey && !event.ctrlKey && !event.altKey) {
            event.preventDefault();
            const anchor = window.getSelection()?.anchorNode;
            const inList = (anchor instanceof Element ? anchor : anchor?.parentElement)?.closest("li");
            if (onTab && !inList) {
              event.stopPropagation();
              flush();
              onTab(event.shiftKey);
              return;
            }
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
          if ((event.metaKey || event.ctrlKey) && event.shiftKey && event.code === "Digit7") {
            event.preventDefault();
            toggleNumbered(false);
            event.stopPropagation();
            return;
          }
          if (event.key === " " && !event.metaKey && !event.ctrlKey && !event.altKey && listFromTyping()) {
            event.preventDefault();
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
