/**
 * Following an Instagram account.
 *
 * There is exactly one way to do this and it is worth being blunt about why,
 * because every other route people suggest is either broken or a bad idea:
 *
 *  - instagram.com serves a logged-out visitor a login wall. There is no
 *    public HTML to read and no RSS anywhere on the service.
 *  - The `?__a=1` JSON endpoint that bridges relied on was closed years ago,
 *    and the third-party bridges that scraped around it are rate-limited into
 *    uselessness, blocked, or ask for an account's password.
 *  - Storing someone's Instagram session cookie on this server is out for the
 *    same reason a subscription cookie is: the deployment is public, so a
 *    credential the server can use is a credential anyone with the URL can
 *    use.
 *
 * What is left is the official API, which is the same bargain X asks for: you
 * bring your own credentials. Meta only exposes other people's accounts
 * through Business Discovery, so it needs two values — a token, and the id of
 * the Instagram business account making the request. Both come from the same
 * place in Meta's developer console.
 *
 * Without them, pasting an Instagram URL says exactly that, rather than
 * failing with a 404 from a login page or silently becoming a news search for
 * the word "instagram".
 */

import { sortNewestFirst } from "./sort";
import { stripHtml } from "./feed";
import type { Article, SourceMeta } from "./types";

// Read at call time, never at module load: capture at load breaks in
// serverless and in tests, which is the lesson lib/x.ts already learned.
function apiBase() {
  return process.env.INSTAGRAM_API_BASE ?? "https://graph.instagram.com/v21.0";
}

export function instagramToken() {
  return process.env.INSTAGRAM_ACCESS_TOKEN ?? null;
}

/** The business account the request is made *as*, which Meta requires. */
export function instagramAccountId() {
  return process.env.INSTAGRAM_USER_ID ?? null;
}

export function isInstagramConfigured() {
  return Boolean(instagramToken() && instagramAccountId());
}

export const INSTAGRAM_SETUP =
  "Following Instagram accounts needs Meta's API. Add INSTAGRAM_ACCESS_TOKEN " +
  "and INSTAGRAM_USER_ID to this deployment — Instagram has no public feed, " +
  "and the account you follow must be a business or creator account.";

const HANDLE = "[A-Za-z0-9_.]{1,30}";

/**
 * Accepts an instagram.com URL, or `ig:handle`.
 *
 * Deliberately not a bare `@handle`: that already means an X account, and
 * silently changing what it resolves to would be worse than asking for four
 * more characters.
 */
export function instagramHandleFrom(input: string): string | null {
  const value = input.trim();

  const prefixed = value.match(new RegExp(`^(?:ig|instagram):@?(${HANDLE})$`, "i"));
  if (prefixed) return prefixed[1].replace(/\.$/, "");

  let url: URL;
  try {
    url = new URL(/^https?:\/\//i.test(value) ? value : `https://${value}`);
  } catch {
    return null;
  }
  if (!/(^|\.)instagram\.com$/i.test(url.hostname)) return null;

  const match = url.pathname.match(new RegExp(`^/(${HANDLE})/?$`));
  if (!match) return null;

  // Site chrome, not accounts.
  const reserved = new Set([
    "p", "reel", "reels", "stories", "explore", "accounts", "direct",
    "about", "developer", "legal", "privacy", "terms", "tv", "web",
  ]);
  const handle = match[1].replace(/\.$/, "");
  return reserved.has(handle.toLowerCase()) ? null : handle;
}

export function instagramProfileUrl(handle: string) {
  return `https://www.instagram.com/${handle}/`;
}

async function callInstagram(path: string) {
  const res = await fetch(`${apiBase()}${path}`, {
    signal: AbortSignal.timeout(12000),
  });
  const body: any = await res.json().catch(() => null);

  if (res.status === 400 || res.status === 401 || res.status === 403) {
    // Meta puts the useful part in the body; a bare status says nothing about
    // which of the several things that can be wrong is wrong.
    const detail = body?.error?.message;
    throw new Error(
      detail
        ? `Instagram refused the request: ${detail}`
        : "Instagram rejected the API credentials. Check INSTAGRAM_ACCESS_TOKEN.",
    );
  }
  if (res.status === 429) {
    throw new Error("Instagram rate limit reached. Try again later.");
  }
  if (!res.ok) throw new Error(`Instagram API error ${res.status}`);
  return body;
}

/** A caption has no title, so the opening of it becomes one. */
function titleOf(caption: string) {
  const oneLine = stripHtml(caption, Number.MAX_SAFE_INTEGER)
    .replace(/\s+/g, " ")
    .trim();
  if (!oneLine) return "Photo";
  if (oneLine.length <= 110) return oneLine;
  const cut = oneLine.slice(0, 110);
  const lastSpace = cut.lastIndexOf(" ");
  return `${cut.slice(0, lastSpace > 60 ? lastSpace : cut.length)}…`;
}

export async function fetchInstagramFeed(
  handle: string,
  limit = 20,
): Promise<{ meta: SourceMeta; articles: Article[] }> {
  const token = instagramToken();
  const account = instagramAccountId();
  if (!token || !account) throw new Error(INSTAGRAM_SETUP);

  const count = Math.min(Math.max(limit, 5), 50);
  // Business Discovery: one request returns the profile and its recent media.
  const fields =
    `business_discovery.username(${handle})` +
    "{username,name,biography,profile_picture_url,followers_count," +
    `media.limit(${count})` +
    "{id,caption,permalink,media_url,thumbnail_url,media_type,timestamp,comments_count}}";

  const body = await callInstagram(
    `/${encodeURIComponent(account)}?fields=${encodeURIComponent(fields)}` +
      `&access_token=${encodeURIComponent(token)}`,
  );

  const profile = body?.business_discovery;
  if (!profile) {
    throw new Error(
      `No Instagram account called @${handle}, or it is not a business or ` +
        "creator account — Meta's API exposes no others.",
    );
  }

  const articles: Article[] = (profile.media?.data ?? []).map((item: any): Article => {
    const caption = String(item.caption ?? "");
    return {
      id: `ig:${item.id}`,
      title: titleOf(caption),
      link: item.permalink ?? instagramProfileUrl(handle),
      author: `@${profile.username ?? handle}`,
      publishedAt: item.timestamp,
      summary: caption.replace(/\s+/g, " ").trim() || undefined,
      // A video's media_url is the video file; its thumbnail is the picture.
      image:
        item.media_type === "VIDEO"
          ? (item.thumbnail_url ?? item.media_url)
          : (item.media_url ?? item.thumbnail_url),
      commentCount:
        typeof item.comments_count === "number" ? item.comments_count : undefined,
    };
  });

  return {
    meta: {
      feedUrl: instagramProfileUrl(profile.username ?? handle),
      siteUrl: instagramProfileUrl(profile.username ?? handle),
      title: profile.name
        ? `${profile.name} (@${profile.username ?? handle})`
        : `@${profile.username ?? handle}`,
      description: profile.biography,
      favicon:
        profile.profile_picture_url ??
        "https://www.google.com/s2/favicons?domain=instagram.com&sz=64",
    },
    articles: sortNewestFirst(articles).slice(0, limit),
  };
}
