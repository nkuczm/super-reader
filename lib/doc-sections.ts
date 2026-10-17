/**
 * The document's sections and the whiteboard's lines, kept as one thing.
 *
 * A section label (a header card) gathers what is filed under it: on the
 * whiteboard, the cards joined to it by a line; in the document, the blocks
 * that read below it (lib/subjects.ts, documentOrder). Writing in the
 * document keeps the two the same — whatever is written below a header is
 * joined to it, and writing above every header is joined to nothing — so
 * research done in the document arrives on the whiteboard already sorted,
 * and cards sorted on the whiteboard read in order in the document.
 */

import { live, put, remove, type Board, type BoxItem, type LinkItem } from "./subjects";

const isLabel = (board: Board | undefined, id: string) => {
  const item = board?.[id];
  return Boolean(item && !item.deleted && item.kind === "box" && (item as BoxItem).label);
};

/** The header a block is filed under: the label itself for a label, or none. */
export function sectionOf(board: Board | undefined, id: string | null | undefined): string | null {
  if (!id) return null;
  if (isLabel(board, id)) return id;
  for (const item of live(board)) {
    if (item.kind !== "link") continue;
    const link = item as LinkItem;
    const other = link.from === id ? link.to : link.to === id ? link.from : null;
    if (other && isLabel(board, other)) return other;
  }
  return null;
}

/**
 * File a block under one header (or none): its lines to every other header
 * go, and a line to this one is drawn. Lines to anything that is not a
 * header — a transcript's notes, a story joined to a story — are left alone.
 */
export function fileUnder(board: Board | undefined, id: string, label: string | null, now = Date.now()): Board {
  let next = board ?? {};
  if (isLabel(next, id)) return next;
  let had = false;
  for (const item of live(next)) {
    if (item.kind !== "link") continue;
    const link = item as LinkItem;
    const other = link.from === id ? link.to : link.to === id ? link.from : null;
    if (!other || !isLabel(next, other)) continue;
    if (other === label && !had) had = true;
    else next = remove(next, link.id, now);
  }
  if (label && !had) next = put(next, { id: `link:${label}|${id}`, kind: "link", from: label, to: id, at: now }, now);
  return next;
}

/**
 * A block put in right after another, as a line is in a Doc: what used to
 * read straight after that block now reads after the new one. Only text and
 * other boxes move along — a story pasted into a block stays with it.
 */
export function insertAfter(board: Board | undefined, id: string, after: string, now = Date.now()): Board {
  let next = board ?? {};
  for (const item of live(next)) {
    if (item.kind !== "box" || item.id === id || (item as BoxItem).after !== after) continue;
    next = put(next, { ...(item as BoxItem), after: id, at: now }, now);
  }
  return next;
}

export type SplitPiece = { heading: string } | { html: string };

/**
 * A text box's writing cut at its headings: what comes before the first
 * heading, then each heading with the writing under it. Null when it has
 * no heading at its top level. Needs a Document to parse in.
 */
export function splitAtHeadings(html: string, doc: Document): { before: string; pieces: SplitPiece[] } | null {
  const holder = doc.createElement("div");
  holder.innerHTML = html;
  const nodes = Array.from(holder.childNodes);
  if (!nodes.some((n) => n.nodeType === 1 && (n as Element).tagName === "H3")) return null;
  const pieces: SplitPiece[] = [];
  let before = "";
  let current: string[] | null = null;
  const flush = () => {
    if (current === null) return;
    const body = current.join("");
    if (textOfHtml(body, doc) || /<img\b|data-cite|data-subject/.test(body)) pieces.push({ html: body });
    current = null;
  };
  for (const node of nodes) {
    if (node.nodeType === 1 && (node as Element).tagName === "H3") {
      flush();
      pieces.push({ heading: (node.textContent ?? "").replace(/\s+/g, " ").trim() });
      current = [];
      continue;
    }
    const piece = node.nodeType === 1 ? (node as Element).outerHTML : (node.textContent ?? "");
    if (current === null) before += piece;
    else current.push(piece);
  }
  flush();
  return { before, pieces };
}

function textOfHtml(html: string, doc: Document): string {
  const holder = doc.createElement("div");
  holder.innerHTML = html;
  return (holder.textContent ?? "").replace(/[​ \s]/g, "");
}
