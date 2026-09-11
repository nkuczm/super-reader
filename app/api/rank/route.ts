import { NextResponse } from "next/server";
import { corpusAvailable, readPulse } from "@/lib/corpus";
import { rankAgainstPulse } from "@/lib/pulse";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

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
    return NextResponse.json({ available: false, ranked: [] });
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
    return NextResponse.json({
      available: true,
      builtAt: payload.builtAt,
      outletCount: payload.outletCount,
      storyCount: payload.storyCount,
      ranked: rankAgainstPulse(payload, wanted),
    });
  } catch (error) {
    return NextResponse.json(
      { available: false, ranked: [], error: error instanceof Error ? error.message : "failed" },
      { status: 500 },
    );
  }
}
