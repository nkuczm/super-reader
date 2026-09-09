import { XMLParser } from "fast-xml-parser";
import { decodeEntities, fetchText, stripHtml, summarize, toIso } from "./feed";
import type { Article } from "./types";

/**
 * Following a subreddit.
 *
 * Reddit publishes an Atom feed per subreddit, which is enough on its own —
 * but each entry needs work before it reads as an article. Reddit puts the
 * whole post in <content>: any self text inside a <div class="md"> between
 * SC_OFF and SC_ON markers, then a footer of "submitted by /u/x" with a
 * [link] anchor (where the post points) and a [comments] anchor (the
 * discussion).
 *
 * Left alone, every item's summary reads "submitted by /u/x [link] [comments]"
 * and every link goes to Reddit's comments page, which refuses reader view —
 * so the whole feed would be unreadable in the app.
 */

const SORTS = ["hot", "new", "top", "rising", "controversial", "best"] as const;
export type RedditSort = (typeof SORTS)[number];

export type Subreddit = {
  /** The name as Reddit spells it; may be a multireddit like "a+b". */
  name: string;
  sort?: RedditSort;
  /** The window for a top listing: hour, day, week, month, year, all. */
  window?: string;
};

// 2-21 characters is Reddit's own limit; + joins a multireddit.
const NAME = "[A-Za-z0-9_]{2,21}(?:\\+[A-Za-z0-9_]{2,21})*";

/**
 * Accept a subreddit however it is pasted: r/name, /r/name, a reddit URL with
 * or without scheme, old. or www., with a sort and a time window.
 */
export function subredditFrom(input: string): Subreddit | null {
  const value = input.trim();
  if (!value) return null;

  // The bare form takes a sort too: "r/news/top" is what someone types, and
  // falling through to a news search for it is worse than useless.
  const [path, query = ""] = value.split("?");
  const bare = path.match(new RegExp(`^/?r/(${NAME})(?:/([a-z]+))?/?$`, "i"));
  if (bare) {
    const sort = SORTS.find((s) => s === bare[2]?.toLowerCase());
    // A trailing segment that is not a sort is not a subreddit — a comments
    // permalink, say, which should be read as an ordinary page.
    if (bare[2] && !sort) return null;
    const window = new URLSearchParams(query).get("t") ?? undefined;
    return {
      name: bare[1],
      ...(sort ? { sort } : {}),
      ...(sort === "top" && window ? { window } : {}),
    };
  }

  let url: URL;
  try {
    url = new URL(/^https?:\/\//i.test(value) ? value : `https://${value}`);
  } catch {
    return null;
  }
  if (!/(^|\.)reddit\.com$/i.test(url.hostname)) return null;

  const match = url.pathname.match(new RegExp(`^/r/(${NAME})(?:/([a-z]+))?/?$`, "i"));
  if (!match) return null;

  const sort = SORTS.find((s) => s === match[2]?.toLowerCase());
  const window = url.searchParams.get("t") ?? undefined;
  return { name: match[1], ...(sort ? { sort } : {}), ...(sort === "top" && window ? { window } : {}) };
}

export function subredditFeedUrl({ name, sort, window }: Subreddit) {
  const path = sort ? `/r/${name}/${sort}` : `/r/${name}`;
  const query = sort === "top" && window ? `?t=${encodeURIComponent(window)}` : "";
  return `https://www.reddit.com${path}/.rss${query}`;
}

export function subredditPageUrl({ name }: Subreddit) {
  return `https://www.reddit.com/r/${name}/`;
}

export function isRedditFeed(url: string) {
  try {
    return /(^|\.)reddit\.com$/i.test(new URL(url).hostname);
  } catch {
    return false;
  }
}

/** The post's own text, if it wrote any, without Reddit's footer. */
function selfText(content: string) {
  const body = content.match(/<!--\s*SC_OFF\s*-->([\s\S]*?)<!--\s*SC_ON\s*-->/);
  return body ? body[1] : "";
}

function anchorLabelled(content: string, label: string) {
  const match = content.match(
    new RegExp(`<a\\b[^>]*href=["']([^"']+)["'][^>]*>\\s*\\[${label}\\]\\s*</a>`, "i"),
  );
  return match ? decodeEntities(match[1]) : undefined;
}

/**
 * Turn a Reddit entry into something worth reading: point a link post at what
 * it links to, keep the discussion beside it, and use the post's own words as
 * the summary rather than Reddit's boilerplate.
 */
export function tidyRedditPost(article: Article, content: string): Article {
  const destination = anchorLabelled(content, "link");
  const comments = anchorLabelled(content, "comments") ?? article.link;
  const own = selfText(content);
  // A link post still carries an empty <div class="md">, so the markup is not
  // the test — the words inside it are.
  const ownText = stripHtml(own, Number.MAX_SAFE_INTEGER).trim();

  // A self post's [link] is its own comments page; a link post's is elsewhere.
  const isLinkPost = Boolean(
    destination && comments && destination.split("?")[0] !== comments.split("?")[0],
  );

  return {
    ...article,
    link: isLinkPost ? destination! : article.link,
    comments,
    // For a link post with no text of its own, leave the summary empty: the
    // destination's own description is fetched later and is worth more than
    // "submitted by /u/someone".
    summary: ownText ? summarize(own) || ownText.slice(0, 320) : undefined,
    // Reddit's thumbnails are tiny and often a placeholder; a link post gets a
    // real image from the destination during enrichment.
    image: isLinkPost ? undefined : article.image,
  };
}


/** A reddit post permalink: /r/<sub>/comments/<id>/<slug>. */
export function redditPostUrl(url: string): string | null {
  try {
    const parsed = new URL(url);
    if (!/^\/r\/[^/]+\/comments\/[a-z0-9]+/i.test(parsed.pathname)) return null;
    // Reddit only; a local fixture stands in for it under test.
    const local = /^127\.0\.0\.1$|^localhost$/i.test(parsed.hostname);
    if (!local && !/(^|\.)reddit\.com$/i.test(parsed.hostname)) return null;
    // www is the host that answers; old. serves the same feed.
    const origin = local ? parsed.origin : "https://www.reddit.com";
    return `${origin}${parsed.pathname.replace(/\/$/, "")}/.rss`;
  } catch {
    return null;
  }
}

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  parseTagValue: false,
  trimValues: true,
});

