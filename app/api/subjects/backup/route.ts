import { backupSubjects } from "@/lib/backup";
import { json, requireAccount } from "@/lib/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Bring the Google Doc backups up to date with whatever changed. */
export async function POST(request: Request) {
  const guard = await requireAccount(request, { write: true });
  if ("response" in guard) return guard.response;
  try {
    return json(await backupSubjects(guard.account.id));
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : "Backup failed" }, { status: 502 });
  }
}
