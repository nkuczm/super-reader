import { meter } from "@/lib/db-usage";
import { readImages } from "@/lib/accounts";
import { json, requireAccount } from "@/lib/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Pictures this device lacks, by hash (?h=a,b,c): each is stored once and fetched only when needed. */
export async function GET(request: Request) {
  meter("subjects");
  const guard = await requireAccount(request);
  if ("response" in guard) return guard.response;
  const hashes = (new URL(request.url).searchParams.get("h") ?? "").split(",").filter(Boolean);
  return json({ images: await readImages(guard.account.id, hashes) });
}