function textOf(node: any): string {
  if (node === undefined || node === null) return "";
  if (typeof node === "string") return node;
  if (typeof node === "object" && "#text" in node) return String(node["#text"]);
  return "";
}

function escapeHtml(value: string) {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** Bots that greet every thread; they are not the discussion. */
const BOTS = /^\/u\/(AutoModerator|RemindMeBot|sneakpeekbot|B0tRank|WikiTextBot)$/i;

export type RedditPost = {
  title: string;
  author?: string;
  publishedAt?: string;
  /** The post's own text, already unescaped HTML. */
  body: string;
  /** Where a link post points, when it is not the post itself. */
  destination?: string;
  comments: { author: string; html: string; at?: string; url?: string }[];
};

/**
 * Read a post and its replies from Reddit's own feed for it.
 *
 * Reddit's comments page refuses reader view, and its JSON API answers a
 * datacenter request with a 403 — both measured. The per-post .rss is served
 * happily and carries the whole thing: the first entry (t3_) is the post, and
 * every entry after it (t1_) is a comment.
 */
export async function readRedditPost(url: string): Promise<RedditPost | null> {
  const feedUrl = redditPostUrl(url);
  if (!feedUrl) return null;

  const { body } = await fetchText(feedUrl, 15000);
  const feed = parser.parse(body)?.feed;
  const entries: any[] = Array.isArray(feed?.entry)
    ? feed.entry
    : feed?.entry
      ? [feed.entry]
      : [];
  if (entries.length === 0) return null;

  const postEntry =
    entries.find((entry) => String(textOf(entry.id)).startsWith("t3_")) ?? entries[0];
  const content = decodeEntities(textOf(postEntry.content));

  const md = content.match(/<!--\s*SC_OFF\s*-->([\s\S]*?)<!--\s*SC_ON\s*-->/);
  const destination = content.match(
    /<a\b[^>]*href=["']([^"']+)["'][^>]*>\s*\[link\]\s*<\/a>/i,
  )?.[1];

  const comments = entries
    .filter((entry) => String(textOf(entry.id)).startsWith("t1_"))
    .map((entry) => ({
      author: textOf(entry.author?.name),
      html: decodeEntities(textOf(entry.content)),
      at: toIso(textOf(entry.updated) || textOf(entry.published)),
      url: entry.link?.["@_href"] as string | undefined,
    }))
    .filter((comment) => !BOTS.test(comment.author))
    .slice(0, 40);

  return {
    title: stripHtml(textOf(postEntry.title), 300) || "Reddit post",
    author: textOf(postEntry.author?.name) || undefined,
    publishedAt: toIso(textOf(postEntry.published) || textOf(postEntry.updated)),
    body: md ? md[1] : "",
    destination: destination && !destination.includes("/comments/") ? destination : undefined,
    comments,
  };
}

/** The post, then the discussion, as one article body. */
export function redditPostHtml(post: RedditPost): string {
  const parts: string[] = [];
  if (post.body.trim()) parts.push(post.body);
  if (post.destination) {
    let host = post.destination;
    try {
      host = new URL(post.destination).hostname.replace(/^www\./, "");
    } catch {
      /* keep the raw string */
    }
    parts.push(
      `<p><a href="${post.destination}">Read the linked article on ${escapeHtml(host)}</a></p>`,
    );
  }

  if (post.comments.length > 0) {
    parts.push(`<h2>Comments</h2>`);
    for (const comment of post.comments) {
      // The md block is exactly what they wrote; everything after it is
      // Reddit's "submitted by" footer, which by this point has already been
      // decoded, so matching on the entity would never have caught it.
      const said = selfText(comment.html) || comment.html;
      parts.push(
        `<blockquote><p><strong>${escapeHtml(comment.author)}</strong></p>${said}</blockquote>`,
      );
    }
  }

  return parts.join("\n");
}
