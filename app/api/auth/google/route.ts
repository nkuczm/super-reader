import { NextResponse } from "next/server";
import { authUrl, googleConfig, redirectUri } from "@/lib/google";
import { pkce, randomToken, sign } from "@/lib/secure";
import { accountsEnabled } from "@/lib/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Start signing in: off to Google, with a state and PKCE verifier held in a signed cookie. */
export async function GET(request: Request) {
  const config = googleConfig();
  if (!accountsEnabled() || !config) return NextResponse.redirect(new URL("/?signin=unavailable", request.url));
  const state = randomToken(24);
  const { verifier, challenge } = pkce();
  const response = NextResponse.redirect(
    authUrl({ clientId: config.clientId, redirectUri: redirectUri(request), state, challenge }),
  );
  response.cookies.set({
    name: "sr_oauth",
    value: sign(JSON.stringify({ state, verifier, at: Date.now() })),
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    path: "/api/auth",
    maxAge: 600,
  });
  return response;
}
