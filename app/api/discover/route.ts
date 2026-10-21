import { NextResponse } from "next/server";
import { discover } from "@/lib/discover";
import { decodeKeysHeader, KEYS_HEADER } from "@/lib/vault";
import { isPrivateHost, refuseUrl } from "@/lib/net-guard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const input = params.get("q");
  if (!input?.trim()) {
    return NextResponse.json({ error: "Missing ?q" }, { status: 400 });
  }
  // A pasted address is fetched, so it must be on the public web
  // (lib/net-guard.ts). Words, handles and directory names pass untouched.
  const refused = addressRefused(input.trim());
  if (refused) return NextResponse.json({ error: refused }, { status: 400 });
  const requested = Number.parseInt(params.get("limit") ?? "", 10);
  const limit = Number.isFinite(requested)
    ? Math.min(Math.max(requested, 1), 100)
    : 12;
  const scope = params.get("scope") === "site" ? "site" : "auto";
  try {
    const keys = decodeKeysHeader(request.headers.get(KEYS_HEADER));
    return NextResponse.json(await discover(input, limit, scope, keys));
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Lookup failed" },
      { status: 502 },
    );
  }
}

/** Why a pasted address may not be fetched, or null for anything else. */
function addressRefused(input: string): string | null {
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(input)) {
    // Only web addresses are fetched; other schemes (api:, bundle:) are not URLs to us.
    return /^https?:/i.test(input) ? refuseUrl(input) : null;
  }
  // A bare host, as "localhost:3000/feed" or "10.0.0.1" would be pasted.
  const host = input.match(/^\[?([^\s/?#\]]+?)\]?(?::\d+)?(?:[/?#]|$)/)?.[1];
  if (host && process.env.ALLOW_PRIVATE_HOSTS !== "1" && isPrivateHost(host)) return "That host is not reachable";
  return null;
}
