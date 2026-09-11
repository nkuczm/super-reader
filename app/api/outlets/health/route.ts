import { NextResponse } from "next/server";
import { corpusAvailable, sourceHealth } from "@/lib/corpus";
import { panelOutlets, panelSubreddits } from "@/lib/outlets";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** A source that has failed this many sweeps running has rotted, not blipped. */
const ROTTED = 3;

/**
 * How the ranking panel is actually doing.
 *
 * Breadth is a count of newsrooms, so a panel feed that stops answering
 * produces no error anyone sees — it lowers every score a little and goes on
 * doing it. The sweep records each source's outcome; this reads it back.
 *
 * Different question from /api/outlets/audit, which fetches the whole
 * directory live to find rot in the menu people add sources from. This one
 * writes and fetches nothing: it reports what the sweeps have been seeing,
 * which is the only way to catch a source that fails intermittently.
 */
export async function GET() {
  if (!corpusAvailable()) {
    return NextResponse.json(
      { available: false, reason: "Panel health needs the corpus database." },
      { status: 200 },
    );
  }

  const health = await sourceHealth();
  const expected = panelOutlets().length + panelSubreddits().length;
  const failing = health.filter((source) => !source.ok);
  const rotted = failing.filter((source) => source.fails >= ROTTED);

  return NextResponse.json({
    available: true,
    panel: {
      expected,
      // A source in the panel that has never been swept is missing from this
      // list entirely, which is worth seeing as a number.
      seen: health.length,
      failing: failing.length,
      rotted: rotted.length,
    },
    // Only the broken ones are worth reading; the rest is a count.
    sources: failing,
  });
}
