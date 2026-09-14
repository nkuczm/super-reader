import { NextResponse } from "next/server";
import { auditSlice, auditApiSlice } from "@/lib/sweep";
import { OUTLETS } from "@/lib/outlets";
import { API_PROVIDERS } from "@/lib/apis";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Is every source in the directory still alive? Nothing is written; this
 * exists so a rotted entry is found here rather than in someone's sidebar.
 *
 * `?kind=api` checks the API directory instead of the feeds. That half needs
 * a live request in a way the feeds do not: a provider whose API renamed a
 * field still answers 200, and every record falls out of the mapper on the
 * way, so the source empties with no error anywhere. The fixture tests guard
 * our end of that; only this catches the other end moving.
 */
export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const slice = Number(params.get("slice") ?? 0) || 0;

  if (params.get("kind") === "api") {
    const result = await auditApiSlice(slice);
    const broken = result.checked.filter((entry) => !entry.ok);
    return NextResponse.json({
      ...result,
      providers: API_PROVIDERS.length,
      broken: broken.length,
      checked: params.get("all") ? result.checked : broken,
    });
  }

  const result = await auditSlice(slice);
  const broken = result.checked.filter((entry) => !entry.ok);
  return NextResponse.json({
    ...result,
    outlets: OUTLETS.length,
    broken: broken.length,
    // Only failures are worth reading in full.
    checked: params.get("all") ? result.checked : broken,
  });
}
