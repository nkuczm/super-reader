/**
 * Saving subjects by change. A device remembers what the account is known to
 * hold — a short signature of every note, removal and board item — and
 * sends only what differs. Pictures travel once: a picture the account
 * already has goes as `sr-img:<sha256>`, and one coming back as a reference
 * is filled in from this device's own copy, or fetched if it has none.
 *
 * Client-side (Web Crypto); the server half is in lib/accounts.ts.
 */

import type { Note, NoteRemoval } from "./notes";
import type { Board, BoardItem, Boards } from "./subjects";

export type Writing = { notes: Note[]; noteRemovals: NoteRemoval[]; boards: Boards };
export const IMAGE_REF = "sr-img:";

/** What the account is known to hold, as signatures. */
export type Base = { notes: Map<string, string>; removals: Set<string>; items: Map<string, string> };
export const emptyBase = (): Base => ({ notes: new Map(), removals: new Set(), items: new Map() });

/** A picture, briefly: enough to tell two apart without carrying either. */
const pictureKey = (data: string) => `${data.length}:${data.slice(0, 48)}:${data.slice(-48)}`;

/** A board item's signature, with any picture reduced to its key. */
export function itemSig(item: BoardItem): string {
  const image = (item as { image?: unknown }).image;
  return JSON.stringify(typeof image === "string" && image.length > 200 ? { ...item, image: pictureKey(image) } : item);
}
const removalKey = (r: NoteRemoval) => `${r.id}:${r.at}`;

/** Note what the account now holds. */
export function remember(base: Base, doc: Partial<Writing>) {
  for (const note of doc.notes ?? []) base.notes.set(note.id, JSON.stringify(note));
  for (const r of doc.noteRemovals ?? []) base.removals.add(removalKey(r));
  for (const [subject, board] of Object.entries(doc.boards ?? {})) {
    for (const [id, item] of Object.entries(board ?? {})) base.items.set(`${subject}/${id}`, itemSig(item));
  }
}

/** What this device has that the account is not known to hold. */
export function delta(writing: Writing, base: Base): Writing {
  const boards: Boards = {};
  for (const [subject, board] of Object.entries(writing.boards ?? {})) {
    const changed: Board = {};
    for (const [id, item] of Object.entries(board ?? {})) {
      if (base.items.get(`${subject}/${id}`) !== itemSig(item)) changed[id] = item;
    }
    if (Object.keys(changed).length) boards[subject] = changed;
  }
  return {
    notes: (writing.notes ?? []).filter((n) => base.notes.get(n.id) !== JSON.stringify(n)),
    noteRemovals: (writing.noteRemovals ?? []).filter((r) => !base.removals.has(removalKey(r))),
    boards,
  };
}

export const isEmpty = (d: Writing) => !d.notes.length && !d.noteRemovals.length && !Object.keys(d.boards).length;

/* ---------- pictures ---------- */

const hashes = new Map<string, string>();
/** SHA-256 of a picture's data URL, as the server computes it; remembered per picture. */
export async function pictureHash(data: string): Promise<string> {
  const key = pictureKey(data);
  const known = hashes.get(key);
  if (known) return known;
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(data));
  const hex = [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
  hashes.set(key, hex);
  return hex;
}

const isData = (v: unknown): v is string => typeof v === "string" && v.startsWith("data:");

/**
 * The change to send, with each picture the account already holds replaced
 * by its reference. `inline` is every picture still carried whole — the ones
 * to send ahead, on their own, before the change itself.
 */
export async function withRefs(change: Writing, onServer: Set<string>): Promise<{ doc: Writing; sent: string[]; inline: Map<string, string> }> {
  const sent: string[] = [];
  const inline = new Map<string, string>();
  const boards: Boards = {};
  for (const [subject, board] of Object.entries(change.boards)) {
    const next: Board = {};
    for (const [id, item] of Object.entries(board)) {
      const image = (item as { image?: unknown }).image;
      if (isData(image)) {
        const hash = await pictureHash(image);
        sent.push(hash);
        if (onServer.has(hash)) next[id] = { ...item, image: IMAGE_REF + hash } as BoardItem;
        else {
          next[id] = item;
          inline.set(hash, image);
        }
      } else next[id] = item;
    }
    boards[subject] = next;
  }
  return { doc: { ...change, boards }, sent, inline };
}

/** Pictures grouped into requests of at most `maxBytes` each — one picture per request when it is larger. */
export function pictureBatches(pictures: Map<string, string>, maxBytes = 2_500_000): Record<string, string>[] {
  const batches: Record<string, string>[] = [];
  let current: Record<string, string> = {};
  let size = 0;
  for (const [hash, data] of pictures) {
    if (size > 0 && size + data.length > maxBytes) {
      batches.push(current);
      current = {};
      size = 0;
    }
    current[hash] = data;
    size += data.length;
  }
  if (size > 0) batches.push(current);
  return batches;
}

/**
 * A change cut into pieces that each fit in one request. Every piece is a
 * document of its own — whole notes, whole board items — and the account
 * merges each into what it holds, so they can arrive in any order.
 */
