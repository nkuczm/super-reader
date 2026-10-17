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
 *
 * A subheader is a label filed under a header the same way, and gathers the
 * writing below it in turn: header → subheader → writing, two levels deep.
 */

import { live, put, remove, type Board, type BoardItem, type BoxItem, type LinkItem, type StoryItem } from "./subjects";

const isLabel = (board: Board | undefined, id: string) => {
  const item = board?.[id];
  return Boolean(item && !item.deleted && item.kind === "box" && (item as BoxItem).label);
};

const isSub = (board: Board | undefined, id: string) => isLabel(board, id) && Boolean((board?.[id] as BoxItem).sub);
const isHeader = (board: Board | undefined, id: string) => isLabel(board, id) && !(board?.[id] as BoxItem).sub;

/** The label linked to a block that passes a test. */
function linkedLabel(board: Board | undefined, id: string, test: (other: string) => boolean): string | null {
  for (const item of live(board)) {
    if (item.kind !== "link") continue;
    const link = item as LinkItem;
    const other = link.from === id ? link.to : link.to === id ? link.from : null;
    if (other && test(other)) return other;
  }
  return null;
}

/** The top-level header a block, subheader or header falls under, or none. */
export function headerOf(board: Board | undefined, id: string | null | undefined): string | null {
  if (!id) return null;
  if (isHeader(board, id)) return id;
  if (isSub(board, id)) return linkedLabel(board, id, (other) => isHeader(board, other));
  const section = sectionOf(board, id);
  return section && section !== id ? headerOf(board, section) : null;
}

/** The header a block is filed under: the label itself for a label, or none. */
export function sectionOf(board: Board | undefined, id: string | null | undefined): string | null {
  if (!id) return null;
  if (isLabel(board, id)) return id;
  // A subheader's writing is linked to it alone; older boards may also have drawn a line to the header.
  return linkedLabel(board, id, (other) => isSub(board, other)) ?? linkedLabel(board, id, (other) => isLabel(board, other));
}

/**
 * File a block under one header (or none): its lines to every other header
 * go, and a line to this one is drawn. Lines to anything that is not a
 * header — a transcript's notes, a story joined to a story — are left alone.
 * A subheader is filed the same way, under a top-level header only (its
 * lines to its own writing stay); a header is filed under nothing.
 */
