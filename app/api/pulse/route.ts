import { NextResponse } from "next/server";
import { after } from "next/server";
import {
  corpusAvailable,
  readPulse,
  lastSweeps,
  sampleHeadlines,
  PULSE_TTL_MS,
  WINDOW_HOURS,
} from "@/lib/corpus";
import { catchUpSweeps, dueSlices, sliceCount } from "@/lib/sweep";

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

  // Just the headlines, for judging what clustering made of them.
  const sample = Number(params.get("sample") ?? 0);
  if (sample > 0) {
    return NextResponse.json({ headlines: await sampleHeadlines(sample) });
  }

  try {
    const payload = await readPulse();
    const due = await dueSlices();
    if (due.length > 0) after(() => catchUpSweeps(2));

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
