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

/** The change to send, with each picture the account already holds replaced by its reference. */
export async function withRefs(change: Writing, onServer: Set<string>): Promise<{ doc: Writing; sent: string[] }> {
  const sent: string[] = [];
  const boards: Boards = {};
  for (const [subject, board] of Object.entries(change.boards)) {
    const next: Board = {};
    for (const [id, item] of Object.entries(board)) {
      const image = (item as { image?: unknown }).image;
      if (isData(image)) {
        const hash = await pictureHash(image);
        sent.push(hash);
        next[id] = onServer.has(hash) ? ({ ...item, image: IMAGE_REF + hash } as BoardItem) : item;
      } else next[id] = item;
    }
    boards[subject] = next;
  }
  return { doc: { ...change, boards }, sent };
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
): Promise<Writing> {
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
  const missing = [...wanted].filter((h) => !found.has(h));
  for (let i = 0; i < missing.length; i += 20) {
    try {
      const got = await fetchImages(missing.slice(i, i + 20));
      for (const [h, data] of Object.entries(got)) found.set(h, data);
    } catch {
      /* left out below, and fetched on a later load */
    }
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
  return { ...doc, boards };
}
