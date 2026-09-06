import { NextResponse } from "next/server";
import { extractArticle, articleFromFeedContent } from "@/lib/article";
import { fetchFeedItemContent, unwrapRedirect } from "@/lib/feed";
import { isUnresolvableAggregatorLink } from "@/lib/discover";
import { fileKindFor, readFileAsArticle } from "@/lib/files";

export const runtime = "nodejs";
// Deliberately not force-dynamic: that disables CDN caching, and an
// extracted article is worth caching between opens.
// Readability on a large page is not instant.
export const maxDuration = 30;

/**
 * This route fetches whatever URL it is handed, so keep it off the private
 * network: without this, anyone could use the deployed app to probe hosts
 * only it can reach.
 */
function isPrivateHost(hostname: string) {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (host === "localhost" || host.endsWith(".localhost")) return true;
  if (host.endsWith(".local") || host.endsWith(".internal")) return true;
  if (host === "::1" || host.startsWith("fc") || host.startsWith("fd")) return true;

  const ipv4 = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (!ipv4) return false;
  const [a, b] = ipv4.slice(1).map(Number);
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168)
  );
}

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const url = params.get("url");
  // The source feed, so a syndicated copy can stand in when the site refuses.
  const feed = params.get("feed");
  const title = params.get("title") ?? "";
  if (!url?.trim()) {
    return NextResponse.json({ error: "Missing ?url" }, { status: 400 });
  }

  let target: URL;
  try {
    // A wrapped link resolves to the publisher before anything else happens.
    target = new URL(unwrapRedirect(url));
  } catch {
    return NextResponse.json({ error: "That is not a valid URL" }, { status: 400 });
  }
  // Only fetch the public web — never internal addresses or odd schemes.
  if (target.protocol !== "https:" && target.protocol !== "http:") {
    return NextResponse.json({ error: "Unsupported URL scheme" }, { status: 400 });
  }
  // ALLOW_PRIVATE_HOSTS exists so local fixtures can be read during testing;
  // it is never set in the deployed app.
  if (process.env.ALLOW_PRIVATE_HOSTS !== "1" && isPrivateHost(target.hostname)) {
    return NextResponse.json({ error: "That host is not reachable" }, { status: 400 });
  }

  if (isUnresolvableAggregatorLink(target.toString())) {
    return NextResponse.json(
      {
        error:
          "Google News hides the publisher behind a link only a browser can follow. Open the original to read it.",
      },
      { status: 502 },
    );
  }

  // A PDF or a text file is read rather than parsed as a page. Handling it
  // here means the reader, the offline download and Saved all treat a file
  // exactly like an article, with no special case of their own.
  const declaredFile = params.get("file");
  if (declaredFile || fileKindFor(target.toString())) {
    try {
      const file = await readFileAsArticle(target.toString(), title);
      return NextResponse.json(file, {
        headers: {
          "cache-control": "public, max-age=3600",
          "CDN-Cache-Control": "public, s-maxage=86400",
          "Vercel-CDN-Cache-Control": "public, s-maxage=86400",
        },
      });
    } catch (error) {
      return NextResponse.json(
        {
          error:
            error instanceof Error ? error.message : "Could not open that file.",
        },
        { status: 502 },
      );
    }
  }

  try {
    const article = await extractArticle(target.toString());
    return NextResponse.json(article, {
      headers: {
        // An article's text does not change; let the CDN serve repeat opens
        // instead of re-fetching and re-parsing the page every time.
        // Next strips s-maxage from route handlers, so the CDN lifetime has
        // to be stated in the CDN-specific headers, which it leaves alone.
        "cache-control": "public, max-age=300",
        "cdn-cache-control":
          "public, s-maxage=86400, stale-while-revalidate=604800",
        "vercel-cdn-cache-control":
          "public, s-maxage=86400, stale-while-revalidate=604800",
      },
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Could not load that article";

    // The site would not give us the page. Many publishers syndicate the full
    // text in their own feed, so use the copy they chose to hand out.
    if (feed) {
      try {
        const content = await fetchFeedItemContent(feed, target.toString());
        if (content) {
          return NextResponse.json(
            articleFromFeedContent(content, target.toString(), title),
            { headers: { "cache-control": "public, max-age=300" } },
          );
        }
      } catch {
        /* the feed could not help either */
      }
    }

    // Some publishers refuse anything that is not a person in a browser.
    const blocked = /\b(401|403|429|451)\b/.test(message);
    return NextResponse.json(
      {
        error: blocked
          ? "This site doesn't allow reader view, and its feed doesn't carry the full text."
          : message,
      },
      { status: 502 },
    );
  }
}
