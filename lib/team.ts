import { getSql, ensureSchema } from "./db";
import { hashCode, newSyncCode } from "./sync-code";

/**
 * A team feed: one shared list of articles behind a connect code.
 *
 * It is deliberately not a second sync. Sync carries a whole device document
 * — feeds, read state, the vault — and resolves by most recent change, which
 * means one device's copy wins and the others' is dropped. That is right for
 * one person's own devices and wrong for several people: two colleagues saving
 * a story in the same minute must both end up on the list.
 *
 * So a team feed stores articles and nothing else, and every write is a merge
 * of one article into the list rather than a replacement of it. Nothing about
 * who saved it, what else they follow, or what they have read travels here.
 */
export type TeamArticle = {
  id: string;
  title: string;
  link: string;
  author?: string;
  publishedAt?: string;
  summary?: string;
  image?: string;
  /** The publication, for the byline — not the person who shared it. */
  sourceTitle?: string;
  favicon?: string;
  /** When it was added to the team feed. */
  savedAt: number;
};

export type TeamRecord = {
  name: string;
  articles: TeamArticle[];
  updatedAt: string;
};

/** Keeps a shared list from growing without bound; the oldest drop off. */
export const MAX_TEAM_ARTICLES = 500;

/** One article, not a document: far smaller than a sync payload needs to be. */
export const MAX_ARTICLE_BYTES = 24 * 1024;

export const MAX_NAME_LENGTH = 60;

let ready: Promise<void> | null = null;

/**
 * Its own table rather than a column on feed_syncs: a team feed outlives any
 * one member's sync code, and several people share it.
 */
function ensureTeamSchema() {
  if (!ready) {
    const sql = getSql();
    ready = (async () => {
      await ensureSchema();
      await sql`
        CREATE TABLE IF NOT EXISTS team_feeds (
          code_hash  TEXT PRIMARY KEY,
          name       TEXT NOT NULL,
          articles   JSONB NOT NULL DEFAULT '[]'::jsonb,
          updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
          created_at TIMESTAMPTZ NOT NULL DEFAULT now()
        )
      `;
    })().catch((error) => {
      // Let the next request retry rather than caching a failure forever.
      ready = null;
      throw error;
    });
  }
  return ready;
}

export function cleanName(input: unknown) {
  const name = typeof input === "string" ? input.trim() : "";
  return (name || "Team").slice(0, MAX_NAME_LENGTH);
}

/**
 * Strip an incoming article to the fields a team feed carries. Whatever else
 * the sender's copy holds — read state, offline marks, source ids — is not
 * theirs to share, so it does not survive the trip.
 */
export function cleanArticle(input: unknown): TeamArticle | null {
  const value = input as Record<string, unknown> | null;
  if (!value || typeof value !== "object") return null;

  const link = typeof value.link === "string" ? value.link.trim() : "";
  const title = typeof value.title === "string" ? value.title.trim() : "";
  if (!link || !/^https?:\/\//i.test(link) || !title) return null;

  const text = (key: string) => {
    const raw = value[key];
    return typeof raw === "string" && raw.trim() ? raw.trim() : undefined;
  };

  // Built key by key, and a field that is not there is left out rather than
  // stored as null: the row is the whole of what is shared, so it should say
  // exactly what the article had.
  const optional = (key: keyof TeamArticle, value?: string) =>
    value === undefined ? {} : { [key]: value };

  const article: TeamArticle = {
    id: typeof value.id === "string" && value.id ? value.id : link,
    title,
    link,
    ...optional("author", text("author")),
    ...optional("publishedAt", text("publishedAt")),
    ...optional("summary", text("summary")?.slice(0, 1200)),
    ...optional("image", text("image")),
    ...optional("sourceTitle", text("sourceTitle")),
    ...optional("favicon", text("favicon")),
    savedAt: Date.now(),
  };
  if (JSON.stringify(article).length > MAX_ARTICLE_BYTES) return null;
  return article;
}

export async function createTeam(name: string): Promise<{ code: string; name: string }> {
  await ensureTeamSchema();
  const sql = getSql();
  const code = newSyncCode();
  const clean = cleanName(name);
  await sql`
    INSERT INTO team_feeds (code_hash, name)
    VALUES (${hashCode(code)}, ${clean})
  `;
  return { code, name: clean };
}

function toRecord(row: Record<string, any> | undefined): TeamRecord | null {
  if (!row) return null;
  return {
    name: row.name as string,
    articles: (row.articles ?? []) as TeamArticle[],
    updatedAt: new Date(row.updated_at).toISOString(),
  };
}

export async function readTeam(code: string): Promise<TeamRecord | null> {
  await ensureTeamSchema();
  const sql = getSql();
  const rows = await sql`
    SELECT name, articles, updated_at
    FROM team_feeds
    WHERE code_hash = ${hashCode(code)}
  `;
  return toRecord(rows[0]);
}

/**
 * Add one article to the front of the list.
 *
 * Done in a single statement rather than read-modify-write: two people saving
 * at the same moment would otherwise each write a list that does not contain
 * the other's article, and one of the two would simply vanish. Postgres
 * rebuilds the array here, so the second write sees the first.
 *
 * Saving something the feed already has moves it back to the top instead of
 * listing it twice.
 */
export async function addToTeam(
  code: string,
  article: TeamArticle,
): Promise<TeamRecord | null> {
  await ensureTeamSchema();
  const sql = getSql();
  const rows = await sql`
    UPDATE team_feeds
    SET articles = COALESCE((
          SELECT jsonb_agg(item ORDER BY ord)
          FROM (
            SELECT item, ord
            FROM (
              SELECT ${JSON.stringify(article)}::jsonb AS item, 0::bigint AS ord
              UNION ALL
              SELECT entry.item, entry.ord
              FROM jsonb_array_elements(articles)
                WITH ORDINALITY AS entry(item, ord)
              WHERE entry.item->>'link' IS DISTINCT FROM ${article.link}
            ) merged
            ORDER BY ord
            LIMIT ${MAX_TEAM_ARTICLES}
          ) kept
        ), '[]'::jsonb),
        updated_at = now()
    WHERE code_hash = ${hashCode(code)}
    RETURNING name, articles, updated_at
  `;
  return toRecord(rows[0]);
}

/** Take an article off the shared list. Anyone on the feed can. */
export async function removeFromTeam(
  code: string,
  link: string,
): Promise<TeamRecord | null> {
  await ensureTeamSchema();
  const sql = getSql();
  const rows = await sql`
    UPDATE team_feeds
    SET articles = COALESCE((
          SELECT jsonb_agg(entry.item ORDER BY entry.ord)
          FROM jsonb_array_elements(articles)
            WITH ORDINALITY AS entry(item, ord)
          WHERE entry.item->>'link' IS DISTINCT FROM ${link}
        ), '[]'::jsonb),
        updated_at = now()
    WHERE code_hash = ${hashCode(code)}
    RETURNING name, articles, updated_at
  `;
  return toRecord(rows[0]);
}
