import { meter } from "@/lib/db-usage";
import { readAccountPrefs, writeAccountPrefs } from "@/lib/accounts";
import { json, requireAccount } from "@/lib/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** The account's settings and API keys, as last changed on any device. */
export async function GET(request: Request) {
  meter("settings");
  const guard = await requireAccount(request);
  if ("response" in guard) return guard.response;
  return json({ prefs: (await readAccountPrefs(guard.account.id)) ?? null });
}

/** This device's settings and keys, merged in by which changed last; what is now held comes back. */
export async function PUT(request: Request) {
  meter("settings");
  const guard = await requireAccount(request, { write: true });
  if ("response" in guard) return guard.response;
  const body = await request.json().catch(() => null);
  if (!body || typeof body !== "object") return json({ error: "Expected JSON" }, { status: 400 });
  return json({ prefs: await writeAccountPrefs(guard.account.id, body) });
}
