import { NextResponse } from "next/server";
import { corpusAvailable, lastSweeps } from "@/lib/corpus";
import { sweepSlice, sliceCount, dueSlices, SWEEP_INTERVAL_MS } from "@/lib/sweep";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Read one slice of the panel into the corpus.
 *
 * Called by the schedule, by the app after a response, and by hand when
 * checking the directory's health — the per-source report is what says which
 * feed URLs have gone bad. Writing is idempotent: a slice run twice records
 * the same articles, so there is nothing to protect but the work itself,
 * which the interval below does.
 */
export async function GET(request: Request) {
  if (!corpusAvailable()) {
    return NextResponse.json({ error: "No database connected" }, { status: 503 });
  }

  const params = new URL(request.url).searchParams;
  const force = params.get("force") === "1";
  const asked = params.get("slice");

  let slice: number;
  if (asked === null || asked === "due") {
    const due = await dueSlices();
    if (due.length === 0 && !force) {
      return NextResponse.json({ skipped: "nothing due", slices: sliceCount() });
    }
    slice = due[0] ?? 0;
  } else {
    slice = Number(asked);
    if (!Number.isInteger(slice) || slice < 0 || slice >= sliceCount()) {
      return NextResponse.json(
        { error: `slice must be 0..${sliceCount() - 1}` },
        { status: 400 },
      );
    }
  }

  if (!force) {
    const last = (await lastSweeps()).find((sweep) => sweep.slice === `slice-${slice}`);
    const age = last ? Date.now() - Date.parse(last.ranAt) : Infinity;
    if (age < SWEEP_INTERVAL_MS) {
      return NextResponse.json({ skipped: "swept recently", slice, ageMs: age });
    }
  }

  // The schedule asks for several rounds in one call: a cron plan may only
  // allow a couple of firings a day, and one slice a day would never cover
  // the panel. Bounded so the request still finishes inside maxDuration.
  const rounds = Math.min(Math.max(Number(params.get("rounds") ?? 1) || 1, 1), 5);
  const results = [];
  let next: number | undefined = slice;
  for (let round = 0; round < rounds && next !== undefined; round++) {
    results.push(await sweepSlice(next));
    next = round + 1 < rounds ? (await dueSlices())[0] : undefined;
  }
  return NextResponse.json(results.length === 1 ? results[0] : { rounds: results });
}

export const POST = GET;
