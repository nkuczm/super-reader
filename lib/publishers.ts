/**
 * Publishers whose feeds cannot be found by looking for them.
 *
 * The Wall Street Journal is the case that forced this: wsj.com answers 403
 * to anything that is not a browser, so neither its HTML nor its sitemap can
 * be read to find a feed, and its long-advertised RSS host (feeds.a.dj.com)
 * still answers 200 with every item frozen at January 2025 — the worst kind
 * of failure, because it looks like it works. Dow Jones now publishes the
 * live feeds at feeds.content.dowjones.io, which are current and carry
 * titles, summaries, bylines and direct wsj.com links.
 *
 * Full article text stays behind WSJ's paywall; these feeds give headlines
 * and summaries in the app, with the story one tap away on wsj.com.
 */

export type KnownFeed = {
  feedUrl: string;
  /** What to call the source in the sidebar. */
  title: string;
  /** Where "open on the site" should go. */
  siteUrl: string;
  /** Host the favicon belongs to. */
  faviconHost: string;
  /** A section reads as narrower than the publisher's whole output. */
  scope: "site" | "section";
};

const DJ = "https://feeds.content.dowjones.io/public/rss/";

/** WSJ sections, each verified to answer with current items. */
const WSJ_SECTIONS: {
  slug: string;
  title: string;
  path: string;
  /** Path words that mean this section on wsj.com. */
  match: RegExp;
}[] = [
  { slug: "RSSWorldNews", title: "WSJ · World", path: "/world", match: /^(world|world-news)$/ },
  { slug: "RSSUSnews", title: "WSJ · U.S.", path: "/us-news", match: /^(us|u-s|us-news|politics|politics-policy)$/ },
  { slug: "RSSMarketsMain", title: "WSJ · Markets", path: "/finance", match: /^(markets|finance|market-data)$/ },
  { slug: "WSJcomUSBusiness", title: "WSJ · Business", path: "/business", match: /^(business|economy)$/ },
  { slug: "RSSWSJD", title: "WSJ · Tech", path: "/tech", match: /^(tech|technology)$/ },
  { slug: "RSSOpinion", title: "WSJ · Opinion", path: "/opinion", match: /^(opinion|editorials)$/ },
  { slug: "RSSPersonalFinance", title: "WSJ · Personal Finance", path: "/personal-finance", match: /^personal-finance$/ },
  { slug: "RSSLifestyle", title: "WSJ · Lifestyle", path: "/lifestyle", match: /^(lifestyle|style|arts-culture|life-work)$/ },
];

/** Sections offered in the picker when someone adds WSJ by name. */
export const WSJ_CHOICES = WSJ_SECTIONS.map(({ slug, title, path }) => ({
  slug,
  title,
  url: `https://www.wsj.com${path}`,
}));

function wsjFeed(section: (typeof WSJ_SECTIONS)[number], scope: "site" | "section"): KnownFeed {
  return {
    feedUrl: `${DJ}${section.slug}`,
    title: scope === "site" ? "The Wall Street Journal" : section.title,
    siteUrl: `https://www.wsj.com${scope === "site" ? "" : section.path}`,
    faviconHost: "wsj.com",
    scope,
  };
}

const WSJ_NAMES = /^(wsj|wsj\.com|the wsj|wall ?st(reet)? ?journal|the wall street journal)$/i;

/**
 * Resolve a raw "add source" input to a publisher feed we know by hand, or
 * null to let normal discovery run.
 */
export function knownFeedFor(input: string): KnownFeed | null {
  const raw = input.trim();
  if (!raw) return null;

  if (WSJ_NAMES.test(raw)) return wsjFeed(WSJ_SECTIONS[0], "site");

  let url: URL;
  try {
    url = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`);
  } catch {
    return null;
  }
  const host = url.hostname.replace(/^www\./, "").toLowerCase();

  // The abandoned RSS host, and the current one pasted directly: both name a
  // slug we can title properly.
  if (host === "feeds.a.dj.com" || host === "feeds.content.dowjones.io") {
    const slug = url.pathname.split("/").pop()?.replace(/\.xml$/i, "") ?? "";
    const known = WSJ_SECTIONS.find((s) => s.slug.toLowerCase() === slug.toLowerCase());
    if (known) return wsjFeed(known, "section");
    return null;
  }

  if (host !== "wsj.com" && host !== "online.wsj.com") return null;

  const segments = url.pathname.split("/").filter(Boolean);
  // wsj.com/news/markets and wsj.com/markets both name the same section.
  const word = (segments[0] === "news" ? segments[1] : segments[0])?.toLowerCase();
  if (!word) return wsjFeed(WSJ_SECTIONS[0], "site");

  const section = WSJ_SECTIONS.find((s) => s.match.test(word));
  // A single WSJ story, or a section we have no feed for: the whole paper is
  // closer to useful than an error.
  return wsjFeed(section ?? WSJ_SECTIONS[0], section ? "section" : "site");
}
