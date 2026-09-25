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
import { faviconFor } from "./url";

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
  /**
   * What to say about the source, where the feed's own description would say
   * something misleading — an aggregator names itself, not the publisher.
   */
  note?: string;
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

/**
 * The Associated Press, which cannot be read from a server at all.
 *
 * Measured from the deployment on 2026-09-14: every path on apnews.com
 * answers 403 — the front page, robots.txt, and all six sitemaps robots.txt
 * itself declares (ap-sitemap, news-sitemap-content, hubs, video, author,
 * elections). There is no user agent to fix: the block is on the request, not
 * the client, and AP's own machine-readable route is its paid API. The old
 * app backend (afs-prod.appspot.com) answers, but its feed endpoints are
 * gone, and feeds.apnews.com no longer resolves.
 *
 * So AP arrives through Google News, scoped to apnews.com. Measured the same
 * day: 100 items, the newest 47 minutes old, spanning 46 hours. What this
 * costs is the link — Google wraps each story in a token only a browser can
 * follow — so AP is a headline source in the app, with the story one tap
 * away on apnews.com. Bing was the alternative and is worse on the only axis
 * that matters here: 12 items, the newest 8 hours old.
 *
 * The window is deliberate. `when:1d` packs 100 items into a single day and
 * `when:7d` spreads the same 100 across a week (14 a day, measured); two days
 * is the pair of them at their best — about fifty a day, and two days of
 * cover for a reader who has been away. Nothing is lost between refreshes
 * either way: the reader merges each refresh into what it already holds
 * (lib/window.ts).
 */
const AP_FEED =
  "https://news.google.com/rss/search?q=site%3Aapnews.com+when%3A2d&hl=en-US&gl=US&ceid=US:en";

function apNews(): KnownFeed {
  return {
    feedUrl: AP_FEED,
    title: "AP News",
    siteUrl: "https://apnews.com",
    faviconHost: "apnews.com",
    note: "The AP wire, gathered through Google News: apnews.com refuses every server request, so the headlines are here and each story opens on AP's site.",
    /**
     * Not because AP is a section of something. Scope decides whether the
     * refresh also collects from the publisher's sitemap, and the host behind
     * this feed is Google's — pointing sitemap collection at it would gather
     * nothing and ask Google for it repeatedly.
     */
    scope: "section",
  };
}

const AP_NAMES =
  /^(ap|the ap|ap ?news|apnews\.com|associated press|the associated press)$/i;

/**
 * Pirate Wires, whose own site cannot be read by a server at all.
 *
 * Measured 25 Sep 2026 from the deployment. piratewires.com runs Vercel's
 * attack-challenge mode, so **every** path — `/c/technology`, an article,
 * even `robots.txt` — answers `429` with a 31KB HTML page titled "Vercel
 * Security Checkpoint". It is a JavaScript challenge, not a rate limit: no
 * `retry-after`, and it came back identically as Googlebot and as a browser
 * user agent. There is nothing on that host to discover.
 *
 * Their Substack mirror is a different matter, and is the publisher's own
 * route: `piratewires.substack.com/feed` answers 200 through Cloudflare with
 * 20 items, **the full text of each in `content:encoded`** (11k–26k
 * characters an article, not a summary), newest the same morning, spanning
 * about four days of a daily publication. Because the text is in the feed,
 * the reader never has to reach piratewires.com to show an article — which
 * matters, because it could not.
 *
 * **It is the whole publication, and it is named as one.** There is no
 * technology-only route: `/feed/s/technology` is a 404, no item carries a
 * `<category>`, and Substack's own 404 page declares exactly one feed for
 * this publisher. Calling this "Pirate Wires · Technology" because a section
 * URL was pasted would be the WSJ bug in §4.1 — a site-wide feed wearing a
 * section's name. So a section URL resolves here too, under the publication's
 * own name, and says so.
 */
const PIRATE_WIRES_FEED = "https://piratewires.substack.com/feed";

function pirateWires(): KnownFeed {
  return {
    feedUrl: PIRATE_WIRES_FEED,
    title: "Pirate Wires",
    siteUrl: "https://www.piratewires.com",
    faviconHost: "piratewires.com",
    note:
      "The whole of Pirate Wires, full text, from their Substack feed — piratewires.com itself " +
      "answers every server request with a security checkpoint. They publish one feed, so this " +
      "covers technology along with everything else rather than that section on its own.",
    /**
     * Site, not section, and deliberately: this really is everything the
     * publication files, and scope is what decides whether the refresh may
     * also collect site-wide. Recording it as a section to reflect the URL
     * someone pasted would misdescribe what the source actually holds.
     */
    scope: "site",
  };
}

