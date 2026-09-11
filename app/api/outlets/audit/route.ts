import { NextResponse } from "next/server";
import { auditSlice } from "@/lib/sweep";
import { OUTLETS } from "@/lib/outlets";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Is every feed in the directory still alive? Nothing is written; this exists
 * so a rotted entry is found here rather than in someone's sidebar.
 */
export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const slice = Number(params.get("slice") ?? 0) || 0;
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
