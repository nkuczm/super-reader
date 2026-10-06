import { sameOrigin } from "@/lib/secure";
import { NextResponse } from "next/server";
import { decodeKeysHeader, KEYS_HEADER } from "@/lib/vault";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Which OpenAI models the reader's own key can use, asked of OpenAI itself.
 * The model list in Settings is written down here and goes stale as new
 * models arrive; this is how a newer one is offered only once OpenAI says
 * the key can actually run it.
 */
export async function GET(request: Request) {
  if (!sameOrigin(request)) return NextResponse.json({ error: "Cross-site request refused." }, { status: 403 });
  const key = decodeKeysHeader(request.headers.get(KEYS_HEADER)).openai;
  if (!key) return NextResponse.json({ models: null });
  try {
    const res = await fetch("https://api.openai.com/v1/models", {
      headers: { authorization: `Bearer ${key}` },
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return NextResponse.json({ models: null, status: res.status });
    const data = (await res.json()) as { data?: { id?: unknown }[] };
    const models = (data.data ?? []).map((m) => m.id).filter((id): id is string => typeof id === "string" && /^gpt-/.test(id));
    return NextResponse.json({ models }, { headers: { "cache-control": "private, no-store" } });
  } catch {
    return NextResponse.json({ models: null });
  }
}
