import { meter } from "@/lib/db-usage";
import { readImages, storePictures } from "@/lib/accounts";
import { json, requireAccount } from "@/lib/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Pictures this device lacks, by hash (?h=a,b,c): as many as fit in one answer; the device asks again for the rest. */
export async function GET(request: Request) {
  meter("subjects");
  const guard = await requireAccount(request);
  if ("response" in guard) return guard.response;
  const hashes = (new URL(request.url).searchParams.get("h") ?? "").split(",").filter(Boolean);
  return json({ images: await readImages(guard.account.id, hashes) });
}

const MAX_BYTES = 4 * 1024 * 1024;

/** Pictures sent ahead of the save that uses them ({ images: { hash: dataUrl } }); answers with the hashes now held. */
export async function POST(request: Request) {
  meter("subjects");
  const guard = await requireAccount(request, { write: true });
  if ("response" in guard) return guard.response;
  const text = await request.text();
  if (text.length > MAX_BYTES) return json({ error: "Too large to save in one go." }, { status: 413 });
  let images: Record<string, unknown> = {};
  try {
    const parsed = JSON.parse(text);
    if (parsed?.images && typeof parsed.images === "object") images = parsed.images;
  } catch {
    return json({ error: "Expected JSON" }, { status: 400 });
  }
  return json({ stored: await storePictures(guard.account.id, images) });
}
