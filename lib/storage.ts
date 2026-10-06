/**
 * What the reader's subjects and saved articles take up on this device —
 * each subject itemised, so the large ones can be found.
 */

import type { Note } from "./notes";
import type { Board } from "./subjects";
import type { SavedArticle } from "./saved";
import { canonicalUrl } from "./url";

export const sizeOf = (value: unknown) => new Blob([typeof value === "string" ? value : JSON.stringify(value ?? null)]).size;

export type SubjectUsage = { id: string; name: string; bytes: number; images: number; items: number; edited: number };

/** Each subject's size — its note and its board, pictures included — and when it was last changed. */
export function subjectUsage(notes: Note[], boards: Record<string, Board>): SubjectUsage[] {
  return notes.map((note) => {
    const board = boards[note.id] ?? {};
    let images = 0;
    let edited = note.updatedAt ?? note.at;
    let items = 0;
    for (const item of Object.values(board)) {
      if (!item || (item as { deleted?: boolean }).deleted) continue;
      items++;
      const at = (item as { at?: number }).at;
      if (typeof at === "number" && at > edited) edited = at;
      const image = (item as { image?: unknown }).image;
      if (typeof image === "string") images += image.length;
    }
    for (const entry of note.entries) if (typeof (entry as { at?: number }).at === "number") edited = Math.max(edited, (entry as { at: number }).at);
    return { id: note.id, name: note.name || "Untitled", bytes: sizeOf(note) + sizeOf(board), images, items, edited };
  });
}

/** Saved articles: the list itself, and the offline copies kept of them. */
export function savedUsage(saved: SavedArticle[], offline: Map<string, number>) {
  let copies = 0;
  let withCopy = 0;
  for (const article of saved) {
    const bytes = offline.get(canonicalUrl(article.link));
    if (bytes) { copies += bytes; withCopy++; }
  }
  const offlineTotal = [...offline.values()].reduce((a, b) => a + b, 0);
  return { count: saved.length, list: sizeOf(saved), copies, withCopy, offlineTotal };
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(n < 10 * 1024 ? 1 : 0)} KB`;
  if (n < 1024 ** 3) return `${(n / 1024 / 1024).toFixed(1)} MB`;
  return `${(n / 1024 ** 3).toFixed(2)} GB`;
}
