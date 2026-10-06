/**
 * Who is asking: the signed-in account behind a request, if any.
 * Server-only. See lib/accounts.ts for what an account holds.
 */

import { NextResponse } from "next/server";
import { accountForSession, SESSION_COOKIE, SESSION_DAYS, type Account } from "./accounts";
import { isConfigured as databaseConfigured } from "./db";
import { googleConfig } from "./google";
import { attribute } from "./db-meter";
import { authSecret, cookieFrom, dataKey, sameOrigin } from "./secure";

/** Sign-in works only with Google credentials, both secrets and a database. */
export function accountsEnabled() {
  return Boolean(googleConfig() && authSecret() && dataKey() && databaseConfigured());
}

export async function currentAccount(request: Request): Promise<Account | null> {
  if (!accountsEnabled()) return null;
  try {
    const account = await accountForSession(cookieFrom(request, SESSION_COOKIE));
    if (account) attribute(account.id);
    return account;
  } catch {
    return null;
  }
}

const PRIVATE = { "cache-control": "private, no-store" };

export function json(data: unknown, init: ResponseInit = {}) {
  return NextResponse.json(data, { ...init, headers: { ...PRIVATE, ...(init.headers ?? {}) } });
}

/**
 * The guard for every route that touches someone's writing: signed in, and
 * — for anything that changes it — asked from this site's own pages.
 */
export async function requireAccount(
  request: Request,
  { write = false }: { write?: boolean } = {},
): Promise<{ account: Account } | { response: NextResponse }> {
  if (!accountsEnabled()) return { response: json({ error: "Sign-in is not set up on this deployment." }, { status: 503 }) };
  if (write && !sameOrigin(request)) return { response: json({ error: "Cross-site request refused." }, { status: 403 }) };
  const account = await currentAccount(request);
  if (!account) return { response: json({ error: "Sign in with Google to use Subjects.", signIn: true }, { status: 401 }) };
  return { account };
}

export function sessionCookie(token: string) {
  return {
    name: SESSION_COOKIE,
    value: token,
    httpOnly: true,
    secure: true,
    sameSite: "lax" as const,
    path: "/",
    maxAge: SESSION_DAYS * 24 * 60 * 60,
  };
}
