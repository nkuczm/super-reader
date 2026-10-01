import { endSession, SESSION_COOKIE } from "@/lib/accounts";
import { cookieFrom, sameOrigin } from "@/lib/secure";
import { json } from "@/lib/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  if (!sameOrigin(request)) return json({ error: "Cross-site request refused." }, { status: 403 });
  await endSession(cookieFrom(request, SESSION_COOKIE)).catch(() => {});
  const response = json({ ok: true });
  response.cookies.delete({ name: SESSION_COOKIE, path: "/" });
  return response;
}
