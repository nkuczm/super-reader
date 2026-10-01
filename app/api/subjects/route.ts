import { readSubjects, writeSubjects, type SubjectsDoc } from "@/lib/accounts";
import { json, requireAccount } from "@/lib/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_BYTES = 4 * 1024 * 1024;

/** The signed-in account's subjects and notes. */
export async function GET(request: Request) {
  const guard = await requireAccount(request);
  if ("response" in guard) return guard.response;
  const { doc, updatedAt } = await readSubjects(guard.account.id);
  return json({ doc, updatedAt });
}

/** Merge this device's copy in; the merged whole comes back. */
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
  const { doc } = await writeSubjects(guard.account.id, incoming);
  return json({ doc, savedAt: new Date().toISOString() });
}
