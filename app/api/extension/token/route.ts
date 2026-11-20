import { meter } from "@/lib/db-usage";
import { createSession } from "@/lib/accounts";
import { json, requireAccount } from "@/lib/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * A sign-in of its own for the Chrome extension, asked for from the app's own
 * page (the extension runs this request inside a Super Reader tab, so it
 * carries the app's cookie and the app's origin).
 *
 * The extension used to rely on Chrome sending the app's session cookie with
 * its own requests. On Nathan's Chrome it did not (20 Nov 2026): the app was
 * signed in at /api/auth/me while the extension's /api/inbox was not, and no
 * test browser reproduced it. A token the extension holds and sends itself
 * does not depend on how a browser treats cookies from an extension.
 * It is an ordinary session (same table, same 60 days), accepted only by
 * /api/inbox as a bearer token.
 */
export async function POST(request: Request) {
  meter("auth");
  const guard = await requireAccount(request, { write: true });
  if ("response" in guard) return guard.response;
  const { token, expires } = await createSession(guard.account.id);
  return json({ token, expires: expires.toISOString(), name: guard.account.name ?? guard.account.email });
}
