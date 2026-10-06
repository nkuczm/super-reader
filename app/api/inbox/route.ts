import { meter } from "@/lib/db-usage";
import { NextResponse } from "next/server";
import { sanitizeArticleHtml } from "@/lib/article";
import { addInboxItem, clearInboxItems, readInbox, readPage, setSubjectIndex, type InboxItem } from "@/lib/inbox";
import { readSync } from "@/lib/sync";
import { isConfigured } from "@/lib/db";
import { cleanLinkedIn, safeImage } from "@/lib/subjects";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** One saved page, text included, is far below this; a runaway page is not. */
const MAX_BODY = 2_000_000;
const PRIVATE = { "cache-control": "private, no-store" };

function reply(data: unknown, status = 200) {
  return NextResponse.json(data, { status, headers: PRIVATE });
}

/** The sync code is the key: only a code that exists has an inbox. */
async function codeFrom(value: unknown): Promise<string | null> {
  if (typeof value !== "string" || !value.trim() || value.length > 200) return null;
  if (!isConfigured()) return null;
  return (await readSync(value.trim())) ? value.trim() : null;
}

/** The waiting items, and the subjects the extension may file into. */
export async function GET(request: Request) {
  meter("inbox");
  const params = new URL(request.url).searchParams;
  const code = await codeFrom(params.get("code"));
  if (!code) return reply({ error: "That sync code was not found." }, 404);
  // One page's saved text, for a device that did not file it itself.
  const page = params.get("page");
  if (page) {
    const article = await readPage(code, page);
    return article ? reply({ article }) : reply({ error: "Not saved from the browser" }, 404);
  }
  return reply(await readInbox(code));
}

/** From the extension: one article read in the reader's own browser. */
export async function POST(request: Request) {
  meter("inbox");
  const text = await request.text();
  if (text.length > MAX_BODY) return reply({ error: "That page is too large to save." }, 413);
  let body: Record<string, unknown>;
  try {
    body = JSON.parse(text);
  } catch {
    return reply({ error: "Expected JSON" }, 400);
  }
  const code = await codeFrom(body.code);
  if (!code) return reply({ error: "That sync code was not found. Check it in Super Reader → Sync." }, 404);
  // A person from a profile page, rather than an article.
  if (body.contact && typeof body.contact === "object") {
    const c = body.contact as Record<string, unknown>;
    const name = typeof c.name === "string" ? c.name.trim().slice(0, 120) : "";
    if (!name) return reply({ error: "No name found on that page." }, 400);
    if (!body.subjectId && !body.newSubject) return reply({ error: "Choose a subject for the contact." }, 400);
    const linkedin = typeof c.linkedin === "string" ? cleanLinkedIn(c.linkedin) ?? undefined : undefined;
    const photo = typeof c.photo === "string" && c.photo.length < 200_000 ? safeImage(c.photo) : undefined;
    const pageUrl = linkedin ?? "https://www.linkedin.com/";
    const item: InboxItem = {
      id: `x${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`,
      savedAt: Date.now(),
      article: { url: pageUrl, title: name, html: "", excerpt: "", wordCount: 0 } as never,
      subjectId: typeof body.subjectId === "string" ? body.subjectId.slice(0, 80) : undefined,
      newSubject: typeof body.newSubject === "string" ? body.newSubject.trim().slice(0, 120) || undefined : undefined,
      note: typeof body.note === "string" ? body.note.trim().slice(0, 4000) || undefined : undefined,
      contact: { name, role: typeof c.role === "string" ? c.role.trim().slice(0, 200) : undefined, linkedin, photo },
    };
    await addInboxItem(code, item);
    return reply({ ok: true, title: name });
  }
  const page = (body.article ?? {}) as Record<string, unknown>;
  let url: URL;
  try {
    url = new URL(String(page.url ?? ""));
    if (url.protocol !== "https:" && url.protocol !== "http:") throw new Error();
  } catch {
    return reply({ error: "That page has no web address to save." }, 400);
  }
  const str = (v: unknown, max: number) => (typeof v === "string" && v.trim() ? v.trim().slice(0, max) : undefined);
  // Cleaned here exactly as a fetched article is: whatever a page held, only
  // text, links and pictures reach the app.
  const article = sanitizeArticleHtml(String(page.html ?? ""), url.toString(), {
    title: str(page.title, 400) ?? url.hostname,
    byline: str(page.byline, 200),
    siteName: str(page.siteName, 200),
    publishedAt: str(page.publishedAt, 60),
  });
  // A video's transcript, read in the reader's browser by the extension.
  if (page.transcript === true) article.transcript = true;
  const item: InboxItem = {
    id: `x${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`,
    savedAt: Date.now(),
    article,
    subjectId: str(body.subjectId, 80),
    newSubject: str(body.newSubject, 120),
    quote: str(body.quote, 4000),
    note: str(body.note, 4000),
  };
  await addInboxItem(code, item);
  return reply({ ok: true, title: article.title });
}

/** From the app: the subjects to offer, by name. */
export async function PUT(request: Request) {
  meter("inbox");
  const body = await request.json().catch(() => ({}));
  const code = await codeFrom(body.code);
  if (!code) return reply({ error: "That sync code was not found." }, 404);
  await setSubjectIndex(code, Array.isArray(body.subjects) ? body.subjects : []);
  return reply({ ok: true });
}

/** From the app: items it has filed. */
export async function DELETE(request: Request) {
  meter("inbox");
  const body = await request.json().catch(() => ({}));
  const code = await codeFrom(body.code);
  if (!code) return reply({ error: "That sync code was not found." }, 404);
  await clearInboxItems(code, Array.isArray(body.ids) ? body.ids.filter((id: unknown) => typeof id === "string") : []);
  return reply({ ok: true });
}
