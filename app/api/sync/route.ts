import { meter } from "@/lib/db-usage";
import { NextResponse } from "next/server";
import { isConfigured } from "@/lib/db";
import { readSync, writeSync } from "@/lib/sync";
import { MAX_PAYLOAD_BYTES } from "@/lib/sync-doc";
import { cleanPayload } from "@/lib/sync-payload";
import { isValidCode } from "@/lib/sync-code";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function notConfigured() {
  return NextResponse.json(
    { error: "Sync is not set up on this deployment yet." },
    { status: 503 },
  );
}

/** Fetch the feeds behind a sync code. */
export async function GET(request: Request) {
  meter("sync");
  if (!isConfigured()) return notConfigured();

  const code = new URL(request.url).searchParams.get("code") ?? "";
  if (!isValidCode(code)) {
    return NextResponse.json({ error: "That code is not valid." }, { status: 400 });
  }

  try {
    const record = await readSync(code);
    if (!record) {
      return NextResponse.json({ error: "No feeds found for that code." }, { status: 404 });
    }
    return NextResponse.json(record);
  } catch {
    return NextResponse.json({ error: "Could not reach sync storage." }, { status: 502 });
  }
}

/**
 * New sync codes are no longer made: signing in with Google keeps a person's
 * things with their account instead (lib/account-state.ts). Codes already
 * handed out keep working for devices that have not signed in.
 */
export async function POST() {
  return NextResponse.json({ error: "Sync codes are retired. Sign in with Google to keep your things across devices." }, { status: 410 });
}

/**
 * Merge this device's copy into the code's. Nothing is refused for being
 * older: each part goes to whichever side changed it last, the rest merges,
 * and what is now held comes back for the device to catch up from.
 */
export async function PUT(request: Request) {
  meter("sync");
  if (!isConfigured()) return notConfigured();

  const text = await request.text();
  if (text.length > MAX_PAYLOAD_BYTES) {
    return NextResponse.json({ error: "That is too much data to sync." }, { status: 413 });
  }
  let body: Record<string, unknown>;
  try {
    body = JSON.parse(text);
  } catch {
    return NextResponse.json({ error: "Expected JSON." }, { status: 400 });
  }
  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "Expected JSON." }, { status: 400 });
  }

  const code = typeof body.code === "string" ? body.code : "";
  if (!isValidCode(code)) {
    return NextResponse.json({ error: "That code is not valid." }, { status: 400 });
  }
  const payload = cleanPayload(body);
  if (!payload) {
    return NextResponse.json({ error: "Expected a feeds array." }, { status: 400 });
  }

  try {
    const record = await writeSync(code, payload);
    if (!record) {
      return NextResponse.json({ error: "No feeds found for that code." }, { status: 404 });
    }
    return NextResponse.json(record);
  } catch {
    return NextResponse.json({ error: "Could not reach sync storage." }, { status: 502 });
  }
}