const PIRATE_WIRES_NAMES = /^(pirate ?wires|piratewires\.com)$/i;

/** Hosts that once served AP or WSJ feeds and now serve nothing usable. */
const RETIRED_HOSTS =
  /^(apnews\.com|feeds\.apnews\.com|hosted2?\.ap\.org|ap\.org|feeds\.a\.dj\.com)$/;

const WSJ_NAMES = /^(wsj|wsj\.com|the wsj|wall ?st(reet)? ?journal|the wall street journal)$/i;

/**
 * Resolve a raw "add source" input to a publisher feed we know by hand, or
 * null to let normal discovery run.
 */
export function knownFeedFor(input: string): KnownFeed | null {
  const raw = input.trim();
  if (!raw) return null;

  if (WSJ_NAMES.test(raw)) return wsjWhole();
  if (AP_NAMES.test(raw)) return apNews();
  if (PIRATE_WIRES_NAMES.test(raw)) return pirateWires();

  let url: URL;
  try {
    url = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`);
  } catch {
    return null;
  }
  const host = url.hostname.replace(/^www\./, "").toLowerCase();

  // Every route into AP — its site, a hub, a story, the hosts that used to
  // serve its feeds — names the one feed of AP that can be read.
  if (/^(apnews\.com|feeds\.apnews\.com|hosted2?\.ap\.org|ap\.org)$/.test(host)) {
    return apNews();
  }

  /*
   * Any route into Pirate Wires — the domain, a section like /c/technology,
   * a single story, or the Substack mirror pasted directly — names the one
   * feed of theirs that can be read. Every path on piratewires.com answers
   * 429; see the note above.
   */
  if (/^(piratewires\.com|piratewires\.substack\.com)$/.test(host)) {
    return pirateWires();
  }

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

/**
 * A source already on the device whose feed has since died.
 *
 * `knownFeedFor` only runs when a source is added, so a source saved back
 * when its feed worked keeps pointing at a URL that now answers 403 or, worse,
 * answers 200 with items frozen months ago. The reader holds what it last
 * collected for fourteen days (lib/window.ts), so the symptom is not an error
 * anywhere — it is a source whose newest story is five days old and getting
 * older, which is exactly how this was reported.
 *
 * Only hosts known to be dead are rewritten, and only to a feed that was
 * measured working. A source that still loads is never touched.
 */
export function repairedFeed(feedUrl: string): KnownFeed | null {
  let url: URL;
  try {
    url = new URL(feedUrl);
  } catch {
    return null;
  }
  const host = url.hostname.replace(/^www\./, "").toLowerCase();

  /**
   * An AP source built from a Bing news search — what "add Associated Press"
   * used to produce, since Bing is the aggregator whose links unwrap
   * (lib/discover.ts). It works, which is why it is not in RETIRED_HOSTS, but
   * measured against the Google route on the same morning it carried 12 items
   * with the newest 8 hours old, against 100 with the newest 47 minutes old.
   * For a wire service that difference is the whole point of following it.
   */
  if (host === "bing.com" && /apnews\.com/i.test(url.searchParams.get("q") ?? "")) {
    return apNews();
  }

  if (!RETIRED_HOSTS.test(host)) return null;
  const known = knownFeedFor(feedUrl);
  return known && known.feedUrl !== feedUrl ? known : null;
}

type Repairable = {
  feedUrl: string;
  title?: string;
  siteUrl?: string;
  favicon?: string;
  scope?: "site" | "section";
};

/**
 * Rewrite the dead sources in a saved list, keeping everything else as it is.
 * Returns the same array when there is nothing to repair, so a load that
 * changes nothing cannot look like an edit.
 */
export function repairSources<T extends Repairable>(sources: T[]): T[] {
  let changed = false;
  const next = sources.map((source) => {
    const known = repairedFeed(source.feedUrl);
    if (!known) return source;
    changed = true;
    return {
      ...source,
      feedUrl: known.feedUrl,
      title: known.title,
      siteUrl: known.siteUrl,
      favicon: faviconFor(known.faviconHost),
      scope: known.scope,
    };
  });
  return changed ? next : sources;
}
