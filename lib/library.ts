/**
 * The library: every bookmark, pasted story and highlight a signed-in person
 * has, kept with their account one row per item, with no cap.
 *
 * The synced document carries only the newest few hundred of each — it is
 * one row, read and written whole, and has to stay small. That was the only
 * copy off the device, so a browser whose data was cleared got back the
 * newest four hundred bookmarks and nothing older. The library keeps all of
 * them. Each item carries when it last changed; a newer change replaces an
 * older one and nothing else does, and a removal is itself a dated item, so
 * an item is never lost to a merge or an overwrite.
 *
 * A device sends only items that changed since the account last saw them,
 * and asks only for what changed since it last looked.
 *
 * This file is pure and client-safe; the database half is lib/library-store.ts.
 */

import type { SavedArticle, SavedRemoval } from "./saved";
import type { ManualStories } from "./manual";
import type { Highlights } from "./highlights";
import { canonicalUrl } from "./url";

export const KINDS = ["saved", "manual", "highlight"] as const;
export type Kind = (typeof KINDS)[number];
export type LibraryItem = { kind: Kind; key: string; at: number; data: Record<string, unknown> };
export type Library = {
  saved: SavedArticle[];
  savedRemovals: SavedRemoval[];
  manual: ManualStories;
  highlights: Highlights;
};

/** One item's limit. A saved article's summary is what can run long; it is cut, everything else kept. */
export const MAX_ITEM_BYTES = 24 * 1024;
const SUMMARY_CHARS = 4000;

export const isKind = (v: unknown): v is Kind => typeof v === "string" && (KINDS as readonly string[]).includes(v);
export const itemId = (item: { kind: string; key: string }) => `${item.kind}\u0000${item.key}`;

const stamp = (v: unknown) => (Number.isFinite(Number(v)) ? Number(v) : 0);

/** A device's collections as library items, each with when it last changed. */
export function itemsOf(library: Library): LibraryItem[] {
  const items = new Map<string, LibraryItem>();
  const put = (item: LibraryItem) => {
    if (!item.key || item.at <= 0) return;
    const id = itemId(item);
    const held = items.get(id);
    if (!held || item.at > held.at) items.set(id, item);
  };
  for (const article of library.saved ?? []) {
    if (!article?.link) continue;
    // Device bookkeeping stays on the device (lib/saved.ts).
    const { viaNote: _viaNote, ...kept } = article;
    void _viaNote;
    const data = kept.summary && kept.summary.length > SUMMARY_CHARS ? { ...kept, summary: kept.summary.slice(0, SUMMARY_CHARS) } : kept;
    put({ kind: "saved", key: canonicalUrl(article.link), at: stamp(article.savedAt), data: data as Record<string, unknown> });
  }
  for (const removal of library.savedRemovals ?? []) {
    if (!removal?.link) continue;
    put({ kind: "saved", key: canonicalUrl(removal.link), at: stamp(removal.at), data: { link: removal.link, deleted: true } });
  }
  for (const [key, story] of Object.entries(library.manual ?? {})) {
    if (story && typeof story.link === "string") put({ kind: "manual", key, at: stamp(story.at), data: story as unknown as Record<string, unknown> });
  }
  for (const [id, highlight] of Object.entries(library.highlights ?? {})) {
    if (highlight && typeof highlight.text === "string") put({ kind: "highlight", key: id, at: stamp(highlight.at), data: highlight as unknown as Record<string, unknown> });
  }
  return [...items.values()];
}

/** Library items as the collections a device holds, ready to merge into its own. */
export function libraryOf(items: LibraryItem[]): Library {
  const out: Library = { saved: [], savedRemovals: [], manual: {}, highlights: {} };
  for (const item of items) {
    const data = item.data ?? {};
    if (item.kind === "saved") {
      if (data.deleted) out.savedRemovals.push({ link: String(data.link ?? item.key), at: item.at });
      else if (typeof data.link === "string") out.saved.push({ ...(data as unknown as SavedArticle), savedAt: item.at });
    } else if (item.kind === "manual") {
      if (typeof data.link === "string") out.manual[item.key] = { ...(data as unknown as ManualStories[string]), at: item.at };
    } else if (item.kind === "highlight") {
      if (typeof data.text === "string" && typeof data.link === "string") out.highlights[item.key] = { ...(data as unknown as Highlights[string]), at: item.at };
    }
  }
  return out;
}

/** What the account is known to hold: each item's change time, by item. */
export type LibraryBase = Record<string, number>;

/** Items this device holds a newer change of than the account is known to. */
export function libraryDelta(items: LibraryItem[], base: LibraryBase): LibraryItem[] {
  return items.filter((item) => item.at > (base[itemId(item)] ?? 0));
}

/** Items in requests of at most `maxBytes` each. */
export function itemBatches(items: LibraryItem[], maxBytes = 1_500_000): LibraryItem[][] {
  const batches: LibraryItem[][] = [];
  let current: LibraryItem[] = [];
  let size = 0;
  for (const item of items) {
    const cost = JSON.stringify(item).length + 1;
    if (current.length && size + cost > maxBytes) {
      batches.push(current);
      current = [];
      size = 0;
    }
    current.push(item);
    size += cost;
  }
  if (current.length) batches.push(current);
  return batches;
}

/** An item as the server accepts it, or null. */
export function cleanItem(value: unknown): LibraryItem | null {
  const item = value as Partial<LibraryItem> | null;
  if (!item || !isKind(item.kind) || typeof item.key !== "string" || !item.key || item.key.length > 2048) return null;
  const at = stamp(item.at);
  if (at <= 0 || !item.data || typeof item.data !== "object" || Array.isArray(item.data)) return null;
  if (JSON.stringify(item.data).length > MAX_ITEM_BYTES) return null;
  return { kind: item.kind, key: item.key, at, data: item.data as Record<string, unknown> };
}
