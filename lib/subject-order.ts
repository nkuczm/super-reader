/**
 * The order of the Subjects page: pinned subjects first, then by whichever
 * date was chosen. Pure, so the page and the tests agree.
 */

export type SubjectSort = "opened" | "edited" | "created" | "name";
export type SortDir = "desc" | "asc";

export type SubjectRow = {
  id: string;
  name: string;
  pinned: boolean;
  /** When it was made. */
  created: number;
  /** When it was last opened or added to on this device; 0 if never. */
  opened: number;
  /** When anything in it last changed. */
  edited: number;
};

export function sortSubjects<T extends SubjectRow>(rows: T[], by: SubjectSort, dir: SortDir): T[] {
  const sign = dir === "asc" ? 1 : -1;
  const key = (r: T) => (by === "opened" ? r.opened : by === "edited" ? r.edited : r.created);
  return [...rows].sort((a, b) => {
    if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
    if (by === "name") return sign * a.name.localeCompare(b.name, undefined, { sensitivity: "base" }) || b.created - a.created;
    // Never opened sorts last whichever way the dates run.
    if (by === "opened" && !a.opened !== !b.opened) return a.opened ? -1 : 1;
    return sign * (key(a) - key(b)) || b.created - a.created;
  });
}
