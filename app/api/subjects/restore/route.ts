import { meter } from "@/lib/db-usage";
import { inlineImages, readSubjects, readVersion, writeSubjects } from "@/lib/accounts";
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
  // Only the restored subject goes back, pictures included: the device merges it in.
  const id = body.subjectId as string;
  const one = { notes: doc.notes.filter((n) => n.id === id), noteRemovals: [], boards: doc.boards[id] ? { [id]: doc.boards[id] } : {} };
  return json({ doc: await inlineImages(guard.account.id, one) });
}