export function fileUnder(board: Board | undefined, id: string, label: string | null, now = Date.now()): Board {
  let next = board ?? {};
  if (isHeader(next, id)) return next;
  const sub = isSub(next, id);
  if (sub) label = headerOf(next, label);
  let had = false;
  for (const item of live(next)) {
    if (item.kind !== "link") continue;
    const link = item as LinkItem;
    const other = link.from === id ? link.to : link.to === id ? link.from : null;
    if (!other || !(sub ? isHeader(next, other) : isLabel(next, other))) continue;
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

/** The board item that holds a block's place: a box itself, or a story card's story. */
const holderOf = (board: Board, id: string) => {
  const own = board[id];
  if (own && !own.deleted && own.kind === "box") return own as BoxItem;
  const story = board[`story:${id}`];
  return story && !story.deleted && story.kind === "story" ? (story as StoryItem) : null;
};

/**
 * The document in the order given, written back as the blocks' own places:
 * each reads right after the block before it, the first after nothing.
 * Only blocks whose place changes are written. A story's card keeps when
 * it first arrived (its order in the feed) as its place is written.
 */
export function rechain(board: Board | undefined, order: string[], now = Date.now()): Board {
  let next = board ?? {};
  order.forEach((id, i) => {
    const held = holderOf(next, id);
    if (!held) return;
    const want = i > 0 ? order[i - 1] : undefined;
    if (held.after === want && !(held as BoxItem).before) return;
    const rest: Record<string, unknown> = { ...held };
    delete rest.after;
    delete rest.before;
    const since = held.kind === "story" ? { since: held.since ?? held.at } : {};
    next = put(next, { ...rest, ...since, ...(want ? { after: want } : {}), at: now } as BoardItem, now);
  });
  return next;
}

/**
 * Blocks taken out of the document: whatever read right after one of them
 * now reads after what that block read after (or takes its place at the
 * top), so the writing below a deleted block stays where it was rather
 * than falling back to when it was written.
 */
export function closeGap(board: Board | undefined, gone: Set<string>, now = Date.now()): Board {
  const start = board ?? {};
  let next = start;
  const anchor = (id: string) => {
    const seen = new Set<string>();
    let at: string | undefined = id;
    while (at && gone.has(at) && !seen.has(at)) {
      seen.add(at);
      at = holderOf(start, at)?.after;
    }
    return { after: at && !gone.has(at) ? at : undefined, last: [...seen].at(-1)! };
  };
  for (const item of live(start)) {
    if (item.kind !== "box" && item.kind !== "story") continue;
    if (gone.has(item.id) || gone.has(item.id.replace(/^story:/, ""))) continue;
    const held = item as BoxItem | StoryItem;
    if (!held.after || !gone.has(held.after)) continue;
    const { after, last } = anchor(held.after);
    const before = after ? undefined : (holderOf(start, last) as BoxItem | null)?.before;
    const rest: Record<string, unknown> = { ...held };
    delete rest.after;
    const since = held.kind === "story" ? { since: held.since ?? held.at } : {};
    next = put(next, { ...rest, ...since, ...(after ? { after } : {}), ...(before && !gone.has(before) && held.kind === "box" ? { before } : {}), at: now } as BoardItem, now);
  }
  return next;
}

/** What a header carries when it moves: its writing, and for a top-level header its subheaders with theirs. */
export function sectionRun(board: Board | undefined, order: string[], id: string): string[] {
  const start = order.indexOf(id);
  if (start < 0 || !isLabel(board, id)) return [];
  const sub = isSub(board, id);
  const run = [id];
  for (const at of order.slice(start + 1)) {
    if (isLabel(board, at) && (sub || !isSub(board, at))) break;
    run.push(at);
  }
  return run;
}

/**
 * Where a header can be moved to, as the block it would then read right
 * before (null: the end of the document). A header goes between sections:
 * before another header, at the end, or at the very top. A subheader goes
 * where a subsection can end — before another subheader or header, or at
 * the end — as long as a header reads above that spot.
 */
export function moveTargets(board: Board | undefined, order: string[], id: string): (string | null)[] {
  const run = new Set(sectionRun(board, order, id));
  if (!run.size) return [];
  const rest = order.filter((at) => !run.has(at));
  if (!isSub(board, id)) return [...rest.filter((at, i) => i === 0 || isHeader(board, at)), null];
  const out: (string | null)[] = [];
  let header = false;
  for (const at of rest) {
    if (header && isLabel(board, at)) out.push(at);
    if (isHeader(board, at)) header = true;
  }
  return header ? [...out, null] : out;
}

/**
 * A header moved in the document with everything that reads under it, to
 * read right before `to` (null: at the end). `order` is the document as it
 * reads now. A subheader is filed under the header it lands below; a header
 * put in at the very top takes the writing there that read under no header.
 * Null when the move changes nothing.
 */
export function moveSection(board: Board | undefined, order: string[], id: string, to: string | null, now = Date.now()): Board | null {
  const run = sectionRun(board, order, id);
  if (!run.length || (to !== null && run.includes(to))) return null;
  const rest = order.filter((at) => !run.includes(at));
  const at = to === null ? rest.length : rest.indexOf(to);
  if (at < 0) return null;
  const moved = [...rest.slice(0, at), ...run, ...rest.slice(at)];
  if (moved.every((x, i) => x === order[i])) return null;
  let next = rechain(board, moved, now);
  if (isSub(next, id)) {
    const above = moved.slice(0, moved.indexOf(id)).reverse().find((x) => isHeader(next, x)) ?? null;
    return fileUnder(next, id, above, now);
  }
  for (const x of moved.slice(moved.indexOf(id) + run.length)) {
    if (isHeader(next, x)) break;
    if (isSub(next, x) || !sectionOf(next, x)) next = fileUnder(next, x, id, now);
  }
  return next;
}

export type SplitPiece = { heading: string; sub?: boolean } | { html: string };

/**
 * A text box's writing cut at its headings: what comes before the first
 * heading, then each heading with the writing under it. An <h4> is a
 * subheading. Null when it has no heading at its top level. Needs a
 * Document to parse in.
 */
export function splitAtHeadings(html: string, doc: Document): { before: string; pieces: SplitPiece[] } | null {
  const holder = doc.createElement("div");
  holder.innerHTML = html;
  const nodes = Array.from(holder.childNodes);
  const heading = (n: Node) => n.nodeType === 1 && /^H[34]$/.test((n as Element).tagName);
  if (!nodes.some(heading)) return null;
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
    if (heading(node)) {
      flush();
      const text = (node.textContent ?? "").replace(/\s+/g, " ").trim();
      pieces.push((node as Element).tagName === "H4" ? { heading: text, sub: true } : { heading: text });
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
