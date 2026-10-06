import { changesSince, MissingImages, readSubjects, writeSubjects, type SubjectsDoc } from "@/lib/accounts";
import { json, requireAccount } from "@/lib/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_BYTES = 4 * 1024 * 1024;

/**
 * The signed-in account's subjects and notes, pictures as references. With
 * ?since=<cursor>, only what changed after it — the whole copy when that is
 * not possible (`full: true`).
 */
export async function GET(request: Request) {
  const guard = await requireAccount(request);
  if ("response" in guard) return guard.response;
  const since = new URL(request.url).searchParams.get("since");
  if (since) {
    const changes = await changesSince(guard.account.id, since);
    if (changes) return json({ doc: changes.doc, cursor: changes.cursor, full: false });
  }
  const { doc, updatedAt, cursor } = await readSubjects(guard.account.id);
  return json({ doc, updatedAt, cursor, full: true });
}

/** Merge this device's changes in. Only what changed is sent, and nothing but the time comes back. */
export async function PUT(request: Request) {
  const guard = await requireAccount(request, { write: true });
  if ("response" in guard) return guard.response;
  const text = await request.text();
  if (text.length > MAX_BYTES) return json({ error: "Too large to save in one go." }, { status: 413 });
  let incoming: SubjectsDoc;
  try {
    const parsed = JSON.parse(text);
    incoming = {
      notes: Array.isArray(parsed.notes) ? parsed.notes : [],
      noteRemovals: Array.isArray(parsed.noteRemovals) ? parsed.noteRemovals : [],
      boards: parsed.boards && typeof parsed.boards === "object" ? parsed.boards : {},
    };
  } catch {
    return json({ error: "Expected JSON" }, { status: 400 });
  }
  try {
    const { changed } = await writeSubjects(guard.account.id, incoming);
    return json({ changed, savedAt: new Date().toISOString() });
  } catch (error) {
    // The device thought the server had these pictures; it sends them again.
    if (error instanceof MissingImages) return json({ error: "Pictures missing", missing: error.hashes }, { status: 409 });
    throw error;
  }
}
