import { meter } from "@/lib/db-usage";
import { NextResponse } from "next/server";
import { addSpend, listSpend } from "@/lib/spend-ledger";
import { readSync } from "@/lib/sync";
import { isConfigured } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const PRIVATE = { "cache-control": "private, no-store" };

async function codeFrom(value: unknown): Promise<string | null> {
  if (typeof value !== "string" || !value.trim() || value.length > 200 || !isConfigured()) return null;
  return (await readSync(value.trim())) ? value.trim() : null;
}

/** Every device's AI runs on this sync code. */
export async function GET(request: Request) {
  meter("spend");
  const code = await codeFrom(new URL(request.url).searchParams.get("code"));
  if (!code) return NextResponse.json({ error: "That sync code was not found." }, { status: 404, headers: PRIVATE });
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
  const code = await codeFrom(body.code);
  if (!code) return NextResponse.json({ error: "That sync code was not found." }, { status: 404, headers: PRIVATE });
  await addSpend(code, Array.isArray(body.records) ? body.records : []);
  return NextResponse.json({ ok: true }, { headers: PRIVATE });
}
