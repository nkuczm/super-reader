import { meter } from "@/lib/db-usage";
import { adoptCode, readAccountState } from "@/lib/account-state";
import { json, requireAccount } from "@/lib/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * A device signing in brings the sync code it had, if any, once: what the
 * code holds is folded into the account (lib/account-state.ts), and the
 * device forgets the code. Answers with what the account now holds.
 */
export async function POST(request: Request) {
  meter("subjects");
  const guard = await requireAccount(request, { write: true });
  if ("response" in guard) return guard.response;
  const body = await request.json().catch(() => ({}));
  const offered = typeof body.code === "string" && body.code.trim() ? body.code.trim().slice(0, 200) : null;
  const adopted = offered ? await adoptCode(guard.account.id, offered) : false;
  return json({ adopted, ...(await readAccountState(guard.account.id)) });
}
