import { meter } from "@/lib/db-usage";
import { readLibrary, writeLibrary } from "@/lib/library-store";
import { json, requireAccount } from "@/lib/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** The account's library (lib/library.ts): what changed after ?since=<cursor>, a page at a time. */
export async function GET(request: Request) {
  meter("library");
  const guard = await requireAccount(request);
  if ("response" in guard) return guard.response;
  const since = new URL(request.url).searchParams.get("since");
  return json(await readLibrary(guard.account.id, since));
}

const MAX_BYTES = 3 * 1024 * 1024;

/** A device's changed items ({ items: [...] }); each replaces the account's copy only if it is newer. */
export async function PUT(request: Request) {
  meter("library");
  const guard = await requireAccount(request, { write: true });
  if ("response" in guard) return guard.response;
  const text = await request.text();
  if (text.length > MAX_BYTES) return json({ error: "Too large to save in one go." }, { status: 413 });
  let items: unknown[] = [];
  try {
    const parsed = JSON.parse(text);
    if (Array.isArray(parsed?.items)) items = parsed.items;
  } catch {
    return json({ error: "Expected JSON" }, { status: 400 });
  }
  return json({ taken: await writeLibrary(guard.account.id, items) });
}
