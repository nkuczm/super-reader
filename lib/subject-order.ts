/**
 * The order of the Subjects page: pinned subjects first, then by whichever
 * date was chosen. Pure, so the page and the tests agree.
 *
 * "Recent" is one order for everything the reader does with a subject:
 * whichever is later of the last edit and the last time it was on screen
 * (lib/subject-seen.ts) — so a subject only read this morning sits above
 * one last written in a week ago.
 */
import type { Note } from "./notes";
import type { Board, BoardItem } from "./subjects";

export type SubjectSort = "recent" | "created" | "name";
export type SortDir = "desc" | "asc";

export type SubjectRow = {
  id: string;
  name: string;
  pinned: boolean;
  /** When it was made. */
  created: number;
  /** When the reader last changed anything in it (`lastEdited`). */
  edited: number;
  /** When it was last on screen on this device, if it has been. */
  viewed?: number;
};

/** When the reader last edited or looked at a subject, whichever is later. */
export const recentOf = (row: { edited: number; viewed?: number }) => Math.max(row.edited, row.viewed ?? 0);

export function sortSubjects<T extends SubjectRow>(rows: T[], by: SubjectSort, dir: SortDir): T[] {
  const sign = dir === "asc" ? 1 : -1;
  const key = (r: T) => (by === "recent" ? recentOf(r) : r.created);
  return [...rows].sort((a, b) => {
    if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
    if (by === "name") return sign * a.name.localeCompare(b.name, undefined, { sensitivity: "base" }) || b.created - a.created;
    return sign * (key(a) - key(b)) || b.created - a.created;
  });
}

/**
 * What the app writes into a subject on its own, which is not an edit. Opening
 * a subject reads its stories' dates, authors and outlets off the articles
 * (`cardinfo`), and so does opening one of its stories; the AI files
 * insights, suggested reading and suggested people. Each is a board write
 * with the time it happened, so counting them made "Last edited" mean "last
 * opened" for some subjects and not others. A suggestion the reader acted on
 * — kept, accepted or dismissed — is no longer pending, and does count.
 */
function byTheApp(item: BoardItem) {
  switch (item.kind) {
    case "meta": // which view and tab were last open
    case "pin":
    case "color":
    case "cardinfo":
    case "insight":
      return true;
    case "suggest":
    case "contact":
      return item.state === "pending";
    default:
      return false;
  }
}

/**
 * When the reader last changed a subject: its name, what it holds, what is
 * written in it, where things sit. Taking something out is a change too, so a
 * removed item's time counts.
 */
export function lastEdited(note: Note, board: Board | undefined): number {
  let edited = Number(note.updatedAt) || Number(note.at) || 0;
  for (const entry of note.entries) {
    edited = Math.max(edited, Number(entry.at) || 0, entry.kind === "text" ? Number(entry.editedAt) || 0 : 0);
  }
  for (const item of Object.values(board ?? {})) {
    if (!item || byTheApp(item)) continue;
    const at = Number(item.at);
    if (at > edited) edited = at;
  }
  return edited;
}
