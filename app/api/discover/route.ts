import { NextResponse } from "next/server";
import { discover } from "@/lib/discover";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const input = new URL(request.url).searchParams.get("q");
  if (!input?.trim()) {
    return NextResponse.json({ error: "Missing ?q" }, { status: 400 });
  }
  try {
    return NextResponse.json(await discover(input));
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Lookup failed" },
      { status: 502 },
    );
  }
}
