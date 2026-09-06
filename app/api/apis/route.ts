import { NextResponse } from "next/server";
import { apiCatalog } from "@/lib/apis";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * The API directory, for the "Add a source" catalogue. Served rather than
 * imported by the client so that whether a key is present — which only the
 * server can know — travels with each entry.
 */
export async function GET() {
  return NextResponse.json({ apis: apiCatalog() });
}
