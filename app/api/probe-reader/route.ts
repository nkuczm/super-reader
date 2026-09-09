import { NextResponse } from "next/server";
import { extractArticle } from "@/lib/article";
import { fetchText, stripHtml } from "@/lib/feed";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** TEMPORARY: how well the reader does on real articles. Remove when done. */
export async function GET(request: Request) {
  const urls = (new URL(request.url).searchParams.get("urls") ?? "")
    .split(",")
    .map((u) => u.trim())
    .filter(Boolean)
    .slice(0, 8);

  const results = await Promise.all(
    urls.map(async (url) => {
      const report: Record<string, unknown> = { url: url.replace(/^https?:\/\//, "").slice(0, 48) };
      try {
        const article = await extractArticle(url);
        const imgs = [...article.html.matchAll(/<img\b[^>]*>/gi)].map((m) => m[0]);
        report.words = article.wordCount;
        report.imagesKept = imgs.length;
        report.imagesWithSrc = imgs.filter((t) => /src="https?:/i.test(t)).length;
        report.figures = (article.html.match(/<figure\b/gi) ?? []).length;
        report.captions = (article.html.match(/<figcaption\b/gi) ?? []).length;
        report.headings = (article.html.match(/<h[23]\b/gi) ?? []).length;
        report.lists = (article.html.match(/<(ul|ol)\b/gi) ?? []).length;
        report.blockquotes = (article.html.match(/<blockquote\b/gi) ?? []).length;
        report.pre = (article.html.match(/<pre\b/gi) ?? []).length;
        report.byline = article.byline ?? null;
        report.leadStripped = stripHtml(article.html, 90);
      } catch (error) {
        report.error = error instanceof Error ? error.message : "failed";
      }

      // What the page itself holds, for comparison.
      try {
        const { body } = await fetchText(url, 15000);
        report.pageImages = (body.match(/<img\b/gi) ?? []).length;
        report.pageFigures = (body.match(/<figure\b/gi) ?? []).length;
        report.hasOgImage = /property=["']og:image["']/i.test(body);
      } catch {
        report.pageImages = "unreachable";
      }
      return report;
    }),
  );

  return NextResponse.json({ results });
}
