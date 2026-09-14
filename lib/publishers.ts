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

import { bundleOf } from "./bundle";

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

function wsjSection(section: (typeof WSJ_SECTIONS)[number]): KnownFeed {
  return {
    feedUrl: `${DJ}${section.slug}`,
    title: section.title,
    siteUrl: `https://www.wsj.com${section.path}`,
    faviconHost: "wsj.com",
    scope: "section",
  };
}

/**
 * The whole paper: every section at once.
 *
 * There is no WSJ feed of everything it publishes, so asking for the paper
 * used to hand back World News under the paper's name — markets, business,
 * tech, opinion and the rest missing, with nothing to say they were. A
 * bundle reads all eight (lib/bundle.ts), which is what "latest headlines"
 * on wsj.com actually is.
 */
function wsjWhole(): KnownFeed {
  return {
    feedUrl: bundleOf(WSJ_SECTIONS.map((section) => `${DJ}${section.slug}`)),
    title: "The Wall Street Journal",
    siteUrl: "https://www.wsj.com",
    faviconHost: "wsj.com",
    scope: "site",
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

  if (WSJ_NAMES.test(raw)) return wsjWhole();

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
    if (known) return wsjSection(known);
    return null;
  }

  if (host !== "wsj.com" && host !== "online.wsj.com") return null;

  const segments = url.pathname.split("/").filter(Boolean);
  // wsj.com/news/markets and wsj.com/markets both name the same section.
  const word = (segments[0] === "news" ? segments[1] : segments[0])?.toLowerCase();
  if (!word) return wsjWhole();

  const section = WSJ_SECTIONS.find((s) => s.match.test(word));
  // A single WSJ story, or a page that means the paper rather than a section
  // of it — /news/latest-headlines above all, which is where the newsroom
  // puts everything it files. Anything but a section is the whole paper.
  return section ? wsjSection(section) : wsjWhole();
}
