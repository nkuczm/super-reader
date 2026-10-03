// TEMPORARY measurement probe — removed in the same session (docs/COLLECTION.md §5).
import { NextResponse } from "next/server";
import { fetchText } from "@/lib/feed";
import { captionTracks, pickTrack, parseTimedText } from "@/lib/youtube";

export async function GET(request: Request) {
  const id = new URL(request.url).searchParams.get("v") ?? "";
  if (!/^[A-Za-z0-9_-]{6,20}$/.test(id)) return NextResponse.json({ error: "v" }, { status: 400 });
  const out: Record<string, unknown> = {};
  try {
    const { body, finalUrl } = await fetchText(`https://www.youtube.com/watch?v=${id}&hl=en`, 9000, { "accept-language": "en-US,en;q=0.9" });
    out.watch = {
      finalUrl, bytes: body.length,
      hasPlayerResponse: body.includes("ytInitialPlayerResponse"),
      hasCaptionTracks: body.includes('"captionTracks"'),
      botCheck: /confirm you.?re not a bot|Sign in to confirm/i.test(body),
      consent: /consent\.youtube|before you continue/i.test(body),
      playability: body.match(/"playabilityStatus":\{"status":"([A-Z_]+)"/)?.[1],
      reason: body.match(/"playabilityStatus":\{[^}]*?"reason":"([^"]{0,120})/)?.[1],
    };
    const tracks = captionTracks(body);
    out.tracks = tracks.map((t) => ({ lang: t.languageCode, kind: t.kind, hasPot: /[?&]pot=/.test(t.baseUrl), exp: t.baseUrl.match(/[?&]exp=([^&]+)/)?.[1] }));
    const track = pickTrack(tracks);
    if (track) {
      for (const fmt of ["json3", ""]) {
        const u = new URL(track.baseUrl.replace(/\\u0026/g, "&"));
        if (fmt) u.searchParams.set("fmt", fmt);
        try {
          const res = await fetch(u, { signal: AbortSignal.timeout(8000), headers: { "user-agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36" } });
          const text = await res.text();
          out[`timedtext_${fmt || "xml"}`] = { status: res.status, bytes: text.length, lines: parseTimedText(text).length };
        } catch (e) {
          out[`timedtext_${fmt || "xml"}`] = { error: String(e) };
        }
      }
    }
  } catch (e) {
    out.error = String(e);
  }
  return NextResponse.json(out, { headers: { "cache-control": "no-store" } });
}