export function splitWriting(doc: Writing, maxBytes = 3_000_000): Writing[] {
  const whole = JSON.stringify(doc).length;
  if (whole <= maxBytes) return [doc];
  const pieces: Writing[] = [];
  let current: Writing = { notes: [], noteRemovals: [], boards: {} };
  let size = 0;
  const flush = () => {
    if (!isEmpty(current)) pieces.push(current);
    current = { notes: [], noteRemovals: [], boards: {} };
    size = 0;
  };
  const add = (cost: number, put: () => void) => {
    if (size > 0 && size + cost > maxBytes) flush();
    put();
    size += cost;
  };
  for (const removal of doc.noteRemovals ?? []) add(JSON.stringify(removal).length, () => current.noteRemovals.push(removal));
  for (const note of doc.notes ?? []) add(JSON.stringify(note).length, () => current.notes.push(note));
  for (const [subject, board] of Object.entries(doc.boards ?? {})) {
    for (const [id, item] of Object.entries(board ?? {})) {
      add(JSON.stringify(item).length + id.length, () => {
        (current.boards[subject] ??= {})[id] = item;
      });
    }
  }
  flush();
  return pieces;
}

/**
 * A document from the account with its picture references filled in: from
 * this device's own pictures where it has them, else fetched. An item whose
 * picture cannot be had is left out, so a reference never replaces a picture.
 */
export async function withPictures(
  doc: Writing,
  local: Boards,
  fetchImages: (hashes: string[]) => Promise<Record<string, string>>,
  onServer: Set<string>,
): Promise<Writing & { leftOut?: number }> {
  const wanted = new Set<string>();
  for (const board of Object.values(doc.boards ?? {})) {
    for (const item of Object.values(board ?? {})) {
      const image = (item as { image?: unknown }).image;
      if (typeof image === "string" && image.startsWith(IMAGE_REF)) wanted.add(image.slice(IMAGE_REF.length));
    }
  }
  if (!wanted.size) return doc;
  for (const h of wanted) onServer.add(h);
  const found = new Map<string, string>();
  for (const board of Object.values(local)) {
    for (const item of Object.values(board ?? {})) {
      const image = (item as { image?: unknown }).image;
      if (!isData(image)) continue;
      const hash = await pictureHash(image);
      if (wanted.has(hash)) found.set(hash, image);
    }
  }
  // Asked for a few at a time; each answer holds as many as fit, and what it
  // left out is asked for again. A batch that brings none of its pictures is
  // set aside (the account lacks them, or cannot answer), and the rest go on.
  let queue = [...wanted].filter((h) => !found.has(h));
  const missing: string[] = [];
  while (queue.length) {
    const batch = queue.slice(0, 8);
    let got: Record<string, string>;
    try {
      got = await fetchImages(batch);
    } catch {
      missing.push(...queue);
      break;
    }
    const arrived = Object.entries(got ?? {}).filter(([h, data]) => batch.includes(h) && typeof data === "string" && data.startsWith("data:"));
    for (const [h, data] of arrived) found.set(h, data);
    if (!arrived.length) {
      missing.push(...batch);
      queue = queue.slice(batch.length);
    } else queue = queue.filter((h) => !found.has(h));
  }
  const boards: Boards = {};
  for (const [subject, board] of Object.entries(doc.boards ?? {})) {
    const next: Board = {};
    for (const [id, item] of Object.entries(board ?? {})) {
      const image = (item as { image?: unknown }).image;
      if (typeof image === "string" && image.startsWith(IMAGE_REF)) {
        const data = found.get(image.slice(IMAGE_REF.length));
        if (data) next[id] = { ...item, image: data } as BoardItem;
      } else next[id] = item;
    }
    boards[subject] = next;
  }
  // Items whose picture could not be had are left out, and counted, so the caller can look again.
  return { ...doc, boards, ...(missing.length ? { leftOut: missing.length } : {}) };
}

/* ---------- a whole copy too big for one answer ---------- */

/** How much one answer carries before a whole copy is sent in parts. */
export const PART_BYTES = 3_000_000;

const bucket = (id: string, of: number) => {
  let h = 5381;
  for (let i = 0; i < id.length; i++) h = ((h << 5) + h + id.charCodeAt(i)) | 0;
  return Math.abs(h) % of;
};

/** How many parts a whole copy goes in. */
export const partsFor = (doc: Writing) => Math.max(1, Math.ceil(JSON.stringify(doc).length / PART_BYTES));

/**
 * One part of a whole copy. Each subject — its note and its board — always
 * falls in the same part, whatever else changes between requests, so asking
 * for the parts one by one cannot miss a subject that moved.
 */
export function partOf(doc: Writing, part: number, of: number): Writing {
  if (of <= 1) return doc;
  return {
    notes: (doc.notes ?? []).filter((n) => bucket(n.id, of) === part),
    noteRemovals: part === 0 ? (doc.noteRemovals ?? []) : [],
    boards: Object.fromEntries(Object.entries(doc.boards ?? {}).filter(([id]) => bucket(id, of) === part)),
  };
}

/** The parts of a whole copy, put back together. */
export function joinParts(parts: Writing[]): Writing {
  return {
    notes: parts.flatMap((p) => p.notes ?? []),
    noteRemovals: parts.flatMap((p) => p.noteRemovals ?? []),
    boards: Object.assign({}, ...parts.map((p) => p.boards ?? {})),
  };
}
