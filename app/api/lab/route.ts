import { NextResponse } from "next/server";
import { fetchText } from "@/lib/feed";
import { isPaywalled } from "@/lib/subscriptions";

/**
 * TEMPORARY measurement probe — delete before this branch is merged.
 *
 * docs/COLLECTION.md §5: the build sandbox cannot reach the internet, so the
 * only way to learn what a publisher actually says to this app is to ask from
 * a deployment. This is the narrow version of that: it fetches nytimes.com and
 * nothing else — no arbitrary URL, no credentials — to answer one question,
 * which is whether the New York Times answers a datacentre request at all.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ALLOWED = /^(www\.)?nytimes\.com$/;

export async function GET(request: Request) {
  const asked = new URL(request.url).searchParams.get("url") ?? "https://www.nytimes.com/";
  let target: URL;
  try {
    target = new URL(asked);
  } catch {
    return NextResponse.json({ error: "bad url" }, { status: 400 });
  }
  if (!ALLOWED.test(target.hostname)) {
    return NextResponse.json({ error: "this probe only reads nytimes.com" }, { status: 400 });
  }

  try {
    const { body, finalUrl } = await fetchText(target.toString(), 20000);
    return NextResponse.json({
      ok: true,
      finalUrl,
      bytes: body.length,
      paywallMarker: isPaywalled(body),
      // What the page says about itself, which is what decides everything
      // downstream: a wall, a bot check, or the article.
      hasJsonLd: /application\/ld\+json/.test(body),
      accessFlag: body.match(/"isAccessibleForFree"\s*:\s*"?(\w+)"?/)?.[1] ?? null,
      looksLikeBotWall: /captcha|are you a robot|access denied|unusual traffic/i.test(body),
      title: body.match(/<title[^>]*>([^<]{0,160})/i)?.[1] ?? null,
      // Enough of the top of the document to see what kind of page it is.
      head: body.slice(0, 700),
    });
  } catch (error) {
    return NextResponse.json({
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}
