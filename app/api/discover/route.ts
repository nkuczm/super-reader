import { NextResponse } from "next/server";
import { discover } from "@/lib/discover";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const input = params.get("q");
  if (!input?.trim()) {
    return NextResponse.json({ error: "Missing ?q" }, { status: 400 });
  }
  const requested = Number.parseInt(params.get("limit") ?? "", 10);
  const limit = Number.isFinite(requested)
    ? Math.min(Math.max(requested, 1), 100)
    : 12;
  const scope = params.get("scope") === "site" ? "site" : "auto";
  try {
    return NextResponse.json(await discover(input, limit, scope));
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Lookup failed" },
      { status: 502 },
    );
  }
}
