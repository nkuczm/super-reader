import { NextResponse } from "next/server";
import { fetchText } from "@/lib/feed";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// TEMPORARY: shows the raw fields a feed's first item carries, to work out
// where a polluted summary comes from. Removed once the fix is confirmed.
export async function GET(request: Request) {
  const url = new URL(request.url).searchParams.get("url");
  if (!url) return NextResponse.json({ error: "Missing ?url" }, { status: 400 });

  const { body } = await fetchText(url);
  const item = body.match(/<item[\s\S]*?<\/item>/i)?.[0] ?? "";
  const field = (name: string) =>
    item.match(new RegExp(`<${name}[^>]*>([\\s\\S]*?)</${name}>`, "i"))?.[1] ?? null;

  return NextResponse.json({
    itemBytes: item.length,
    title: field("title")?.slice(0, 200),
    description: field("description")?.slice(0, 1500),
    contentEncoded: field("content:encoded")?.slice(0, 1500),
  });
}
