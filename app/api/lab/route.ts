import { NextResponse } from "next/server";
import { fetchText } from "@/lib/feed";

/** TEMPORARY probe (docs/COLLECTION.md §5): Yahoo's "read more" article body. Removed in this session. */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const ALLOWED = /(^|\.)yahoo\.com$/;

export async function GET(request: Request) {
  const url = new URL(request.url).searchParams.get("url") ?? "";
  if (!ALLOWED.test(new URL(url).hostname)) return NextResponse.json({ error: "not allowed" }, { status: 400 });
  const { body } = await fetchText(url, 15000);
  const around = (needle: string, before = 300, after = 600) => {
    const out: string[] = [];
    let i = body.indexOf(needle);
    while (i >= 0 && out.length < 4) {
      out.push(body.slice(Math.max(0, i - before), i + after));
      i = body.indexOf(needle, i + needle.length);
    }
    return out;
  };
  const after = body.indexOf("Lessons for investors");
  return NextResponse.json({
    bytes: body.length,
    readMore: around("read-more", 200, 500),
    readMoreText: around("Read more", 300, 300),
    lessons: after >= 0 ? body.slice(after, after + 6000) : null,
    hiddenCount: (body.match(/\bhidden\b/g) ?? []).length,
    collapse: around("collapse", 150, 300).slice(0, 2),
    jsonLdArticleBody: /"articleBody"\s*:/.test(body),
    articleBodySample: around('"articleBody"', 0, 1500)[0] ?? null,
  });
}
