/**
 * Called every few minutes by Cloud Scheduler (docs/HOSTING.md, step 5) so
 * the server is already running when the reader is opened: Cloud Run stops
 * an idle server, and starting one again takes seconds.
 *
 * Deliberately does nothing. It must never touch the database: Neon stops
 * its own compute when idle and bills by the hour it runs, so a ping that
 * woke it every five minutes would keep it running all month.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function GET() {
  return new Response(null, { status: 204, headers: { "cache-control": "no-store" } });
}
