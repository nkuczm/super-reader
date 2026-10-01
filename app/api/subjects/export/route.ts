import { exportSubject } from "@/lib/backup";
import { json, requireAccount } from "@/lib/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** A new Google Doc of one subject; its link comes back. */
export async function POST(request: Request) {
  const guard = await requireAccount(request, { write: true });
  if ("response" in guard) return guard.response;
  const body = await request.json().catch(() => ({}));
  if (typeof body.subjectId !== "string") return json({ error: "Expected a subject" }, { status: 400 });
  try {
    return json({ url: await exportSubject(guard.account.id, body.subjectId) });
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : "Export failed" }, { status: 502 });
  }
}
