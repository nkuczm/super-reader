/**
 * Linking one subject from another: a chip in the writing that names the
 * subject and opens it when clicked.
 *
 * In the saved HTML it is `<a data-subject="ID">Name</a>` — the subject's id
 * and nothing else, never an address, so nothing synced can make it lead
 * anywhere but a subject of this reader's. The name inside is only a
 * fallback: on screen each chip shows the subject's current name, so a
 * rename follows everywhere it is linked, and a deleted subject says so.
 */

import { escapeHtml } from "./subjects";

export type SubjectRef = { id: string; name: string };

/** A chip clicked: the app opens that subject. */
export const SUBJECT_OPEN_EVENT = "super-reader:subject-open";
/** The list of subjects changed: chips on screen refresh their names. */
export const SUBJECTS_CHANGED_EVENT = "super-reader:subjects-changed";

/** A subject id as the app makes them, and as a chip may carry one. */
export const SUBJECT_ID = /^[A-Za-z0-9_-]{1,40}$/;

let directory: SubjectRef[] = [];
let open: string | null = null;

/** Every subject, most recently used first, and the one open now (it is not offered as a link to itself). */
export function setSubjectDirectory(subjects: SubjectRef[], current: string | null) {
  const same = open === current && subjects.length === directory.length && subjects.every((s, i) => s.id === directory[i].id && s.name === directory[i].name);
  directory = subjects;
  open = current;
  if (!same && typeof window !== "undefined") window.dispatchEvent(new Event(SUBJECTS_CHANGED_EVENT));
}

/** Subjects to offer for a link, matching what has been typed. */
export function subjectsMatching(query: string, max = 8): SubjectRef[] {
  const q = query.trim().toLowerCase();
  return directory.filter((s) => s.id !== open && (!q || s.name.toLowerCase().includes(q))).slice(0, max);
}

export const subjectNamed = (id: string) => directory.find((s) => s.id === id);

export function subjectChipHtml(subject: SubjectRef): string {
  return `<a data-subject="${escapeHtml(subject.id)}" contenteditable="false">${escapeHtml(subject.name)}</a>`;
}

/** Bring the chips in some writing up to date: each shows its subject's name now, or that it is gone. */
export function refreshSubjectChips(root: ParentNode) {
  if (!directory.length) return;
  for (const chip of root.querySelectorAll<HTMLElement>("a[data-subject]")) {
    const subject = subjectNamed(chip.dataset.subject ?? "");
    if (subject) {
      if (chip.textContent !== subject.name) chip.textContent = subject.name;
      chip.classList.remove("missing");
      chip.title = `Open ${subject.name}`;
    } else {
      chip.classList.add("missing");
      chip.title = "This subject was deleted";
    }
  }
}
