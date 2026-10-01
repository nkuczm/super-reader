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
  readSubjects,
  recordBackup,
  refreshTokenFor,
  setDriveFolder,
} from "./accounts";
import { accessTokenFrom, createDoc, createFolder, fileAlive, updateDoc } from "./google";
import { subjectHtml, subjectSignature } from "./subject-doc";

export const FOLDER_NAME = "Super Reader backups";

export type BackupResult = { backedUp: number; unchanged: number; failed: string[]; connected: boolean; problem?: string };

async function folderFor(accountId: string, accessToken: string) {
  const known = await driveFolderFor(accountId);
  if (known && (await fileAlive(accessToken, known))) return known;
  const folder = await createFolder(accessToken, FOLDER_NAME);
  await setDriveFolder(accountId, folder);
  return folder;
}

export async function backupSubjects(accountId: string): Promise<BackupResult> {
  const refresh = await refreshTokenFor(accountId);
  if (!refresh) return { backedUp: 0, unchanged: 0, failed: [], connected: false };
  const accessToken = await accessTokenFrom(refresh);
  const { doc } = await readSubjects(accountId);
  let folder: string | null = null;
  const result: BackupResult = { backedUp: 0, unchanged: 0, failed: [], connected: true };

  for (const note of doc.notes) {
    const board = doc.boards[note.id];
    const signature = subjectSignature(note, board);
    const state = await backupState(accountId, note.id);
    if (state.signature === signature && state.fileId) {
      result.unchanged += 1;
      continue;
    }
    try {
      const html = subjectHtml(note, board);
      if (state.fileId && (await fileAlive(accessToken, state.fileId))) {
        await updateDoc(accessToken, state.fileId, { name: note.name, html });
        await recordBackup(accountId, note.id, state.fileId, signature);
      } else {
        folder ??= await folderFor(accountId, accessToken);
        const created = await createDoc(accessToken, { name: note.name, html, folder });
        await recordBackup(accountId, note.id, created.id, signature);
      }
      result.backedUp += 1;
    } catch (error) {
      result.failed.push(note.name);
      result.problem ??= error instanceof Error ? error.message : "Backup failed";
    }
  }
  return result;
}

/** A fresh Google Doc of one subject, for the Export button. Returns its link. */
export async function exportSubject(accountId: string, subjectId: string): Promise<string> {
  const refresh = await refreshTokenFor(accountId);
  if (!refresh) throw new Error("Sign in with Google again to export to Docs.");
  const accessToken = await accessTokenFrom(refresh);
  const { doc } = await readSubjects(accountId);
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
