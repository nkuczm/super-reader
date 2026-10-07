import { meter } from "@/lib/db-usage";
import { readAccountState, writeAccountState } from "@/lib/account-state";
import { MAX_PAYLOAD_BYTES } from "@/lib/sync-doc";
import { cleanPayload } from "@/lib/sync-payload";
import { json, requireAccount } from "@/lib/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** What this account's devices share: feeds, read marks, bookmarks and the rest (lib/account-state.ts). */
export async function GET(request: Request) {
  meter("sync");
  const guard = await requireAccount(request);
  if ("response" in guard) return guard.response;
  return json(await readAccountState(guard.account.id));
}

/** Merge this device's copy in; what the account now holds comes back. */
export async function PUT(request: Request) {
  meter("sync");
  const guard = await requireAccount(request, { write: true });
  if ("response" in guard) return guard.response;
  const text = await request.text();
  if (text.length > MAX_PAYLOAD_BYTES) return json({ error: "That is too much to save in one go." }, { status: 413 });
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    return json({ error: "Expected JSON." }, { status: 400 });
  }
  const payload = cleanPayload(body);
  if (!payload) return json({ error: "Expected a feeds array." }, { status: 400 });
  return json(await writeAccountState(guard.account.id, payload));
}
