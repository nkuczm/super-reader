import { meter } from "@/lib/db-usage";
import { CodeTakenError, linkSyncCode, writeSubjects } from "@/lib/accounts";
import { detachWriting } from "@/lib/sync";
import { json, requireAccount } from "@/lib/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Tie this device's sync code to the signed-in account (or learn the one
 * already tied), and move any writing the code was carrying into the account,
 * where the code alone can no longer read it.
 */
export async function POST(request: Request) {
  meter("subjects");
  const guard = await requireAccount(request, { write: true });
  if ("response" in guard) return guard.response;
  const body = await request.json().catch(() => ({}));
  const offered = typeof body.code === "string" && body.code.trim() ? body.code.trim().slice(0, 200) : null;

  let code: string | null;
  try {
    code = await linkSyncCode(guard.account.id, offered);
  } catch (error) {
    if (error instanceof CodeTakenError) return json({ error: error.message, taken: true }, { status: 409 });
    throw error;
  }
  for (const each of new Set([offered, code].filter((c): c is string => !!c))) {
    const writing = await detachWriting(each);
    if (writing.notes.length || Object.keys(writing.boards).length) {
      await writeSubjects(guard.account.id, writing, { reason: "moved from sync code" });
    }
  }
  return json({ code });
}
