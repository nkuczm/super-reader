import { sortNewestFirst } from "./sort";
import type { Article, SourceMeta } from "./types";

/**
 * Following an X account needs the official API: x.com serves logged-out
 * visitors a login wall with no posts, and the community front-ends that used
 * to fill the gap are gone. Feedly works the same way — you bring your own
 * API credentials.
 */

// Read at call time: module-load capture breaks in serverless and in tests.
function apiBase() {
  return process.env.X_API_BASE ?? "https://api.x.com/2";
}

export function xToken() {
  return process.env.X_BEARER_TOKEN ?? null;
}

export function isXConfigured() {
  return xToken() !== null;
}

const HANDLE = "[A-Za-z0-9_]{1,15}";

/** Accepts @handle, x.com/handle, twitter.com/handle, with or without scheme. */
export function xHandleFrom(input: string): string | null {
  const value = input.trim();

  const bare = value.match(new RegExp(`^@(${HANDLE})$`));
  if (bare) return bare[1];

  const url = value.match(
    new RegExp(
      `^(?:https?://)?(?:www\\.|mobile\\.)?(?:x|twitter)\\.com/(${HANDLE})/?(?:\\?.*)?$`,
      "i",
    ),
  );
  if (!url) return null;

  // These paths are site chrome, not accounts.
  const reserved = new Set([
    "home", "explore", "search", "notifications", "messages", "settings",
    "i", "intent", "share", "login", "signup", "about", "tos", "privacy",
    "compose", "hashtag",
  ]);
  return reserved.has(url[1].toLowerCase()) ? null : url[1];
}

export function xProfileUrl(handle: string) {
  return `https://x.com/${handle}`;
}

async function callX(path: string, token: string) {
  const res = await fetch(`${apiBase()}${path}`, {
    headers: { authorization: `Bearer ${token}` },
    // X counts every call against a quota; never let one hang.
    signal: AbortSignal.timeout(12000),
  });

  if (res.status === 401) {
    throw new Error("X rejected the API key. Check X_BEARER_TOKEN.");
  }
  if (res.status === 429) {
    throw new Error("X rate limit reached. Try again in a few minutes.");
  }
  if (!res.ok) {
    throw new Error(`X API error ${res.status}`);
  }
  return res.json();
}

type XUser = {
  id: string;
  name: string;
  username: string;
  description?: string;
  profile_image_url?: string;
};

/** Posts have no title, so use the opening of the text and keep it short. */
function titleOf(text: string) {
  const oneLine = text.replace(/\s+/g, " ").trim();
  if (oneLine.length <= 110) return oneLine;
  const cut = oneLine.slice(0, 110);
  const lastSpace = cut.lastIndexOf(" ");
  return `${cut.slice(0, lastSpace > 60 ? lastSpace : cut.length)}…`;
}

export async function fetchXFeed(
  handle: string,
  limit = 20,
): Promise<{ meta: SourceMeta; articles: Article[] }> {
  const token = xToken();
  if (!token) {
    throw new Error(
      "Following X accounts needs an X API key. Add X_BEARER_TOKEN to this deployment.",
    );
  }

  const userBody = await callX(
    `/users/by/username/${encodeURIComponent(handle)}?user.fields=description,profile_image_url`,
    token,
  );
  const user: XUser | undefined = userBody?.data;
  if (!user) throw new Error(`No X account called @${handle}.`);

  // max_results must be 5-100; ask for a sensible page and trim after.
  const count = Math.min(Math.max(limit, 5), 100);
  const timeline = await callX(
    `/users/${user.id}/tweets?max_results=${count}` +
      "&exclude=replies" +
      "&tweet.fields=created_at,entities,attachments" +
      "&expansions=attachments.media_keys" +
      "&media.fields=url,preview_image_url",
    token,
  );

  const media = new Map<string, string>();
  for (const item of timeline?.includes?.media ?? []) {
    const url = item.url ?? item.preview_image_url;
    if (item.media_key && url) media.set(item.media_key, url);
  }

  const articles: Article[] = (timeline?.data ?? []).map((post: any) => {
    const key = post.attachments?.media_keys?.[0];
    return {
      id: `x:${post.id}`,
      title: titleOf(post.text ?? ""),
      link: `https://x.com/${user.username}/status/${post.id}`,
      author: `@${user.username}`,
      publishedAt: post.created_at,
      summary: (post.text ?? "").replace(/\s+/g, " ").trim() || undefined,
      image: key ? media.get(key) : undefined,
    };
  });

  return {
    meta: {
      feedUrl: xProfileUrl(user.username),
      siteUrl: xProfileUrl(user.username),
      title: `${user.name} (@${user.username})`,
      description: user.description,
      favicon:
        user.profile_image_url ??
        "https://www.google.com/s2/favicons?domain=x.com&sz=64",
    },
    articles: sortNewestFirst(articles).slice(0, limit),
  };
}
