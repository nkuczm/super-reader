import { NextResponse } from "next/server";
import { after } from "next/server";
import { corpusAvailable, readPulse, lastSweeps, PULSE_TTL_MS, WINDOW_HOURS } from "@/lib/corpus";
import { dueSlices, sweepSlice, sliceCount } from "@/lib/sweep";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// A slice kicked off after the response still runs on this invocation.
export const maxDuration = 60;

const TOP = 60;

/**
 * The current ranking of what the press is covering.
 *
 * Also where sweeping is driven from: any request finds the overdue slices
 * and runs a couple of them after the response has been sent, so the corpus
 * stays current for whoever asks next without the reader waiting on it.
 */
export async function GET(request: Request) {
  if (!corpusAvailable()) {
    return NextResponse.json(
      {
        available: false,
        reason:
          "Story ranking needs a database. Connect Postgres to this deployment and it starts filling itself.",
      },
      { status: 200 },
    );
  }

  const params = new URL(request.url).searchParams;
  const limit = Math.min(Number(params.get("limit") ?? TOP) || TOP, 200);

  try {
    const payload = await readPulse();
    const due = await dueSlices();
    if (due.length > 0) {
      after(async () => {
        // Two slices per request: enough to catch up over a few visits,
        // little enough that no single request spends a minute on it.
        for (const slice of due.slice(0, 2)) {
          try {
            await sweepSlice(slice);
          } catch {
            /* a failing slice is recorded by the next sweep's report */
          }
        }
      });
    }

    return NextResponse.json({
      available: true,
      builtAt: payload.builtAt,
      windowHours: WINDOW_HOURS,
      ttlMs: PULSE_TTL_MS,
      storyCount: payload.storyCount,
      outletCount: payload.outletCount,
      clusterCount: payload.clusters.length,
      slices: { total: sliceCount(), due: due.length },
      sweeps: params.get("verbose") ? await lastSweeps() : undefined,
      clusters: payload.clusters.slice(0, limit),
    });
  } catch (error) {
    return NextResponse.json(
      { available: false, reason: error instanceof Error ? error.message : "failed" },
      { status: 500 },
    );
  }
}
