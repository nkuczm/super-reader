import { NextResponse } from "next/server";
import { OUTLETS, SUBREDDITS, PACKS } from "@/lib/outlets";
import { panelOutlets, panelSubreddits } from "@/lib/outlets";

export const runtime = "nodejs";

/**
 * The outlet directory, served rather than bundled: it is a few hundred
 * entries that only the add-source dialog needs, and shipping it in the page
 * would make every first load carry it.
 */
export async function GET() {
  return NextResponse.json(
    {
      outlets: OUTLETS,
      subreddits: SUBREDDITS,
      packs: PACKS,
      panel: { outlets: panelOutlets().length, subreddits: panelSubreddits().length },
    },
    // The directory changes when the code does, so it can be cached hard.
    { headers: { "cache-control": "public, max-age=3600, s-maxage=86400" } },
  );
}
