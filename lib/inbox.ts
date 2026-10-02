/**
 * The browser extension's inbox: articles saved from the page being read,
 * waiting for a device on the same sync code to file them.
 *
 * The extension reads the article in the reader's own browser — so a site
 * that refuses this app's server (lib/subscriptions.ts, docs/COLLECTION.md
 * §8) still gives the reader their own copy — and posts it here. The app
 * picks items up on its next sync, files them into Saved (with the text in
 * the device's offline store) and into a subject if one was chosen, then
 * clears them. Nothing stays here once filed; an item no device collects is
 * dropped after a week.
 *
 * The app also leaves the names of its subjects here, so the extension can
 * offer them without reading the rest of the sync document.
 */

import { getSql, ensureSchema } from "./db";
import { hashCode } from "./sync-code";
import type { ReadableArticle } from "./article";
import { canonicalUrl } from "./url";

export type InboxItem = {
  id: string;
  savedAt: number;
  article: ReadableArticle;
  /** File into this subject, or a new one of this name. */
  subjectId?: string;
  newSubject?: string;
  /** Text selected on the page, filed as a quote; and a note under it. */
  quote?: string;
  note?: string;
  /** A person captured from a profile page, to add to the subject's contacts. */
  contact?: { name: string; role?: string; linkedin?: string; photo?: string };
};

export type SubjectIndex = { id: string; name: string }[];

export const MAX_ITEMS = 30;
const ITEM_TTL_MS = 7 * 24 * 60 * 60 * 1000;

let ready: Promise<void> | null = null;
async function ensureInbox() {
  await ensureSchema();
  if (!ready) {
    ready = (async () => {
      await getSql()`
        CREATE TABLE IF NOT EXISTS extension_inbox (
          code_hash  TEXT PRIMARY KEY,
          subjects   JSONB NOT NULL DEFAULT '[]'::jsonb,
          items      JSONB NOT NULL DEFAULT '[]'::jsonb,
          updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
        )
      `;
      // The text each saved page had in the reader's browser, kept so every
      // device on the code can read it — not only the one that filed it.
      await getSql()`
        CREATE TABLE IF NOT EXISTS extension_pages (
          code_hash TEXT NOT NULL,
          url_key   TEXT NOT NULL,
          article   JSONB NOT NULL,
          saved_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
          PRIMARY KEY (code_hash, url_key)
        )
      `;
    })().catch((error) => {
      ready = null;
      throw error;
    });
  }
  return ready;
}

export async function readInbox(code: string): Promise<{ subjects: SubjectIndex; items: InboxItem[] }> {
  await ensureInbox();
  const rows = await getSql()`SELECT subjects, items FROM extension_inbox WHERE code_hash = ${hashCode(code)}`;
  const now = Date.now();
  return {
    subjects: (rows[0]?.subjects as SubjectIndex) ?? [],
    items: ((rows[0]?.items as InboxItem[]) ?? []).filter((item) => now - item.savedAt < ITEM_TTL_MS),
  };
}

/** Pages kept per code; the oldest go first past this. */
const MAX_PAGES = 500;

export async function savePage(code: string, article: ReadableArticle) {
  await ensureInbox();
  const sql = getSql();
  const key = hashCode(code);
  await sql`
    INSERT INTO extension_pages (code_hash, url_key, article) VALUES (${key}, ${canonicalUrl(article.url)}, ${JSON.stringify(article)}::jsonb)
    ON CONFLICT (code_hash, url_key) DO UPDATE SET article = EXCLUDED.article, saved_at = now()
  `;
  await sql`
    DELETE FROM extension_pages WHERE code_hash = ${key} AND url_key NOT IN (
      SELECT url_key FROM extension_pages WHERE code_hash = ${key} ORDER BY saved_at DESC LIMIT ${MAX_PAGES}
    )
  `;
}

/** The copy of a page the reader saved from their browser, if there is one. */
export async function readPage(code: string, url: string): Promise<ReadableArticle | null> {
  await ensureInbox();
  const rows = await getSql()`
    SELECT article FROM extension_pages WHERE code_hash = ${hashCode(code)} AND url_key = ${canonicalUrl(url)}
  `;
  return (rows[0]?.article as ReadableArticle) ?? null;
}

export async function addInboxItem(code: string, item: InboxItem) {
  if (item.article.html) await savePage(code, item.article);
  const { items } = await readInbox(code);
  const next = [...items.filter((i) => i.id !== item.id), item].slice(-MAX_ITEMS);
  await getSql()`
    INSERT INTO extension_inbox (code_hash, items) VALUES (${hashCode(code)}, ${JSON.stringify(next)}::jsonb)
    ON CONFLICT (code_hash) DO UPDATE SET items = EXCLUDED.items, updated_at = now()
  `;
}

export async function clearInboxItems(code: string, ids: string[]) {
  const { items } = await readInbox(code);
  const gone = new Set(ids);
  await getSql()`
    UPDATE extension_inbox SET items = ${JSON.stringify(items.filter((i) => !gone.has(i.id)))}::jsonb, updated_at = now()
    WHERE code_hash = ${hashCode(code)}
  `;
}

export async function setSubjectIndex(code: string, subjects: SubjectIndex) {
  await ensureInbox();
  const clean = subjects
    .filter((s) => s && typeof s.id === "string" && typeof s.name === "string")
    .slice(0, 300)
    .map((s) => ({ id: s.id.slice(0, 80), name: s.name.slice(0, 200) }));
  await getSql()`
    INSERT INTO extension_inbox (code_hash, subjects) VALUES (${hashCode(code)}, ${JSON.stringify(clean)}::jsonb)
    ON CONFLICT (code_hash) DO UPDATE SET subjects = EXCLUDED.subjects, updated_at = now()
  `;
}
