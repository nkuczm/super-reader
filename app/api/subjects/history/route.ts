import { listVersions, readVersion } from "@/lib/accounts";
import { json, requireAccount } from "@/lib/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** The saved versions, or one of them with ?id=. */
export async function GET(request: Request) {
  const guard = await requireAccount(request);
  if ("response" in guard) return guard.response;
  const id = new URL(request.url).searchParams.get("id");
  if (id) {
    const doc = await readVersion(guard.account.id, id);
    return doc ? json({ doc }) : json({ error: "Not found" }, { status: 404 });
  }
  return json({ versions: await listVersions(guard.account.id) });
}
