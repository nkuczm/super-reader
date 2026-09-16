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

const ALLOWED = /(^|\.)nytimes\.com$/;

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

  /*
   * Header sets to try, to find out what the 403 on an article is actually
   * objecting to: our request's shape, or where it comes from.
   */
  const UA_CHROME =
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 " +
    "(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";
  const variants: Record<string, Record<string, string>> = {
    plain: {},
    browserish: {
      "sec-ch-ua": '"Chromium";v="131", "Not_A Brand";v="24"',
      "sec-ch-ua-mobile": "?0",
      "sec-ch-ua-platform": '"macOS"',
      "sec-fetch-dest": "document",
      "sec-fetch-mode": "navigate",
      "sec-fetch-site": "none",
      "sec-fetch-user": "?1",
      "upgrade-insecure-requests": "1",
    },
    referred: { referer: "https://www.nytimes.com/", "sec-fetch-site": "same-origin" },
    googlebot: {
      "user-agent":
        "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)",
    },
    safari: {
      "user-agent":
        "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 " +
        "(KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1",
    },
  };

  const which = new URL(request.url).searchParams.get("as");
  if (which === "all") {
    const results: Record<string, unknown> = { ua: UA_CHROME };
    for (const [name, headers] of Object.entries(variants)) {
      try {
        const { body } = await fetchText(target.toString(), 20000, headers);
        results[name] = {
          ok: true,
          bytes: body.length,
          accessFlag: body.match(/"isAccessibleForFree"\s*:\s*"?(\w+)"?/)?.[1] ?? null,
          proseWords: (body.match(/<p[ >][\s\S]*?<\/p>/gi) ?? [])
            .join(" ")
            .replace(/<[^>]+>/g, " ")
            .split(/\s+/)
            .filter(Boolean).length,
        };
      } catch (error) {
        results[name] = {
          ok: false,
          error: error instanceof Error ? error.message : String(error),
        };
      }
    }
    return NextResponse.json(results);
  }

  try {
    const { body, finalUrl } = await fetchText(
      target.toString(),
      20000,
      which ? variants[which] : undefined,
    );
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
      // How much prose is actually in the document we were handed. A locked
      // article and an open one are the same URL; this is what tells them
      // apart without a subscription in hand.
      paragraphs: (body.match(/<p[ >]/g) ?? []).length,
      proseWords: (body
        .replace(/<script[\s\S]*?<\/script>/gi, " ")
        .replace(/<style[\s\S]*?<\/style>/gi, " ")
        .match(/<p[ >][\s\S]*?<\/p>/gi) ?? [])
        .join(" ")
        .replace(/<[^>]+>/g, " ")
        .split(/\s+/)
        .filter(Boolean).length,
      // Article links, so the next call can ask about a real story.
      links: [
        ...new Set(
          (body.match(/https:\/\/www\.nytimes\.com\/20\d\d\/\d\d\/\d\d\/[a-z0-9/-]+\.html/g) ?? []),
        ),
      ].slice(0, 6),
      head: body.slice(0, 400),
    });
  } catch (error) {
    return NextResponse.json({
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}
