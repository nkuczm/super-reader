import { NextResponse } from "next/server";
import { JSDOM, VirtualConsole } from "jsdom";
import { Readability } from "@mozilla/readability";
import { fetchText, stripHtml } from "@/lib/feed";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** TEMPORARY: why a CourtListener opinion will not extract. Remove when done. */
export async function GET(request: Request) {
  const url = new URL(request.url).searchParams.get("url")!;
  const { body, finalUrl } = await fetchText(url, 15000);
  const make = () =>
    new JSDOM(body, { url: finalUrl, virtualConsole: new VirtualConsole() }).window.document;

  const plain = new Readability(make(), { charThreshold: 250 }).parse();

  const doc = make();
  const count = (s: string) => {
    try { return doc.querySelectorAll(s).length; } catch { return -1; }
  };
  const textOf = (s: string) => {
    const el = doc.querySelector(s);
    if (!el) return null;
    const t = (el.textContent ?? "").replace(/\s+/g, " ").trim();
    return { chars: t.length, head: t.slice(0, 160) };
  };

  // What the API itself says about this opinion.
  const id = finalUrl.match(/\/opinion\/(\d+)\//)?.[1];
  let api: unknown = null;
  if (id) {
    const key = process.env.COURTLISTENER_TOKEN;
    const res = await fetch(
      `https://www.courtlistener.com/api/rest/v4/opinions/${id}/`,
      { headers: key ? { authorization: `Token ${key}` } : {} },
    );
    const json: any = res.ok ? await res.json() : null;
    api = {
      status: res.status,
      fields: json ? Object.keys(json).slice(0, 40) : null,
      plain_text: json?.plain_text ? String(json.plain_text).length : 0,
      html: json?.html ? String(json.html).length : 0,
      html_with_citations: json?.html_with_citations
        ? String(json.html_with_citations).length
        : 0,
      head: json?.plain_text ? String(json.plain_text).slice(0, 200) : null,
    };
  }

  return NextResponse.json({
    finalUrl,
    htmlLength: body.length,
    readability: plain
      ? { title: plain.title, words: stripHtml(plain.content ?? "", 1e9).split(/\s+/).length }
      : "returned null",
    selectors: {
      "#opinion": count("#opinion"),
      ".opinion-content": count(".opinion-content"),
      "article": count("article"),
      "[class*=comment]": count("[class*=comment]"),
      "#comments": count("#comments"),
      pre: count("pre"),
    },
    bodyText: {
      opinion: textOf("#opinion"),
      opinionContent: textOf(".opinion-content"),
      article: textOf("article"),
    },
    api,
  });
}
