import { meter, usageReport } from "@/lib/db-usage";
import { json, requireAccount } from "@/lib/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** What the app has cost the database this month, by part of the app, and what it stores. */
export async function GET(request: Request) {
  meter("usage");
  const guard = await requireAccount(request);
  if ("response" in guard) return guard.response;
  return json(await usageReport(guard.account.id));
}
