import { meter } from "@/lib/db-usage";
import { accountsReady, currentAccount, json, signInProblem } from "@/lib/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Whether sign-in exists here, and who is signed in. */
export async function GET(request: Request) {
  meter("auth");
  const account = await currentAccount(request);
  const enabled = await accountsReady();
  // Said, not hidden: a server with sign-in off otherwise just loses the button.
  return json({ enabled, account, problem: enabled ? null : await signInProblem() });
}
