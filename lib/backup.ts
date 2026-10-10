/**
 * Copying subjects into the person's Google Drive, as Google Docs.
 *
 * One Doc per subject, in a "Super Reader backups" folder, rewritten when the
 * subject has changed since its last backup — so the Drive always holds a
 * readable copy of the work that does not depend on this app existing. Drive
 * keeps its own revision history of each Doc as well.
 *
 * The device asks for a backup a few minutes after a change and when the tab
 * is put away; this only does the work for subjects whose content actually
 * differs from what was last written.
 */

import {
  backupState,
  driveFolderFor,
  inlineImages,
  readSubjects,
  recordBackup,
  recordBackupFailure,
  refreshTokenFor,
  setDriveFolder,
} from "./accounts";
import { accessTokenFrom, createDoc, createFolder, fileAlive, updateDoc } from "./google";
import { subjectHtml, subjectSignature } from "./subject-doc";
import type { Note } from "./notes";
import type { Board } from "./subjects";

export const FOLDER_NAME = "Super Reader backups";

export type BackupResult = {
  backedUp: number;
  unchanged: number;
  failed: string[];
  connected: boolean;
  problem?: string;
  /** Subjects still to write, left for the next request because this one ran out of time. */
  more?: number;
};

/**
 * How long one backup may spend. The function is stopped at 60 seconds, and
 * a stopped one answers nothing — so the device can only say "not backed up",
 * and asks again with the same work. That is what every backup did on 10 Oct
 * 2026: several subjects to rewrite, one after another, each upload allowed
 * 20 seconds. Now it stops starting subjects in time to answer, says how many
 * are left, and the device asks again for those.
 */
export const BACKUP_BUDGET_MS = 45_000;
/** No subject is started with less than this left. */
const LEAST_TO_START_MS = 12_000;
/** Subjects written to Drive at the same time. */
const AT_ONCE = 3;

async function folderFor(accountId: string, accessToken: string) {
  const known = await driveFolderFor(accountId);
  if (known && (await fileAlive(accessToken, known))) return known;
  const folder = await createFolder(accessToken, FOLDER_NAME);
  await setDriveFolder(accountId, folder);
  return folder;
}

export async function backupSubjects(
  accountId: string,
  { budget = BACKUP_BUDGET_MS, leastToStart = LEAST_TO_START_MS }: { budget?: number; leastToStart?: number } = {},
): Promise<BackupResult> {
  const started = Date.now();
  const deadline = started + budget;
  const refresh = await refreshTokenFor(accountId);
  if (!refresh) return { backedUp: 0, unchanged: 0, failed: [], connected: false };
  const accessToken = await accessTokenFrom(refresh);
  const { doc } = await readSubjects(accountId);
  let folder: Promise<string> | null = null;
  const result: BackupResult = { backedUp: 0, unchanged: 0, failed: [], connected: true };

  // What differs from its last backup — the longest waiting first, and one
  // that failed last time behind the rest, so a subject that keeps failing
  // cannot hold the others back for ever.
  const due: { note: Note; board: Board | undefined; signature: string; fileId: string | null; backedAt: number; failedAt: number }[] = [];
  for (const note of doc.notes) {
    const board = doc.boards[note.id];
    const signature = subjectSignature(note, board);
    const state = await backupState(accountId, note.id);
    if (state.signature === signature && state.fileId) result.unchanged += 1;
    else due.push({ note, board, signature, fileId: state.fileId, backedAt: state.backedAt, failedAt: state.triedAt > state.backedAt ? state.triedAt : 0 });
  }
  due.sort((a, b) => Number(a.failedAt > 0) - Number(b.failedAt > 0) || a.failedAt - b.failedAt || a.backedAt - b.backedAt);

  const timings: [number, number][] = [];
  let next = 0;
  const worker = async () => {
    while (next < due.length && deadline - Date.now() >= leastToStart) {
      const { note, board, signature, fileId } = due[next++];
      const began = Date.now();
      let bytes = 0;
      try {
        const full = await inlineImages(accountId, { notes: [note], noteRemovals: [], boards: board ? { [note.id]: board } : {} });
        const html = subjectHtml(note, full.boards[note.id]);
        bytes = html.length;
        if (fileId && (await fileAlive(accessToken, fileId, deadline))) {
          await updateDoc(accessToken, fileId, { name: note.name, html }, deadline);
          await recordBackup(accountId, note.id, fileId, signature);
        } else {
          folder ??= folderFor(accountId, accessToken);
          const created = await createDoc(accessToken, { name: note.name, html, folder: await folder }, deadline);
          await recordBackup(accountId, note.id, created.id, signature);
        }
        result.backedUp += 1;
      } catch (error) {
        result.failed.push(note.name);
        await recordBackupFailure(accountId, note.id).catch(() => {});
        const timedOut = error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError");
        result.problem ??= timedOut
          ? `Google Drive took too long to take “${note.name}” — it will be tried again.`
          : error instanceof Error ? error.message : "Backup failed";
      }
      timings.push([Date.now() - began, Math.round(bytes / 1024)]);
    }
  };
  await Promise.all(Array.from({ length: Math.min(AT_ONCE, due.length) }, worker));
  if (next < due.length) result.more = due.length - next;
  // How long each subject took and how big it was (ms, KB) — never which
  // subject — so a slow backup can be told apart from a large one.
  if (due.length) {
    console.log("backup", JSON.stringify({ subjects: doc.notes.length, due: due.length, done: result.backedUp, failed: result.failed.length, more: result.more ?? 0, ms: Date.now() - started, each: timings }));
  }
  return result;
}

/** A fresh Google Doc of one subject, for the Export button. Returns its link. */
export async function exportSubject(accountId: string, subjectId: string): Promise<string> {
  const refresh = await refreshTokenFor(accountId);
  if (!refresh) throw new Error("Sign in with Google again to export to Docs.");
  const accessToken = await accessTokenFrom(refresh);
  const doc = await inlineImages(accountId, (await readSubjects(accountId)).doc);
  const note = doc.notes.find((n) => n.id === subjectId);
  if (!note) throw new Error("That subject was not found.");
  const folder = await folderFor(accountId, accessToken);
  const stamp = new Date().toISOString().slice(0, 10);
  const created = await createDoc(accessToken, {
    name: `${note.name} — export ${stamp}`,
    html: subjectHtml(note, doc.boards[note.id]),
    folder,
  });
  return created.url;
}
