import { decodeEntities, stripHtml, summarize } from "./feed";
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
