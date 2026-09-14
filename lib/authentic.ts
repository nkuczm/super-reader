/**
 * Is this a story, or is it furniture?
 *
 * Every collection route except a well-formed feed hands back a mixture. A
 * scraped listing yields "Subscribe", "Our Standards" and three category
 * pages alongside the news. A sitemap yields section landing pages. A search
 * wrapper yields the publisher's own tag pages. None of it errors; it just
 * quietly fills a reader with things that are not articles, which is worse
 * than a short list because it teaches you to stop trusting the list.
 *
 * Nothing here is certain, so this reports a judgement with reasons rather
 * than a verdict: callers that have better evidence (a feed said so) can
 * weigh it, and the reasons are what a person reads when something they
 * expected is missing.
 */

/** Path segments that are how a site organises articles, not an article. */
const SECTION_SEGMENTS = new Set([
  "tag", "tags", "topic", "topics", "category", "categories", "section",
  "sections", "author", "authors", "byline", "contributor", "people",
  "page", "search", "archive", "archives", "index", "amp",
  "login", "signin", "sign-in", "signup", "register", "subscribe",
  "account", "profile", "settings", "preferences", "newsletter",
  "privacy", "terms", "cookies", "legal", "contact", "about", "careers",
  "jobs", "pricing", "advertise", "sitemap", "rss", "feed", "feeds",
  "shop", "store", "cart", "donate", "gift", "events", "podcasts",
]);

/** Titles that are buttons, not headlines. */
const CHROME_TITLES = new Set([
  "home", "news", "menu", "more", "read more", "continue reading", "subscribe",
  "sign in", "log in", "sign up", "register", "search", "share", "next",
  "previous", "back", "top", "latest", "all", "see all", "view all",
  "contact", "about", "about us", "privacy policy", "terms of service",
  "advertisement", "sponsored", "newsletter", "newsletters", "follow us",
  "skip to content", "accept", "close", "comments", "photos", "videos",
]);

export type Candidate = {
  title?: string;
  link: string;
  summary?: string;
  publishedAt?: string;
};

export type Judgement = {
  /** 0 to 1. Above `KEEP_ABOVE` is kept. */
  score: number;
  keep: boolean;
  /** Plain reasons, worst first — what to show when something is missing. */
  reasons: string[];
};

export const KEEP_ABOVE = 0.5;

export type Options = {
  /** The site this came from; off-site links are usually furniture. */
  origin?: string;
  /**
   * Where it came from. A feed item is an article by declaration — the
   * publisher put it in their feed — so it starts from a position of trust
   * that a link scraped off a page has to earn.
   */
  from?: "feed" | "sitemap" | "structured" | "scrape" | "search";
};

const TRUST: Record<NonNullable<Options["from"]>, number> = {
  feed: 0.95,
  sitemap: 0.8,
  structured: 0.75,
  search: 0.65,
  scrape: 0.5,
};

/** Does the last path segment read like a headline someone slugified? */
export function looksLikeSlug(pathname: string): boolean {
  const parts = pathname.replace(/\/+$/, "").split("/").filter(Boolean);
  const last = parts[parts.length - 1];
  if (!last) return false;
  const stem = last.replace(/\.(html?|php|aspx?)$/i, "");
  // Three or more hyphenated words, or words plus the id publishers append.
  const wordCount = stem.split(/[-_]/).filter((part) => /[a-z]{2,}/i.test(part)).length;
  if (wordCount >= 3) return true;
  // Numeric article ids: /story/12345678, /2026/09/14/12345
  if (/^\d{5,}$/.test(stem) && parts.length >= 2) return true;
  return false;
}

/** A date in the path — /2026/09/14/… — is a strong article signal. */
export function hasDatedPath(pathname: string): boolean {
  return /\/(19|20)\d{2}\/\d{1,2}(\/\d{1,2})?\//.test(pathname);
}

