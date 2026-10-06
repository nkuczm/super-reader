import { meter } from "@/lib/db-usage";
import { listPrefsVersions, restorePrefsVersion } from "@/lib/accounts";
import { json, requireAccount } from "@/lib/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Earlier copies of this account's settings and keys: when, and which keys (names only). */
export async function GET(request: Request) {
  meter("settings");
  const guard = await requireAccount(request);
  if ("response" in guard) return guard.response;
  return json({ versions: await listPrefsVersions(guard.account.id) });
}

/** Bring back the keys an earlier copy held that the account has since lost. */
export async function POST(request: Request) {
  meter("settings");
  const guard = await requireAccount(request, { write: true });
  if ("response" in guard) return guard.response;
  const body = await request.json().catch(() => null);
  const id = typeof body?.id === "string" ? body.id : "";
  const result = await restorePrefsVersion(guard.account.id, id);
  if (!result) return json({ error: "That copy is gone." }, { status: 404 });
  return json(result);
}
