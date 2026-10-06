import { meter } from "@/lib/db-usage";
import { inlineImages, listVersions, readVersion } from "@/lib/accounts";
import { json, requireAccount } from "@/lib/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** The saved versions, or one of them with ?id= (narrowed to one subject, pictures included, with &subject=). */
export async function GET(request: Request) {
  meter("history");
  const guard = await requireAccount(request);
  if ("response" in guard) return guard.response;
  const params = new URL(request.url).searchParams;
  const id = params.get("id");
  if (id) {
    const doc = await readVersion(guard.account.id, id);
    if (!doc) return json({ error: "Not found" }, { status: 404 });
    const subject = params.get("subject");
    if (!subject) return json({ doc });
    const one = { notes: doc.notes.filter((n) => n.id === subject), noteRemovals: [], boards: doc.boards[subject] ? { [subject]: doc.boards[subject] } : {} };
    return json({ doc: await inlineImages(guard.account.id, one) });
  }
  return json({ versions: await listVersions(guard.account.id) });
}