export function judge(candidate: Candidate, options: Options = {}): Judgement {
  const reasons: string[] = [];
  let score = TRUST[options.from ?? "scrape"];

  let url: URL;
  try {
    url = new URL(candidate.link);
  } catch {
    return { score: 0, keep: false, reasons: ["not a usable link"] };
  }

  if (!/^https?:$/.test(url.protocol)) {
    return { score: 0, keep: false, reasons: ["not a web link"] };
  }

  const parts = url.pathname.replace(/\/+$/, "").split("/").filter(Boolean);

  // The front page and bare section landings are never one story.
  if (parts.length === 0) {
    return { score: 0, keep: false, reasons: ["links to the site's front page"] };
  }

  for (const part of parts) {
    if (SECTION_SEGMENTS.has(part.toLowerCase())) {
      // A dated path outranks this: /news/2026/09/14/a-real-story is a story
      // even though "news" is also how the site organises itself.
      if (hasDatedPath(url.pathname) || looksLikeSlug(url.pathname)) {
        score -= 0.1;
      } else {
        return {
          score: 0,
          keep: false,
          reasons: [`"${part}" is how the site files things, not a story`],
        };
      }
      break;
    }
  }

  if (options.origin) {
    try {
      const here = new URL(options.origin).hostname.replace(/^www\./, "");
      const there = url.hostname.replace(/^www\./, "");
      const related = there === here || there.endsWith(`.${here}`) || here.endsWith(`.${there}`);
      if (!related) {
        // Not fatal — syndication and wire copy are real — but a page's
        // off-site links are mostly partners, social and advertising.
        score -= 0.25;
        reasons.push("published somewhere other than the site it was found on");
      }
    } catch {
      /* an unusable origin is the caller's problem, not this link's */
    }
  }

  const title = (candidate.title ?? "").trim();
  const flattened = title.toLowerCase().replace(/\s+/g, " ");
  if (!title) {
    score -= 0.35;
    reasons.push("no headline");
  } else if (CHROME_TITLES.has(flattened)) {
    return { score: 0, keep: false, reasons: [`"${title}" is a button, not a headline`] };
  } else if ((title.length < 12 || flattened.split(" ").length < 3) && options.from !== "feed") {
    score -= 0.3;
    reasons.push("headline too short to be one");
  }

  // A feed item is an article because the publisher put it in their feed.
  // Shape heuristics exist to judge links we found ourselves; applying them
  // to a declaration would mean overruling the only party who actually knows.
  // Plenty of blogs publish at /a-post with a four-word headline.
  const declared = options.from === "feed";

  if (looksLikeSlug(url.pathname)) score += 0.2;
  else if (parts.length === 1 && !declared) {
    score -= 0.2;
    reasons.push("a single path segment, which is usually a section");
  }

  if (hasDatedPath(url.pathname)) score += 0.15;
  if (candidate.publishedAt) score += 0.1;
  if (candidate.summary && candidate.summary.length > 40) score += 0.05;

  // A link with a query string but no path shape is nearly always a control.
  if (parts.length <= 1 && url.search && !declared) {
    score -= 0.2;
    reasons.push("looks like a link that does something rather than one to read");
  }

  const bounded = Math.max(0, Math.min(1, score));
  return { score: bounded, keep: bounded >= KEEP_ABOVE, reasons };
}

/**
 * Two listings of the same thing, worded slightly differently, are one thing.
 *
 * Canonical URLs catch most of it; this catches the rest — the same story
 * under a section path and an article path, or with the headline the desk
 * later rewrote. Kept separate from URL canonicalisation because it is a
 * judgement call and that is a rule.
 */
export function titleKey(title: string): string {
  return title
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/['’]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .split(" ")
    .slice(0, 12)
    .join(" ");
}

export type Kept<T> = { kept: T[]; dropped: { article: T; why: string }[] };

/**
 * Filter a mixed harvest down to the things that are actually articles.
 *
 * Returns what was dropped as well as what was kept. Collection fails
 * silently by nature, and a count of what a filter removed — and why — is the
 * difference between noticing that and not.
 */
export function keepArticles<T extends Candidate>(
  articles: T[],
  options: Options = {},
): Kept<T> {
  const kept: T[] = [];
  const dropped: { article: T; why: string }[] = [];
  const seenTitles = new Set<string>();

  for (const article of articles) {
    const verdict = judge(article, options);
    if (!verdict.keep) {
      dropped.push({ article, why: verdict.reasons[0] ?? "did not look like an article" });
      continue;
    }
    const key = article.title ? titleKey(article.title) : "";
    if (key && key.split(" ").length >= 4) {
      if (seenTitles.has(key)) {
        dropped.push({ article, why: "the same headline arrived twice" });
        continue;
      }
      seenTitles.add(key);
    }
    kept.push(article);
  }
  return { kept, dropped };
}
