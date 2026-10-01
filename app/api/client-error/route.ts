import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Where lib/client-errors.ts sends a browser's crash. Written to the log and
 * nowhere else: the point is that it shows up in the deployment's runtime
 * logs, tagged so it can be found, and is never stored.
 */
export async function POST(request: Request) {
  const text = (await request.text().catch(() => "")).slice(0, 5000);
  let report: Record<string, unknown> = {};
  try {
    report = JSON.parse(text);
  } catch {
    return NextResponse.json({ ok: false }, { status: 400 });
  }
  const clean = (value: unknown, max: number) => String(value ?? "").slice(0, max);
  console.error(
    "[client-error]",
    JSON.stringify({
      where: clean(report.where, 60),
      message: clean(report.message, 500),
      stack: clean(report.stack, 3000),
      userAgent: clean(report.userAgent, 300),
      path: clean(report.path, 200),
    }),
  );
  return new NextResponse(null, { status: 204 });
}
