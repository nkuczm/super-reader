/**
 * A device's copy of the shared document, as a route accepts it: every part
 * passed through in the shape writeSync expects (lib/sync-doc.ts decides
 * what is kept), anything malformed left out. Null without a feeds array.
 */

import { MAX_READ, PARTS, type SyncPayload } from "./sync-doc";
import type { Note, NoteRemoval } from "./notes";
import type { SavedArticle, SavedRemoval } from "./saved";
import type { WatchMarks } from "./alerts";
import type { Positions } from "./position";
import type { Boards } from "./subjects";
import type { ManualStories } from "./manual";
import type { Highlights } from "./highlights";

export function cleanPayload(value: unknown): SyncPayload | null {
  if (!value || typeof value !== "object") return null;
  const body = value as Record<string, unknown>;
  if (!Array.isArray(body.feeds)) return null;
  const obj = (v: unknown) => (v && typeof v === "object" && !Array.isArray(v) ? v : undefined);
  const list = (v: unknown) => (Array.isArray(v) ? v : undefined);
  const stamps = obj(body.stamps) as Record<string, unknown> | undefined;
  return {
    feeds: body.feeds,
    ...(list(body.read) ? { read: (body.read as unknown[]).filter((id): id is string => typeof id === "string").slice(-MAX_READ) } : {}),
    saved: (list(body.saved) ?? []) as SavedArticle[],
    savedRemovals: (list(body.savedRemovals) ?? []) as SavedRemoval[],
    watchMarks: (obj(body.watchMarks) ?? {}) as WatchMarks,
    positions: (obj(body.positions) ?? {}) as Positions,
    notes: (list(body.notes) ?? []) as Note[],
    noteRemovals: (list(body.noteRemovals) ?? []) as NoteRemoval[],
    boards: (obj(body.boards) ?? {}) as Boards,
    manual: (obj(body.manual) ?? {}) as ManualStories,
    highlights: (obj(body.highlights) ?? {}) as Highlights,
    ...(obj(body.prefs) ? { prefs: body.prefs as SyncPayload["prefs"] } : {}),
    ...(list(body.teams) ? { teams: (body.teams as unknown[]).slice(0, 50) } : {}),
    // Opaque to this server by design; stored and handed back untouched.
    ...(body.vault ? { vault: body.vault } : {}),
    ...(stamps
      ? {
          stamps: Object.fromEntries(
            PARTS.filter((part) => Number.isFinite(Number(stamps[part])) && Number(stamps[part]) > 0).map((part) => [part, Number(stamps[part])]),
          ),
        }
      : {}),
    updatedAt: Number.isFinite(Number(body.updatedAt)) ? Number(body.updatedAt) : 0,
  };
}
