/**
 * Putting one subject back as it was in a saved version.
 *
 * Restoring has to survive the next sync: every device still holds the
 * current subject, and a merge keeps whatever is newest. So the restored copy
 * is stamped now — its board items, its note and its edited text — and
 * anything the subject has gained since that version is tombstoned now, so
 * the restore is the most recent thing to have happened and wins everywhere.
 * Other subjects are left exactly as they are.
 */

import type { SubjectsDoc } from "./accounts";
import type { Note, NoteEntry, NoteRemoval } from "./notes";
import type { Board } from "./subjects";

export function restoreSubject(
  current: SubjectsDoc,
  version: SubjectsDoc,
  subjectId: string,
  now = Date.now(),
): SubjectsDoc | null {
  const old = (version.notes ?? []).find((note) => note.id === subjectId);
  if (!old) return null;

  const oldBoard = version.boards?.[subjectId] ?? {};
  const currentBoard = current.boards?.[subjectId] ?? {};
  const board: Board = {};
  for (const [id, item] of Object.entries(currentBoard)) {
    if (!(id in oldBoard)) board[id] = { ...item, deleted: true, at: now };
  }
  for (const [id, item] of Object.entries(oldBoard)) board[id] = { ...item, at: now };

  // Entries are ordered by their stamp, so re-stamping in sequence keeps the
  // order while out-dating any deletion another device still remembers.
  const entries: NoteEntry[] = [...(old.entries ?? [])]
    .sort((a, b) => (Number(a.at) || 0) - (Number(b.at) || 0))
    .map((entry, i) => (entry.kind === "text" ? { ...entry, at: now + i, editedAt: now + i } : { ...entry, at: now + i }));
  const note: Note = { ...old, entries, updatedAt: now };
  const kept = new Set(entries.map((entry) => entry.id));
  const present = (current.notes ?? []).find((n) => n.id === subjectId);
  const gone: NoteRemoval[] = (present?.entries ?? [])
    .filter((entry) => !kept.has(entry.id))
    .map((entry) => ({ id: entry.id, at: now }));

  return {
    notes: [...(current.notes ?? []).filter((n) => n.id !== subjectId), note],
    noteRemovals: [
      ...(current.noteRemovals ?? []).filter((r) => r.id !== subjectId && !kept.has(r.id)),
      ...gone,
    ],
    boards: { ...(current.boards ?? {}), [subjectId]: board },
  };
}
