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

/**
 * What to ask X for.
 *
 * `note_tweet` is the one that matters for reading: a post over 280
 * characters comes back with `text` truncated at the limit and a trailing
 * ellipsis, and the whole thing only in `note_tweet.text`. Long posts are
 * now the norm for exactly the accounts worth following as a source — a
 * thread-length analysis arrived as its first sentence.
 *
 * `public_metrics` and `referenced_tweets` are the engagement signal and the
 * "this is a retweet of" pointer; both are free with the request.
 */
const TWEET_FIELDS =
  "created_at,entities,attachments,note_tweet,public_metrics,referenced_tweets";

/** The full text of a post, which for a long one is not `text`. */
function textOf(post: any): string {
  const note = post?.note_tweet?.text;
  const text = typeof note === "string" && note.length > 0 ? note : (post?.text ?? "");
  return String(text);
}

/**
 * Turn an X response into articles.
 *
 * Shared by every kind of X source, because a list timeline and a search
 * answer in exactly the shape a user timeline does — the difference is only
 * which authors appear, which is why the author is looked up per post rather
 * than assumed.
 */
function postsToArticles(
  body: any,
  handleFor: (post: any) => string | undefined,
): Article[] {
  const media = new Map<string, string>();
  for (const item of body?.includes?.media ?? []) {
    const url = item.url ?? item.preview_image_url;
    if (item.media_key && url) media.set(item.media_key, url);
  }

  const users = new Map<string, any>();
  for (const user of body?.includes?.users ?? []) {
    if (user?.id) users.set(String(user.id), user);
  }

  return (body?.data ?? []).map((post: any): Article => {
    const key = post.attachments?.media_keys?.[0];
    const handle =
      handleFor(post) ?? users.get(String(post.author_id))?.username ?? "i";
    const text = textOf(post).replace(/\s+/g, " ").trim();
    const metrics = post.public_metrics ?? {};
    return {
      id: `x:${post.id}`,
      title: titleOf(text),
      link: `https://x.com/${handle}/status/${post.id}`,
      author: `@${handle}`,
      publishedAt: post.created_at,
      summary: text || undefined,
      image: key ? media.get(key) : undefined,
      // Replies are the closest thing a post has to a comment count, and the
      // ranking already knows what to do with one.
      commentCount:
        typeof metrics.reply_count === "number" ? metrics.reply_count : undefined,
    };
  });
}

/**
 * The X sources worth following, beyond one account.
 *
 * A list is how people actually follow a beat on X — twenty reporters
 * curated by someone who knows the subject — and a search is how a standing
 * interest is followed. Both are ordinary API reads, and both were previously
 * rejected as "site chrome" by the handle parser and turned into a Bing News
 * search for the word "i".
 */
export type XSource =
  | { kind: "account"; handle: string }
  | { kind: "list"; id: string }
  | { kind: "search"; query: string };

export function xSourceFrom(input: string): XSource | null {
  const value = input.trim();

  const handle = xHandleFrom(value);
  if (handle) return { kind: "account", handle };

  let url: URL;
  try {
    url = new URL(/^https?:\/\//i.test(value) ? value : `https://${value}`);
  } catch {
    return null;
  }
  if (!/(^|\.)(x|twitter)\.com$/i.test(url.hostname)) return null;

  const list = url.pathname.match(/^\/i\/lists\/(\d{1,25})\/?$/i);
  if (list) return { kind: "list", id: list[1] };

  if (/^\/search\/?$/i.test(url.pathname)) {
    const query = url.searchParams.get("q")?.trim();
    if (query) return { kind: "search", query };
  }

  // A hashtag page is a search by another name.
  const hashtag = url.pathname.match(/^\/hashtag\/([A-Za-z0-9_]{1,100})\/?$/i);
  if (hashtag) return { kind: "search", query: `#${hashtag[1]}` };

  return null;
}

export function xSourceUrl(source: XSource) {
  switch (source.kind) {
    case "account":
      return xProfileUrl(source.handle);
    case "list":
      return `https://x.com/i/lists/${source.id}`;
    case "search":
      return `https://x.com/search?q=${encodeURIComponent(source.query)}`;
  }
}

/** Read any X source. An account still goes through fetchXFeed. */
export async function fetchXSource(
  source: XSource,
  limit = 20,
): Promise<{ meta: SourceMeta; articles: Article[] }> {
  if (source.kind === "account") return fetchXFeed(source.handle, limit);

  const token = xToken();
  if (!token) {
    throw new Error(
      "Following X needs an X API key. Add X_BEARER_TOKEN to this deployment.",
    );
  }

  const count = Math.min(Math.max(limit, 5), 100);
  const shared =
    `&tweet.fields=${TWEET_FIELDS}` +
    "&expansions=attachments.media_keys,author_id" +
    "&media.fields=url,preview_image_url" +
    "&user.fields=username,name";

  if (source.kind === "list") {
    const body = await callX(
      `/lists/${encodeURIComponent(source.id)}/tweets?max_results=${count}${shared}`,
      token,
    );
    const articles = postsToArticles(body, () => undefined);
    if (articles.length === 0) {
      throw new Error("That X list is empty, or not visible to this API key.");
    }
    return {
      meta: {
        feedUrl: xSourceUrl(source),
        siteUrl: xSourceUrl(source),
        title: `X list ${source.id}`,
        favicon: "https://www.google.com/s2/favicons?domain=x.com&sz=64",
      },
      articles: sortNewestFirst(articles).slice(0, limit),
    };
  }

  // Recent search: the endpoint every tier can reach, covering seven days.
  // Retweets are excluded — a source made of other people's posts repeated is
  // the same story many times over.
  const query = `${source.query} -is:retweet`;
  const body = await callX(
    `/tweets/search/recent?query=${encodeURIComponent(query)}&max_results=${count}${shared}`,
    token,
  );
  return {
    meta: {
      feedUrl: xSourceUrl(source),
      siteUrl: xSourceUrl(source),
      title: `X · “${source.query}”`,
      favicon: "https://www.google.com/s2/favicons?domain=x.com&sz=64",
    },
    articles: sortNewestFirst(postsToArticles(body, () => undefined)).slice(0, limit),
  };
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
      `&tweet.fields=${TWEET_FIELDS}` +
      "&expansions=attachments.media_keys" +
      "&media.fields=url,preview_image_url",
    token,
  );

  const articles = postsToArticles(timeline, () => user.username);

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
