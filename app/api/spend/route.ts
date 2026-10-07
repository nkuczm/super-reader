import { meter } from "@/lib/db-usage";
import { NextResponse } from "next/server";
import { addSpend, listSpend } from "@/lib/spend-ledger";
import { readSync } from "@/lib/sync";
import { currentAccount } from "@/lib/session";
import { accountKey } from "@/lib/account-state";
import { isConfigured } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const PRIVATE = { "cache-control": "private, no-store" };

/**
 * Whose inbox or ledger this is: a signed-in account's (the session cookie
 * is the key, from the app or the extension), or — for a device still on an
 * old sync code and not signed in — that code's.
 */
async function codeFrom(request: Request, value: unknown): Promise<string | null> {
  if (!isConfigured()) return null;
  const account = await currentAccount(request);
  if (account) return accountKey(account.id);
  if (typeof value !== "string" || !value.trim() || value.length > 200) return null;
  return (await readSync(value.trim())) ? value.trim() : null;
}

/** Every device's AI runs on this sync code. */
export async function GET(request: Request) {
  meter("spend");
  const code = await codeFrom(request, new URL(request.url).searchParams.get("code"));
  if (!code) return NextResponse.json({ error: "Sign in to Super Reader with Google first." }, { status: 404, headers: PRIVATE });
  return NextResponse.json({ records: await listSpend(code) }, { headers: PRIVATE });
}

/** Runs from one device, new or already sent — each counts once. */
export async function POST(request: Request) {
  meter("spend");
  const text = await request.text();
  if (text.length > 1_500_000) return NextResponse.json({ error: "Too much at once" }, { status: 413, headers: PRIVATE });
  let body: { code?: unknown; records?: unknown };
  try {
    body = JSON.parse(text);
  } catch {
    return NextResponse.json({ error: "Expected JSON" }, { status: 400, headers: PRIVATE });
  }
  const code = await codeFrom(request, body.code);
  if (!code) return NextResponse.json({ error: "Sign in to Super Reader with Google first." }, { status: 404, headers: PRIVATE });
  await addSpend(code, Array.isArray(body.records) ? body.records : []);
  return NextResponse.json({ ok: true }, { headers: PRIVATE });
}
