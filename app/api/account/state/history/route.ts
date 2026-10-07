import { meter } from "@/lib/db-usage";
import { listAccountVersions, readAccountVersion } from "@/lib/account-state";
import { json, requireAccount } from "@/lib/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Earlier feed lists for this account, newest first; with ?id=, that one. */
export async function GET(request: Request) {
  meter("sync");
  const guard = await requireAccount(request);
  if ("response" in guard) return guard.response;
  const id = new URL(request.url).searchParams.get("id");
  if (id) {
    const version = await readAccountVersion(guard.account.id, id);
    return version ? json({ version }) : json({ error: "That version is gone." }, { status: 404 });
  }
  return json({ versions: await listAccountVersions(guard.account.id) });
}
