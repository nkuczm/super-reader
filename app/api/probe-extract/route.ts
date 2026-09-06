import { NextResponse } from "next/server";
import { JSDOM, VirtualConsole } from "jsdom";
import { Readability } from "@mozilla/readability";
import { fetchText, stripHtml } from "@/lib/feed";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** TEMPORARY: what Readability actually picks on a page. Remove when done. */
export async function GET(request: Request) {
  const url = new URL(request.url).searchParams.get("url");
  if (!url) return NextResponse.json({ error: "Missing ?url" }, { status: 400 });
  const { body, finalUrl } = await fetchText(url, 15000);
  const dom = new JSDOM(body, { url: finalUrl, virtualConsole: new VirtualConsole() });
  const doc = dom.window.document;

  const count = (selector: string) => {
    try {
      return doc.querySelectorAll(selector).length;
    } catch {
      return -1;
    }
  };

  const parsed = new Readability(doc.cloneNode(true) as Document).parse();
  const text = stripHtml(parsed?.content ?? "", Number.MAX_SAFE_INTEGER);

  const textOf = (selector: string) => {
    const el = doc.querySelector(selector);
    if (!el) return null;
    const t = (el.textContent ?? "").replace(/\s+/g, " ").trim();
    return { chars: t.length, head: t.slice(0, 200) };
  };

  return NextResponse.json({
    finalUrl,
    bodyCandidates: {
      available: textOf("div.available-content"),
      markup: textOf("div.body.markup"),
      article: textOf("article"),
    },
    paywall: /paywall|subscribe to read|for paid subscribers/i.test(body),
    htmlLength: body.length,
    title: parsed?.title,
    byline: parsed?.byline,
    words: text.split(/\s+/).length,
    head: text.slice(0, 300),
    tail: text.slice(-200),
    selectors: {
      "div.available-content": count("div.available-content"),
      "div.body.markup": count("div.body.markup"),
      "div.post-content": count("div.post-content"),
      ".comments-page": count(".comments-page"),
      "#comments": count("#comments"),
      "[class*=comment]": count("[class*=comment]"),
      ".comment__content": count(".comment__content"),
      "article": count("article"),
      "div.single-post": count("div.single-post"),
    },
  });
}
