import { NextResponse } from "next/server";
import { createSession, upsertAccount } from "@/lib/accounts";
import { exchangeCode, googleConfig, redirectUri } from "@/lib/google";
import { cookieFrom, unsign } from "@/lib/secure";
import { accountsEnabled, sessionCookie } from "@/lib/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Back from Google: check the state, trade the code, and start a session. */
export async function GET(request: Request) {
  const fail = (reason: string) => {
    const response = NextResponse.redirect(new URL(`/?signin=failed&reason=${encodeURIComponent(reason)}`, request.url));
    response.cookies.delete({ name: "sr_oauth", path: "/api/auth" });
    return response;
  };
  const config = googleConfig();
  if (!accountsEnabled() || !config) return fail("unavailable");

  const params = new URL(request.url).searchParams;
  if (params.get("error")) return fail(params.get("error") ?? "denied");
  const code = params.get("code");
  const state = params.get("state");
  const held = unsign(cookieFrom(request, "sr_oauth") ?? "");
  if (!code || !state || !held) return fail("expired");
  let saved: { state: string; verifier: string; at: number };
  try {
    saved = JSON.parse(held);
  } catch {
    return fail("expired");
  }
  if (saved.state !== state || Date.now() - saved.at > 10 * 60 * 1000) return fail("expired");

  try {
    const { identity, refreshToken } = await exchangeCode({
      code,
      verifier: saved.verifier,
      redirectUri: redirectUri(request),
      clientId: config.clientId,
      clientSecret: config.clientSecret,
    });
    await upsertAccount(
      { id: identity.sub, email: identity.email, name: identity.name, picture: identity.picture },
      refreshToken,
    );
    const { token } = await createSession(identity.sub);
    const response = NextResponse.redirect(new URL("/?signedin=1", request.url));
    response.cookies.set(sessionCookie(token));
    response.cookies.delete({ name: "sr_oauth", path: "/api/auth" });
    return response;
  } catch (error) {
    return fail(error instanceof Error ? error.message.slice(0, 80) : "failed");
  }
}
