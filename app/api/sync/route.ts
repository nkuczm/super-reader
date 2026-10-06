import { meter } from "@/lib/db-usage";
import { NextResponse } from "next/server";
import { isConfigured } from "@/lib/db";
import { createSync, readSync, writeSync } from "@/lib/sync";
import { MAX_PAYLOAD_BYTES, MAX_READ, PARTS, type SyncPayload } from "@/lib/sync-doc";
import { isValidCode } from "@/lib/sync-code";
import type { Note, NoteRemoval } from "@/lib/notes";
import type { SavedArticle, SavedRemoval } from "@/lib/saved";
import type { WatchMarks } from "@/lib/alerts";
import type { Positions } from "@/lib/position";
import type { Boards } from "@/lib/subjects";
import type { ManualStories } from "@/lib/manual";
import type { Highlights } from "@/lib/highlights";

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

/** Start a new sync and get a fresh code. */
export async function POST() {
  meter("sync");
  if (!isConfigured()) return notConfigured();
  try {
    return NextResponse.json(await createSync());
  } catch {
    return NextResponse.json({ error: "Could not create a sync code." }, { status: 502 });
  }
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
  if (!Array.isArray(body.feeds)) {
    return NextResponse.json({ error: "Expected a feeds array." }, { status: 400 });
  }

  const obj = (v: unknown) => (v && typeof v === "object" && !Array.isArray(v) ? v : undefined);
  const list = (v: unknown) => (Array.isArray(v) ? v : undefined);
  const stamps = obj(body.stamps) as Record<string, unknown> | undefined;
  // Every part is passed through; writeSync (lib/sync-doc.ts) decides what is
  // kept. Pasted stories, highlights and shared settings used to be dropped
  // here, so they never reached another device.
  const payload: SyncPayload = {
    feeds: body.feeds,
    ...(list(body.read) ? { read: (body.read as unknown[]).filter((id): id is string => typeof id === "string").slice(-MAX_READ) } : {}),
    saved: (list(body.saved) ?? []) as SavedArticle[],
    savedRemovals: (list(body.savedRemovals) ?? []) as SavedRemoval[],
    watchMarks: (obj(body.watchMarks) ?? {}) as WatchMarks,
    positions: (obj(body.positions) ?? {}) as Positions,
    notes: (list(body.notes) ?? []) as Note[],
    noteRemovals: (list(body.noteRemovals) ?? []) as NoteRemoval[],
    boards: (obj(body.boards) ?? {}) as Boards,
    manual: (obj(body.manual) ?? {}) as ManualStories,
    highlights: (obj(body.highlights) ?? {}) as Highlights,
    ...(obj(body.prefs) ? { prefs: body.prefs as SyncPayload["prefs"] } : {}),
    ...(list(body.teams) ? { teams: (body.teams as unknown[]).slice(0, 50) } : {}),
    // Opaque to this server by design; stored and handed back untouched.
    ...(body.vault ? { vault: body.vault } : {}),
    ...(stamps
      ? {
          stamps: Object.fromEntries(
            PARTS.filter((part) => Number.isFinite(Number(stamps[part])) && Number(stamps[part]) > 0).map((part) => [part, Number(stamps[part])]),
          ),
        }
      : {}),
    updatedAt: Number.isFinite(Number(body.updatedAt)) ? Number(body.updatedAt) : 0,
  };

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
