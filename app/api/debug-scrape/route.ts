import { NextResponse } from "next/server";
import { fetchText } from "@/lib/feed";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// TEMPORARY diagnostic: inspect how a listing page exposes its article links.
export async function GET(request: Request) {
  const url = new URL(request.url).searchParams.get("url");
  if (!url) return NextResponse.json({ error: "Missing ?url" }, { status: 400 });

  const { body, finalUrl } = await fetchText(url);
  const withoutScripts = body.replace(/<script[\s\S]*?<\/script>/gi, "");

  const slugs = (all: string) => {
    const found = new Set<string>();
    for (const m of all.matchAll(/\/news\/([a-z0-9][a-z0-9-]{3,})/gi)) {
      found.add(m[1]);
    }
    return [...found];
  };

  const anchors = [...withoutScripts.matchAll(/<a\b[^>]*href=["']([^"']+)["']/gi)]
    .map((m) => m[1])
    .filter((h) => h.includes("/news/"));

  // Probe likely pagination shapes to see whether more articles are reachable.
  const probes = ["?page=2", "/page/2", "?p=2", "/archive", "/all"];
  const base = finalUrl.replace(/\/$/, "");
  const pagination = await Promise.all(
    probes.map(async (suffix) => {
      const target = suffix.startsWith("?") ? base + suffix : base + suffix;
      try {
        const res = await fetchText(target);
        return {
          probe: target,
          bytes: res.body.length,
          slugs: slugs(res.body).length,
          sample: slugs(res.body).slice(0, 5),
        };
      } catch (e) {
        return { probe: target, error: e instanceof Error ? e.message : "failed" };
      }
    }),
  );

  const relNext = body.match(/<link[^>]+rel=["']next["'][^>]*>/i)?.[0];

  return NextResponse.json({
    finalUrl,
    pagination,
    relNext: relNext ?? null,
    htmlBytes: body.length,
    bytesOutsideScripts: withoutScripts.length,
    newsSlugsAnywhere: slugs(body).length,
    newsSlugsOutsideScripts: slugs(withoutScripts).length,
    anchorHrefsToNews: anchors.length,
    hasNextFlight: body.includes("self.__next_f"),
    hasNextData: body.includes("__NEXT_DATA__"),
    sampleAnywhere: slugs(body).slice(0, 40),
    sampleOutsideScripts: slugs(withoutScripts).slice(0, 40),
  });
}
