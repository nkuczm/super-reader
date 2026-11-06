/**
 * Who is asking: the signed-in account behind a request, if any.
 * Server-only. See lib/accounts.ts for what an account holds.
 */

import { NextResponse } from "next/server";
import { accountForSession, SESSION_COOKIE, SESSION_DAYS, type Account } from "./accounts";
import { isConfigured as databaseConfigured } from "./db";
import { googleConfig } from "./google";
import { attribute } from "./db-meter";
import { dataKeyFits, keyStatus } from "./key-check";
import { authSecret, cookieFrom, dataKey, sameOrigin } from "./secure";

/** Sign-in works only with Google credentials, both secrets and a database. */
export function accountsEnabled() {
  return Boolean(googleConfig() && authSecret() && dataKey() && databaseConfigured());
}

/** ...and only with the DATA_KEY the saved data was sealed with (lib/key-check.ts). */
export async function accountsReady() {
  return accountsEnabled() && (await dataKeyFits());
}

/**
 * Why sign-in is off here, in words the person setting up the server can act
 * on — or null when it is on. Names settings, never their values.
 */
export async function signInProblem(): Promise<string | null> {
  const missing: string[] = [];
  if (!process.env.GOOGLE_CLIENT_ID) missing.push("GOOGLE_CLIENT_ID");
  if (!process.env.GOOGLE_CLIENT_SECRET) missing.push("GOOGLE_CLIENT_SECRET");
  if (!process.env.AUTH_SECRET) missing.push("AUTH_SECRET");
  if (!process.env.DATA_KEY) missing.push("DATA_KEY");
  if (!databaseConfigured()) missing.push("POSTGRES_URL");
  if (missing.length) return `This server is missing ${missing.join(", ")}.`;
  if (!authSecret()) return "AUTH_SECRET is too short: it needs at least 32 characters.";
  if (!dataKey()) return "DATA_KEY is not a key: it should be 44 characters ending in \"=\" (32 bytes, base64).";
  const status = await keyStatus();
  if (status === "wrong") return "DATA_KEY is not the key your saved data was locked with, so nothing has been read or changed. It must be the exact value Vercel has.";
  if (status === "unreachable") return "The database could not be reached. Check POSTGRES_URL.";
  return null;
}

export async function currentAccount(request: Request): Promise<Account | null> {
  if (!(await accountsReady())) return null;
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
  if (!(await dataKeyFits())) {
    return { response: json({ error: "This server cannot open your saved data (its DATA_KEY is not the one it was saved with), so nothing was read or changed." }, { status: 503 }) };
  }
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
