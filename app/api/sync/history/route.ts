import { meter } from "@/lib/db-usage";
import { NextResponse } from "next/server";
import { isConfigured } from "@/lib/db";
import { listSyncVersions, readSync, readSyncVersion } from "@/lib/sync";
import { isValidCode } from "@/lib/sync-code";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const PRIVATE = { "cache-control": "private, no-store" };

/**
 * Earlier feed lists behind a sync code (?code=), newest first; with &id=,
 * that one version's folders, sources and teams. The code is the key to the
 * feeds already, so it is the key to their history.
 */
export async function GET(request: Request) {
  meter("sync");
  if (!isConfigured()) return NextResponse.json({ error: "Sync is not set up on this deployment yet." }, { status: 503 });
  const params = new URL(request.url).searchParams;
  const code = params.get("code") ?? "";
  if (!isValidCode(code)) return NextResponse.json({ error: "That code is not valid." }, { status: 400, headers: PRIVATE });
  try {
    if (!(await readSync(code))) return NextResponse.json({ error: "No feeds found for that code." }, { status: 404, headers: PRIVATE });
    const id = params.get("id");
    if (id) {
      const version = await readSyncVersion(code, id);
      if (!version) return NextResponse.json({ error: "That version is gone." }, { status: 404, headers: PRIVATE });
      return NextResponse.json({ version }, { headers: PRIVATE });
    }
    return NextResponse.json({ versions: await listSyncVersions(code) }, { headers: PRIVATE });
  } catch {
    return NextResponse.json({ error: "Could not reach sync storage." }, { status: 502, headers: PRIVATE });
  }
}
