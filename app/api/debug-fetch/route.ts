import { NextResponse } from "next/server";

/**
 * TEMPORARY. A window onto what a site actually serves us, from a machine
 * that can reach it. Remove before finishing.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const target = params.get("url");
  const slice = Number(params.get("slice") ?? 0);
  const grep = params.get("grep");
  if (!target) return NextResponse.json({ error: "?url" }, { status: 400 });

  try {
    const res = await fetch(target, {
      headers: { "user-agent": "Mozilla/5.0 (compatible; SuperReader/1.0)" },
      redirect: "follow",
    });
    const body = await res.text();
    const headers: Record<string, string> = {};
    res.headers.forEach((value, key) => (headers[key] = value));

    return NextResponse.json({
      status: res.status,
      finalUrl: res.url,
      headers,
      length: body.length,
      ...(grep
        ? {
            matches: [...body.matchAll(new RegExp(grep, "gi"))]
              .slice(0, 40)
              .map((m) => body.slice(Math.max(0, m.index! - 120), m.index! + 240)),
          }
        : { html: body.slice(slice, slice + 6000) }),
    });
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 502 });
  }
}
