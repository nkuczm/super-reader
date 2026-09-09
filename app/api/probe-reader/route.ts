import { NextResponse } from "next/server";
import { extractArticle } from "@/lib/article";
import { fetchText, stripHtml } from "@/lib/feed";
import { JSDOM, VirtualConsole } from "jsdom";
import { Readability } from "@mozilla/readability";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** TEMPORARY: how well the reader does on real articles. Remove when done. */
export async function GET(request: Request) {
  // Is a raw endpoint reachable from here at all, and what does it answer?
  const raw = new URL(request.url).searchParams.get("raw");
  if (raw) {
    try {
      const res = await fetch(raw, {
        headers: {
          "user-agent":
            "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
          accept: "application/json,text/html;q=0.9,*/*;q=0.8",
        },
      });
      const body = await res.text();
      return NextResponse.json({
        status: res.status,
        contentType: res.headers.get("content-type"),
        length: body.length,
        head: body.slice(0, Number(new URL(request.url).searchParams.get("len") ?? 900)),
      });
    } catch (error) {
      return NextResponse.json({
        error: error instanceof Error ? error.message : "failed",
      });
    }
  }

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

      // Which stage loses them: Readability, or our sanitising?
      try {
        const { body, finalUrl } = await fetchText(url, 15000);
        const doc = new JSDOM(body, { url: finalUrl, virtualConsole: new VirtualConsole() })
          .window.document;
        const parsed = new Readability(doc, { charThreshold: 250 }).parse();
        const raw = parsed?.content ?? "";
        report.readabilityImages = (raw.match(/<img\b/gi) ?? []).length;
        report.readabilityFigures = (raw.match(/<figure\b/gi) ?? []).length;
        // The shape of the first images on the page, to see what lazy markup
        // they use.
        report.pageImgTags = [...body.matchAll(/<img\b[^>]*>/gi)]
          .slice(0, 3)
          .map((m) => m[0].replace(/\s+/g, " ").slice(0, 220));
      } catch (error) {
        report.readabilityImages = `failed: ${error instanceof Error ? error.message : "?"}`;
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
