import { meter } from "@/lib/db-usage";
import { NextResponse } from "next/server";
import { corpusAvailable, readPulse, WINDOW_HOURS } from "@/lib/corpus";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * The panel's quiet stories: what Discover is made of (lib/novelty.ts).
 *
 * The same for every reader, so nothing is sent and the answer can be cached
 * at the edge: each reader's device scores these against its own list, and
 * the server never learns what anyone follows. Read from the ranking as last
 * built, after the scheduled sweep — this never sweeps or rebuilds anything
 * a reader's ranking request would not.
 */
export async function GET() {
  meter("pulse");
  if (!corpusAvailable()) {
    return NextResponse.json({ available: false, stories: [] });
  }
  try {
    const payload = await readPulse();
    return NextResponse.json(
      {
        available: true,
        builtAt: payload.builtAt,
        windowHours: WINDOW_HOURS,
        outletCount: payload.outletCount,
        stories: payload.quiet ?? [],
      },
      // Rebuilt twice a day; a quarter of an hour stale costs nothing.
      { headers: { "cache-control": "public, max-age=300, s-maxage=900, stale-while-revalidate=3600" } },
    );
  } catch (error) {
    return NextResponse.json(
      { available: false, stories: [], error: error instanceof Error ? error.message : "failed" },
      { status: 500 },
    );
  }
}
