import { NextResponse } from "next/server";
import { extractArticle } from "@/lib/article";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
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
  const url = new URL(request.url).searchParams.get("url");
  if (!url?.trim()) {
    return NextResponse.json({ error: "Missing ?url" }, { status: 400 });
  }

  let target: URL;
  try {
    target = new URL(url);
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

  try {
    const article = await extractArticle(target.toString());
    return NextResponse.json(article, {
      headers: {
        // An article's text does not change; let the CDN serve repeat opens
        // instead of re-fetching and re-parsing the page every time.
        "cache-control":
          "public, max-age=300, s-maxage=86400, stale-while-revalidate=604800",
      },
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Could not load that article";
    // Some publishers refuse anything that is not a person in a browser.
    const blocked = /\b(401|403|429|451)\b/.test(message);
    return NextResponse.json(
      {
        error: blocked
          ? "This site doesn't allow reader view."
          : message,
      },
      { status: 502 },
    );
  }
}
