import { NextResponse } from "next/server";
import { isConfigured } from "@/lib/db";
import {
  createSync,
  readSync,
  writeSync,
  MAX_PAYLOAD_BYTES,
} from "@/lib/sync";
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

/** Start a new sync and get a fresh code. */
export async function POST() {
  if (!isConfigured()) return notConfigured();
  try {
    return NextResponse.json(await createSync());
  } catch {
    return NextResponse.json({ error: "Could not create a sync code." }, { status: 502 });
  }
}

/** Save this device's feeds under an existing code. */
export async function PUT(request: Request) {
  if (!isConfigured()) return notConfigured();

  let body: { code?: string; feeds?: unknown; read?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Expected JSON." }, { status: 400 });
  }

  const code = body.code ?? "";
  if (!isValidCode(code)) {
    return NextResponse.json({ error: "That code is not valid." }, { status: 400 });
  }
  if (!Array.isArray(body.feeds)) {
    return NextResponse.json({ error: "Expected a feeds array." }, { status: 400 });
  }

  const payload = {
    feeds: body.feeds,
    read: Array.isArray(body.read) ? (body.read as string[]).slice(-3000) : [],
  };
  if (JSON.stringify(payload).length > MAX_PAYLOAD_BYTES) {
    return NextResponse.json({ error: "That is too much data to sync." }, { status: 413 });
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
