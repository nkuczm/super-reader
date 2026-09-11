import { NextResponse, after } from "next/server";
import { corpusAvailable, readPulse, WINDOW_HOURS } from "@/lib/corpus";
import { rankAgainstPulse } from "@/lib/pulse";
import { catchUpSweeps } from "@/lib/sweep";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// A catch-up sweep kicked off after the response still runs on this call.
export const maxDuration = 60;

const MAX_ARTICLES = 600;

/**
 * Rank a reader's own articles against the corpus.
 *
 * The articles are sent rather than read from storage because the app's feeds
 * live on the device, not on the server. Only the link and the headline are
 * needed, nothing is written, and what comes back is a score with its
 * reasons for the ones the press also covered — an article no other outlet
 * touched simply has no entry.
 */
export async function POST(request: Request) {
  if (!corpusAvailable()) {
    return NextResponse.json({
      available: false,
      ranked: [],
      reason: "no-database",
    });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Expected JSON" }, { status: 400 });
  }

  const articles = (body as { articles?: unknown }).articles;
  if (!Array.isArray(articles)) {
    return NextResponse.json({ error: "Expected { articles: [...] }" }, { status: 400 });
  }

  const wanted = articles
    .filter(
      (article): article is { id: string; link: string; title: string } =>
        Boolean(article) &&
        typeof (article as any).id === "string" &&
        typeof (article as any).link === "string" &&
        typeof (article as any).title === "string",
    )
    .slice(0, MAX_ARTICLES);

  try {
    const payload = await readPulse();
    // This is the request a reader makes on every refresh, and on a quiet
    // deployment it may be the only traffic there is — so it is also what
    // keeps the corpus swept, after the response rather than before it.
    after(() => catchUpSweeps(2));

    return NextResponse.json({
      available: true,
      builtAt: payload.builtAt,
      outletCount: payload.outletCount,
      storyCount: payload.storyCount,
      // The score page says what the number was measured against.
      windowHours: WINDOW_HOURS,
      // A corpus that has just started filling can rank almost nothing, and
      // saying so is better than showing an empty result as if it were an
      // answer.
      warming: payload.storyCount < 300,
      ranked: rankAgainstPulse(payload, wanted),
    });
  } catch (error) {
    return NextResponse.json(
      {
        available: false,
        ranked: [],
        reason: "failed",
        error: error instanceof Error ? error.message : "failed",
      },
      { status: 500 },
    );
  }
}
