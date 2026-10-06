import { meter } from "@/lib/db-usage";
import { accountsEnabled, currentAccount, json } from "@/lib/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Whether sign-in exists here, and who is signed in. */
export async function GET(request: Request) {
  meter("auth");
  const account = await currentAccount(request);
  return json({ enabled: accountsEnabled(), account });
}
