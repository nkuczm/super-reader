import { meter } from "@/lib/db-usage";
import { readSubjects, readVersion, splitImages, writeSubjects } from "@/lib/accounts";
import { restoreSubject } from "@/lib/restore";
import { json, requireAccount } from "@/lib/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Put one subject back as it was in a saved version. */
export async function POST(request: Request) {
  meter("history");
  const guard = await requireAccount(request, { write: true });
  if ("response" in guard) return guard.response;
  const body = await request.json().catch(() => ({}));
  if (typeof body.versionId !== "string" || typeof body.subjectId !== "string") {
    return json({ error: "Expected a version and a subject" }, { status: 400 });
  }
  const version = await readVersion(guard.account.id, body.versionId);
  if (!version) return json({ error: "That version was not found." }, { status: 404 });
  const { doc: current } = await readSubjects(guard.account.id);
  const restored = restoreSubject(current, version, body.subjectId);
  if (!restored) return json({ error: "That subject is not in that version." }, { status: 404 });
  const doc = (await writeSubjects(guard.account.id, restored, { replace: true, reason: "restore" })).doc ?? restored;
  // Only the restored subject goes back, with the deletions the restore made,
  // and its pictures as references: the device fills them in a few at a time
  // (a subject's pictures together could be more than one answer may hold).
  const id = body.subjectId as string;
  const one = { notes: doc.notes.filter((n) => n.id === id), noteRemovals: doc.noteRemovals ?? [], boards: doc.boards[id] ? { [id]: doc.boards[id] } : {} };
  return json({ doc: splitImages(one).doc });
}
