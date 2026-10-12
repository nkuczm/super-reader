/**
 * The outlet directory.
 *
 * Two jobs, which is why it is one list rather than two:
 *
 *  1. It is the menu people pick sources from, instead of having to know and
 *     paste a feed URL.
 *  2. The entries marked `panel` are swept on a schedule into the story
 *     corpus, and that corpus is what "how many outlets covered this" is
 *     measured against. Ranking needs a fixed, broad panel — a story looks
 *     big because many newsrooms independently chose to run it, and that
 *     comparison is meaningless if the set of newsrooms watched changes with
 *     whoever is reading.
 *
 * `tier` is how much one outlet's attention counts toward breadth:
 *   1 — agenda-setting general newsrooms and the wires. Ten of these on one
 *       story is the strongest available signal that it is the day's story.
 *   2 — major outlets with national or global reach.
 *   3 — specialist, trade and local. Ten climate sites covering a climate
 *       story is a beat doing its job, not the country stopping to look.
 *
 * `front: true` marks a front-page or top-stories feed, where the order is
 * an editor's ranking of the day rather than a timeline. Placement in those
 * is the "where did it sit on the site" signal.
 */

import { arxivQuery } from "./arxiv";

export type OutletCategory =
  | "general"
  | "business"
  | "tech"
  | "science"
  | "politics"
  | "world"
  | "law"
  | "climate"
  | "health"
  | "investigative"
  | "local"
  | "culture"
  | "sports"
  | "aggregator"
  // Research, not news: journals, preprint servers and the people who read them.
  | "economics"
  | "psychology"
  | "sociology"
  | "polisci"
  | "anthropology"
  | "history"
  | "philosophy"
  | "linguistics"
  | "education"
  | "legal"
  | "geography"
  | "humanities"
  | "neuroscience"
  | "biology"
  | "ecology"
  | "medicine"
  | "physics"
  | "chemistry"
  | "earth"
  | "mathematics"
  | "computing"
  | "research";

/** The disciplines: journals and preprints, found by their own rung (lib/scholarly.ts), never in the ranking panel. */
export const RESEARCH_CATEGORIES: readonly OutletCategory[] = [
  "economics", "psychology", "sociology", "polisci", "anthropology", "history", "philosophy", "linguistics",
  "education", "legal", "geography", "humanities", "neuroscience", "biology", "ecology", "medicine", "physics",
  "chemistry", "earth", "mathematics", "computing", "research",
];
export const isResearchCategory = (category: OutletCategory) => RESEARCH_CATEGORIES.includes(category);

/**
 * Three newsrooms are missing on purpose: Reuters, USA Today and PBS
 * NewsHour. Each was checked from the deployment — Reuters retired its feeds
 * (404), and USA Today and PBS serve HTML where their feed used to be. A
 * directory entry that can never load is worse than an absence, so they stay
 * out until they publish something fetchable again. `/api/outlets/audit` is
 * how that gets rechecked.
 *
 * The Associated Press was in that list and is now back, through the only
 * route that answers — see the note on AP in lib/publishers.ts. It is the one
 * entry here whose feed is not the publisher's own.
 */
export type Outlet = {
  id: string;
  name: string;
  /** The section this feed covers, when the outlet has more than one here. */
  section?: string;
  feedUrl: string;
  siteUrl: string;
  category: OutletCategory;
  /** Where its newsroom sits, for filtering — "US", "UK", "Global", … */
  region: string;
  tier: 1 | 2 | 3;
  panel?: boolean;
  front?: boolean;
  /**
   * A journal's ISSNs, print and online: how a pasted DOI — whose page the
   * publisher will not show a server — is matched to the journal's feed.
   */
  issn?: string[];
};

/** A journal's newest papers by ISSN, where its own feed does not answer (lib/apis.ts, "journal"). */
// Spelled exactly as buildApiSourceUrl spells them, since sources are matched by that string.
// `via: "crossref"` for a journal OpenAlex dates only by the year (lib/apis.ts).
const journal = (issn: string, name: string, via?: "crossref") =>
  `api:journal?${new URLSearchParams({ issn, name, ...(via ? { via } : {}) })}`;
/** An arXiv category, through arXiv's API: its RSS is empty at weekends. */
const arxiv = (cat: string) => `api:arxiv?${new URLSearchParams({ q: arxivQuery(cat) })}`;
/** bioRxiv's or medRxiv's collection in a subject. */
const rxiv = (server: "biorxiv" | "medrxiv", subject: string) => `api:rxiv?${new URLSearchParams({ server, subject })}`;
/** One of the Open Science Framework's preprint servers. */
const osf = (server: string) => `api:osf?${new URLSearchParams({ server })}`;
/** A publisher's own table-of-contents feed, by the pattern each one uses (all measured 12 Oct 2026). */
const wiley = (eissn: string) => `https://onlinelibrary.wiley.com/feed/${eissn}/most-recent`;
const chicago = (code: string) => `https://www.journals.uchicago.edu/action/showFeed?type=etoc&feed=rss&jc=${code}`;
const sage = (code: string) => `https://journals.sagepub.com/action/showFeed?ui=0&mi=ehikzz&ai=2b4&jc=${code}&type=etoc&feed=rss`;
const tandf = (code: string) => `https://www.tandfonline.com/feed/rss/${code}`;
const natureFeed = (code: string) => `https://www.nature.com/${code}.rss`;
/**
 * Google News for one publisher, where the publisher's own feeds have died or
 * refuse a server (lib/publishers.ts, AP). Two days is the density the AP
 * measurement settled on; headlines and Google's links only.
 */
const googleNews = (site: string, days = 2) =>
  `https://news.google.com/rss/search?q=site%3A${encodeURIComponent(site)}+when%3A${days}d&hl=en-US&gl=US&ceid=US:en`;

/* eslint-disable prettier/prettier */
export const OUTLETS: Outlet[] = [
  // ---- Wires and agenda-setting general news (tier 1, the ranking panel) --
  // Not a front page: this feed is ordered by the clock, so it carries no
  // signal about what AP chose to lead with, and `front` must stay off.
  { id: "ap-wire", name: "AP News", section: "The wire", feedUrl: "https://news.google.com/rss/search?q=site%3Aapnews.com+when%3A2d&hl=en-US&gl=US&ceid=US:en", siteUrl: "https://apnews.com", category: "general", region: "US", tier: 1, panel: true },
  { id: "nyt-home", name: "The New York Times", section: "Front page", feedUrl: "https://rss.nytimes.com/services/xml/rss/nyt/HomePage.xml", siteUrl: "https://www.nytimes.com", category: "general", region: "US", tier: 1, panel: true, front: true },
  { id: "nyt-world", name: "The New York Times", section: "World", feedUrl: "https://rss.nytimes.com/services/xml/rss/nyt/World.xml", siteUrl: "https://www.nytimes.com/section/world", category: "world", region: "US", tier: 1, panel: true },
  { id: "nyt-politics", name: "The New York Times", section: "Politics", feedUrl: "https://rss.nytimes.com/services/xml/rss/nyt/Politics.xml", siteUrl: "https://www.nytimes.com/section/politics", category: "politics", region: "US", tier: 1, panel: true },
  { id: "nyt-business", name: "The New York Times", section: "Business", feedUrl: "https://rss.nytimes.com/services/xml/rss/nyt/Business.xml", siteUrl: "https://www.nytimes.com/section/business", category: "business", region: "US", tier: 1, panel: true },
  { id: "nyt-tech", name: "The New York Times", section: "Technology", feedUrl: "https://rss.nytimes.com/services/xml/rss/nyt/Technology.xml", siteUrl: "https://www.nytimes.com/section/technology", category: "tech", region: "US", tier: 1 },
  { id: "nyt-science", name: "The New York Times", section: "Science", feedUrl: "https://rss.nytimes.com/services/xml/rss/nyt/Science.xml", siteUrl: "https://www.nytimes.com/section/science", category: "science", region: "US", tier: 1 },
  { id: "wapo-national", name: "The Washington Post", section: "National", feedUrl: "https://feeds.washingtonpost.com/rss/national", siteUrl: "https://www.washingtonpost.com", category: "general", region: "US", tier: 1, panel: true, front: true },
  { id: "wapo-world", name: "The Washington Post", section: "World", feedUrl: "https://feeds.washingtonpost.com/rss/world", siteUrl: "https://www.washingtonpost.com/world", category: "world", region: "US", tier: 1, panel: true },
  { id: "wapo-politics", name: "The Washington Post", section: "Politics", feedUrl: "https://feeds.washingtonpost.com/rss/politics", siteUrl: "https://www.washingtonpost.com/politics", category: "politics", region: "US", tier: 1, panel: true },
  { id: "wapo-business", name: "The Washington Post", section: "Business", feedUrl: "https://feeds.washingtonpost.com/rss/business", siteUrl: "https://www.washingtonpost.com/business", category: "business", region: "US", tier: 1, panel: true },
  { id: "wsj-world", name: "The Wall Street Journal", section: "World", feedUrl: "https://feeds.content.dowjones.io/public/rss/RSSWorldNews", siteUrl: "https://www.wsj.com", category: "general", region: "US", tier: 1, panel: true, front: true },
  { id: "wsj-us", name: "The Wall Street Journal", section: "U.S.", feedUrl: "https://feeds.content.dowjones.io/public/rss/RSSUSnews", siteUrl: "https://www.wsj.com/us-news", category: "general", region: "US", tier: 1, panel: true },
  { id: "wsj-markets", name: "The Wall Street Journal", section: "Markets", feedUrl: "https://feeds.content.dowjones.io/public/rss/RSSMarketsMain", siteUrl: "https://www.wsj.com/finance", category: "business", region: "US", tier: 1, panel: true },
  { id: "wsj-business", name: "The Wall Street Journal", section: "Business", feedUrl: "https://feeds.content.dowjones.io/public/rss/WSJcomUSBusiness", siteUrl: "https://www.wsj.com/business", category: "business", region: "US", tier: 1, panel: true },
  { id: "wsj-tech", name: "The Wall Street Journal", section: "Tech", feedUrl: "https://feeds.content.dowjones.io/public/rss/RSSWSJD", siteUrl: "https://www.wsj.com/tech", category: "tech", region: "US", tier: 1 },
  { id: "wsj-opinion", name: "The Wall Street Journal", section: "Opinion", feedUrl: "https://feeds.content.dowjones.io/public/rss/RSSOpinion", siteUrl: "https://www.wsj.com/opinion", category: "politics", region: "US", tier: 1 },
  { id: "bbc-top", name: "BBC News", section: "Top stories", feedUrl: "https://feeds.bbci.co.uk/news/rss.xml", siteUrl: "https://www.bbc.com/news", category: "general", region: "UK", tier: 1, panel: true, front: true },
  { id: "bbc-world", name: "BBC News", section: "World", feedUrl: "https://feeds.bbci.co.uk/news/world/rss.xml", siteUrl: "https://www.bbc.com/news/world", category: "world", region: "UK", tier: 1, panel: true },
  { id: "bbc-business", name: "BBC News", section: "Business", feedUrl: "https://feeds.bbci.co.uk/news/business/rss.xml", siteUrl: "https://www.bbc.com/news/business", category: "business", region: "UK", tier: 1, panel: true },
  { id: "bbc-tech", name: "BBC News", section: "Technology", feedUrl: "https://feeds.bbci.co.uk/news/technology/rss.xml", siteUrl: "https://www.bbc.com/news/technology", category: "tech", region: "UK", tier: 1 },
  { id: "bbc-science", name: "BBC News", section: "Science", feedUrl: "https://feeds.bbci.co.uk/news/science_and_environment/rss.xml", siteUrl: "https://www.bbc.com/news/science_and_environment", category: "science", region: "UK", tier: 1 },
  { id: "guardian-front", name: "The Guardian", section: "Front page", feedUrl: "https://www.theguardian.com/uk/rss", siteUrl: "https://www.theguardian.com", category: "general", region: "UK", tier: 1, panel: true, front: true },
  { id: "guardian-world", name: "The Guardian", section: "World", feedUrl: "https://www.theguardian.com/world/rss", siteUrl: "https://www.theguardian.com/world", category: "world", region: "UK", tier: 1, panel: true },
  { id: "guardian-us", name: "The Guardian", section: "US news", feedUrl: "https://www.theguardian.com/us-news/rss", siteUrl: "https://www.theguardian.com/us-news", category: "general", region: "UK", tier: 1, panel: true },
  { id: "guardian-business", name: "The Guardian", section: "Business", feedUrl: "https://www.theguardian.com/uk/business/rss", siteUrl: "https://www.theguardian.com/business", category: "business", region: "UK", tier: 1 },
  { id: "guardian-tech", name: "The Guardian", section: "Technology", feedUrl: "https://www.theguardian.com/uk/technology/rss", siteUrl: "https://www.theguardian.com/technology", category: "tech", region: "UK", tier: 1 },
  { id: "npr-news", name: "NPR", section: "News", feedUrl: "https://feeds.npr.org/1001/rss.xml", siteUrl: "https://www.npr.org", category: "general", region: "US", tier: 1, panel: true, front: true },
  { id: "npr-world", name: "NPR", section: "World", feedUrl: "https://feeds.npr.org/1004/rss.xml", siteUrl: "https://www.npr.org/sections/world", category: "world", region: "US", tier: 1, panel: true },
  { id: "npr-business", name: "NPR", section: "Business", feedUrl: "https://feeds.npr.org/1006/rss.xml", siteUrl: "https://www.npr.org/sections/business", category: "business", region: "US", tier: 1 },
  { id: "npr-politics", name: "NPR", section: "Politics", feedUrl: "https://feeds.npr.org/1014/rss.xml", siteUrl: "https://www.npr.org/sections/politics", category: "politics", region: "US", tier: 1, panel: true },
  { id: "aljazeera", name: "Al Jazeera", section: "All news", feedUrl: "https://www.aljazeera.com/xml/rss/all.xml", siteUrl: "https://www.aljazeera.com", category: "world", region: "Global", tier: 1, panel: true, front: true },
  { id: "ft-home", name: "Financial Times", section: "Home", feedUrl: "https://www.ft.com/rss/home", siteUrl: "https://www.ft.com", category: "business", region: "UK", tier: 1, panel: true, front: true },
  { id: "economist", name: "The Economist", section: "Latest", feedUrl: "https://www.economist.com/latest/rss.xml", siteUrl: "https://www.economist.com", category: "general", region: "UK", tier: 1, panel: true },
  { id: "cnn-top", name: "CNN", section: "Top stories", feedUrl: googleNews("cnn.com"), siteUrl: "https://www.cnn.com", category: "general", region: "US", tier: 1, panel: true, front: true },
  { id: "nbc-news", name: "NBC News", section: "Top stories", feedUrl: "https://feeds.nbcnews.com/nbcnews/public/news", siteUrl: "https://www.nbcnews.com", category: "general", region: "US", tier: 1, panel: true, front: true },
  { id: "cbs-news", name: "CBS News", section: "Top stories", feedUrl: "https://www.cbsnews.com/latest/rss/main", siteUrl: "https://www.cbsnews.com", category: "general", region: "US", tier: 1, panel: true, front: true },
  { id: "abc-news", name: "ABC News", section: "Top stories", feedUrl: "https://abcnews.go.com/abcnews/topstories", siteUrl: "https://abcnews.go.com", category: "general", region: "US", tier: 1, panel: true, front: true },
  { id: "fox-news", name: "Fox News", section: "Latest", feedUrl: "https://moxie.foxnews.com/google-publisher/latest.xml", siteUrl: "https://www.foxnews.com", category: "general", region: "US", tier: 1, panel: true, front: true },
  { id: "latimes", name: "Los Angeles Times", section: "Top stories", feedUrl: "https://www.latimes.com/rss2.0.xml", siteUrl: "https://www.latimes.com", category: "general", region: "US", tier: 1, panel: true, front: true },
  { id: "politico", name: "Politico", section: "Politics", feedUrl: "https://rss.politico.com/politics-news.xml", siteUrl: "https://www.politico.com", category: "politics", region: "US", tier: 1, panel: true },
  { id: "thehill", name: "The Hill", section: "News", feedUrl: "https://thehill.com/news/feed/", siteUrl: "https://thehill.com", category: "politics", region: "US", tier: 2, panel: true },
  { id: "axios", name: "Axios", section: "All", feedUrl: "https://api.axios.com/feed/", siteUrl: "https://www.axios.com", category: "general", region: "US", tier: 2, panel: true, front: true },
  { id: "semafor", name: "Semafor", section: "All", feedUrl: "https://www.semafor.com/rss.xml", siteUrl: "https://www.semafor.com", category: "general", region: "US", tier: 2 },
  { id: "newsweek", name: "Newsweek", section: "Latest", feedUrl: "https://www.newsweek.com/rss.xml", siteUrl: "https://www.newsweek.com", category: "general", region: "US", tier: 2, panel: true },
  { id: "time", name: "TIME", section: "Latest", feedUrl: "https://time.com/feed/", siteUrl: "https://time.com", category: "general", region: "US", tier: 2, panel: true },

  // ---- World and regional --------------------------------------------------
  { id: "dw", name: "Deutsche Welle", section: "All", feedUrl: "https://rss.dw.com/rdf/rss-en-all", siteUrl: "https://www.dw.com/en", category: "world", region: "Europe", tier: 2, panel: true },
  { id: "france24", name: "France 24", section: "All", feedUrl: "https://www.france24.com/en/rss", siteUrl: "https://www.france24.com/en", category: "world", region: "Europe", tier: 2, panel: true },
  { id: "euronews", name: "Euronews", section: "All", feedUrl: "https://www.euronews.com/rss", siteUrl: "https://www.euronews.com", category: "world", region: "Europe", tier: 2 },
  { id: "skynews", name: "Sky News", section: "Home", feedUrl: "https://feeds.skynews.com/feeds/rss/home.xml", siteUrl: "https://news.sky.com", category: "general", region: "UK", tier: 2, panel: true, front: true },
  { id: "independent", name: "The Independent", section: "UK news", feedUrl: "https://www.independent.co.uk/news/uk/rss", siteUrl: "https://www.independent.co.uk", category: "general", region: "UK", tier: 2 },
  { id: "telegraph", name: "The Telegraph", section: "All", feedUrl: googleNews("telegraph.co.uk"), siteUrl: "https://www.telegraph.co.uk", category: "general", region: "UK", tier: 2 },
  { id: "cbc", name: "CBC News", section: "Top stories", feedUrl: "https://www.cbc.ca/webfeed/rss/rss-topstories", siteUrl: "https://www.cbc.ca/news", category: "general", region: "Canada", tier: 2, panel: true, front: true },
  { id: "globeandmail", name: "The Globe and Mail", section: "Canada", feedUrl: "https://www.theglobeandmail.com/arc/outboundfeeds/rss/category/canada/", siteUrl: "https://www.theglobeandmail.com", category: "general", region: "Canada", tier: 2 },
  { id: "abc-au", name: "ABC (Australia)", section: "Top stories", feedUrl: "https://www.abc.net.au/news/feed/51120/rss.xml", siteUrl: "https://www.abc.net.au/news", category: "general", region: "Australia", tier: 2, panel: true, front: true },
  { id: "smh", name: "Sydney Morning Herald", section: "All", feedUrl: "https://www.smh.com.au/rss/feed.xml", siteUrl: "https://www.smh.com.au", category: "general", region: "Australia", tier: 2 },
  { id: "scmp", name: "South China Morning Post", section: "All", feedUrl: "https://www.scmp.com/rss/91/feed", siteUrl: "https://www.scmp.com", category: "world", region: "Asia", tier: 2, panel: true },
  { id: "japantimes", name: "The Japan Times", section: "All", feedUrl: "https://www.japantimes.co.jp/feed/", siteUrl: "https://www.japantimes.co.jp", category: "world", region: "Asia", tier: 2 },
  { id: "toi", name: "Times of India", section: "Top stories", feedUrl: "https://timesofindia.indiatimes.com/rssfeedstopstories.cms", siteUrl: "https://timesofindia.indiatimes.com", category: "general", region: "Asia", tier: 2, panel: true, front: true },
  { id: "thehindu", name: "The Hindu", section: "National", feedUrl: "https://www.thehindu.com/news/national/feeder/default.rss", siteUrl: "https://www.thehindu.com", category: "general", region: "Asia", tier: 2 },
  { id: "straitstimes", name: "The Straits Times", section: "World", feedUrl: "https://www.straitstimes.com/news/world/rss.xml", siteUrl: "https://www.straitstimes.com", category: "world", region: "Asia", tier: 3 },
  { id: "timesofisrael", name: "The Times of Israel", section: "All", feedUrl: googleNews("timesofisrael.com"), siteUrl: "https://www.timesofisrael.com", category: "world", region: "Middle East", tier: 2 },
  { id: "jpost", name: "The Jerusalem Post", section: "Front page", feedUrl: "https://www.jpost.com/rss/rssfeedsfrontpage.aspx", siteUrl: "https://www.jpost.com", category: "world", region: "Middle East", tier: 3 },
  { id: "kyivindependent", name: "The Kyiv Independent", section: "All", feedUrl: googleNews("kyivindependent.com"), siteUrl: "https://kyivindependent.com", category: "world", region: "Europe", tier: 3 },
  { id: "moscowtimes", name: "The Moscow Times", section: "News", feedUrl: "https://www.themoscowtimes.com/rss/news", siteUrl: "https://www.themoscowtimes.com", category: "world", region: "Europe", tier: 3 },
  { id: "allafrica", name: "AllAfrica", section: "Latest", feedUrl: "https://allafrica.com/tools/headlines/rdf/latest/headlines.rdf", siteUrl: "https://allafrica.com", category: "world", region: "Africa", tier: 3 },
  { id: "batimes", name: "Buenos Aires Times", section: "All", feedUrl: "https://www.batimes.com.ar/feed", siteUrl: "https://www.batimes.com.ar", category: "world", region: "Americas", tier: 3 },

  // ---- Business and markets ------------------------------------------------
  { id: "cnbc-top", name: "CNBC", section: "Top news", feedUrl: "https://search.cnbc.com/rs/search/combinedcms/view.xml?partnerId=wrss01&id=100003114", siteUrl: "https://www.cnbc.com", category: "business", region: "US", tier: 1, panel: true, front: true },
  { id: "marketwatch", name: "MarketWatch", section: "Top stories", feedUrl: "https://feeds.content.dowjones.io/public/rss/mw_topstories", siteUrl: "https://www.marketwatch.com", category: "business", region: "US", tier: 2, panel: true, front: true },
  { id: "barrons", name: "Barron's", section: "All", feedUrl: googleNews("barrons.com"), siteUrl: "https://www.barrons.com", category: "business", region: "US", tier: 2 },
  { id: "bloomberg-markets", name: "Bloomberg", section: "Markets", feedUrl: "https://feeds.bloomberg.com/markets/news.rss", siteUrl: "https://www.bloomberg.com/markets", category: "business", region: "US", tier: 1, panel: true },
  { id: "bloomberg-tech", name: "Bloomberg", section: "Technology", feedUrl: "https://feeds.bloomberg.com/technology/news.rss", siteUrl: "https://www.bloomberg.com/technology", category: "tech", region: "US", tier: 1 },
  { id: "businessinsider", name: "Business Insider", section: "All", feedUrl: "https://www.businessinsider.com/rss", siteUrl: "https://www.businessinsider.com", category: "business", region: "US", tier: 2, panel: true },
  { id: "fortune", name: "Fortune", section: "All", feedUrl: "https://fortune.com/feed/", siteUrl: "https://fortune.com", category: "business", region: "US", tier: 2 },
  { id: "forbes-business", name: "Forbes", section: "Business", feedUrl: "https://www.forbes.com/business/feed/", siteUrl: "https://www.forbes.com/business", category: "business", region: "US", tier: 3 },
  { id: "quartz", name: "Quartz", section: "All", feedUrl: "https://qz.com/rss", siteUrl: "https://qz.com", category: "business", region: "US", tier: 3 },
  { id: "theinformation-free", name: "The Information", section: "Free stories", feedUrl: "https://www.theinformation.com/feed", siteUrl: "https://www.theinformation.com", category: "tech", region: "US", tier: 2 },
  { id: "stratechery", name: "Stratechery", section: "All", feedUrl: "https://stratechery.com/feed/", siteUrl: "https://stratechery.com", category: "tech", region: "US", tier: 3 },

  // ---- Technology ----------------------------------------------------------
  { id: "verge", name: "The Verge", section: "All", feedUrl: "https://www.theverge.com/rss/index.xml", siteUrl: "https://www.theverge.com", category: "tech", region: "US", tier: 2, panel: true, front: true },
  { id: "arstechnica", name: "Ars Technica", section: "All", feedUrl: "https://feeds.arstechnica.com/arstechnica/index", siteUrl: "https://arstechnica.com", category: "tech", region: "US", tier: 2, panel: true },
  { id: "techcrunch", name: "TechCrunch", section: "All", feedUrl: "https://techcrunch.com/feed/", siteUrl: "https://techcrunch.com", category: "tech", region: "US", tier: 2, panel: true },
  { id: "wired", name: "WIRED", section: "All", feedUrl: "https://www.wired.com/feed/rss", siteUrl: "https://www.wired.com", category: "tech", region: "US", tier: 2, panel: true },
  { id: "404media", name: "404 Media", section: "All", feedUrl: "https://www.404media.co/rss/", siteUrl: "https://www.404media.co", category: "tech", region: "US", tier: 3 },
  { id: "theregister", name: "The Register", section: "Headlines", feedUrl: "https://www.theregister.com/headlines.atom", siteUrl: "https://www.theregister.com", category: "tech", region: "UK", tier: 3 },
  { id: "slashdot", name: "Slashdot", section: "Main", feedUrl: "https://rss.slashdot.org/Slashdot/slashdotMain", siteUrl: "https://slashdot.org", category: "tech", region: "US", tier: 3 },
  { id: "hn-frontpage", name: "Hacker News", section: "Front page", feedUrl: "https://hnrss.org/frontpage", siteUrl: "https://news.ycombinator.com", category: "aggregator", region: "Global", tier: 3, panel: true, front: true },
  { id: "lobsters", name: "Lobsters", section: "Front page", feedUrl: "https://lobste.rs/rss", siteUrl: "https://lobste.rs", category: "aggregator", region: "Global", tier: 3, front: true },
  { id: "techmeme", name: "Techmeme", section: "Front page", feedUrl: "https://www.techmeme.com/feed.xml", siteUrl: "https://www.techmeme.com", category: "aggregator", region: "US", tier: 3, panel: true, front: true },
  { id: "mittr", name: "MIT Technology Review", section: "All", feedUrl: "https://www.technologyreview.com/feed/", siteUrl: "https://www.technologyreview.com", category: "tech", region: "US", tier: 3 },
  { id: "tomshardware", name: "Tom's Hardware", section: "All", feedUrl: "https://www.tomshardware.com/feeds/all", siteUrl: "https://www.tomshardware.com", category: "tech", region: "US", tier: 3 },
  { id: "simonwillison", name: "Simon Willison", section: "Everything", feedUrl: "https://simonwillison.net/atom/everything/", siteUrl: "https://simonwillison.net", category: "tech", region: "US", tier: 3 },
  { id: "openai-blog", name: "OpenAI", section: "Blog", feedUrl: "https://openai.com/news/rss.xml", siteUrl: "https://openai.com/news", category: "tech", region: "US", tier: 3 },
  { id: "googleblog-ai", name: "Google", section: "The Keyword", feedUrl: "https://blog.google/rss/", siteUrl: "https://blog.google", category: "tech", region: "US", tier: 3 },
  { id: "krebs", name: "Krebs on Security", section: "All", feedUrl: "https://krebsonsecurity.com/feed/", siteUrl: "https://krebsonsecurity.com", category: "tech", region: "US", tier: 3 },
  { id: "bleepingcomputer", name: "BleepingComputer", section: "All", feedUrl: googleNews("bleepingcomputer.com"), siteUrl: "https://www.bleepingcomputer.com", category: "tech", region: "US", tier: 3 },

  // ---- Science and health --------------------------------------------------
  { id: "nature-news", name: "Nature", section: "News", feedUrl: "https://www.nature.com/nature.rss", siteUrl: "https://www.nature.com", category: "science", region: "Global", tier: 2, panel: true, issn: ["0028-0836", "1476-4687"] },
  { id: "science-news", name: "Science", section: "News", feedUrl: "https://www.science.org/rss/news_current.xml", siteUrl: "https://www.science.org/news", category: "science", region: "Global", tier: 2, panel: true },
  { id: "quanta", name: "Quanta Magazine", section: "All", feedUrl: "https://www.quantamagazine.org/feed/", siteUrl: "https://www.quantamagazine.org", category: "science", region: "US", tier: 3 },
  { id: "newscientist", name: "New Scientist", section: "Home", feedUrl: "https://www.newscientist.com/feed/home/", siteUrl: "https://www.newscientist.com", category: "science", region: "UK", tier: 3 },
  { id: "sciam", name: "Scientific American", section: "All", feedUrl: "https://www.scientificamerican.com/platform/syndication/rss/", siteUrl: "https://www.scientificamerican.com", category: "science", region: "US", tier: 3 },
  { id: "physorg", name: "Phys.org", section: "All", feedUrl: "https://phys.org/rss-feed/", siteUrl: "https://phys.org", category: "science", region: "Global", tier: 3 },
  { id: "sciencenews", name: "Science News", section: "All", feedUrl: "https://www.sciencenews.org/feed", siteUrl: "https://www.sciencenews.org", category: "science", region: "US", tier: 3 },
  { id: "nasa", name: "NASA", section: "Breaking news", feedUrl: "https://www.nasa.gov/rss/dyn/breaking_news.rss", siteUrl: "https://www.nasa.gov", category: "science", region: "US", tier: 3 },
  { id: "spacenews", name: "SpaceNews", section: "All", feedUrl: "https://spacenews.com/feed/", siteUrl: "https://spacenews.com", category: "science", region: "US", tier: 3 },
  { id: "statnews", name: "STAT", section: "All", feedUrl: "https://www.statnews.com/feed/", siteUrl: "https://www.statnews.com", category: "health", region: "US", tier: 3, panel: true },
  { id: "kffhealth", name: "KFF Health News", section: "All", feedUrl: "https://kffhealthnews.org/feed/", siteUrl: "https://kffhealthnews.org", category: "health", region: "US", tier: 3 },
  { id: "cdc-newsroom", name: "CDC", section: "Newsroom", feedUrl: "https://tools.cdc.gov/podcasts/feed.asp?feedid=183", siteUrl: "https://www.cdc.gov/media", category: "health", region: "US", tier: 3 },

  // ---- Law, policy and courts ---------------------------------------------
  { id: "scotusblog", name: "SCOTUSblog", section: "All", feedUrl: "https://www.scotusblog.com/feed/", siteUrl: "https://www.scotusblog.com", category: "law", region: "US", tier: 3, panel: true },
  { id: "lawfare", name: "Lawfare", section: "All", feedUrl: googleNews("lawfaremedia.org", 7), siteUrl: "https://www.lawfaremedia.org", category: "law", region: "US", tier: 3 },
  { id: "courthousenews", name: "Courthouse News", section: "All", feedUrl: "https://www.courthousenews.com/feed/", siteUrl: "https://www.courthousenews.com", category: "law", region: "US", tier: 3 },
  { id: "abajournal", name: "ABA Journal", section: "All", feedUrl: "https://www.abajournal.com/rss/feed", siteUrl: "https://www.abajournal.com", category: "law", region: "US", tier: 3 },
  { id: "justice-gov", name: "U.S. Justice Department", section: "Press releases", feedUrl: "https://www.justice.gov/news/rss", siteUrl: "https://www.justice.gov/news", category: "law", region: "US", tier: 3 },
  { id: "federalregister", name: "Federal Register", section: "Documents", feedUrl: "https://www.federalregister.gov/api/v1/articles.rss", siteUrl: "https://www.federalregister.gov", category: "law", region: "US", tier: 3 },

  // ---- Investigative and nonprofit ----------------------------------------
  { id: "propublica", name: "ProPublica", section: "All", feedUrl: "https://www.propublica.org/feeds/propublica/main", siteUrl: "https://www.propublica.org", category: "investigative", region: "US", tier: 2, panel: true },
  { id: "marshallproject", name: "The Marshall Project", section: "All", feedUrl: "https://www.themarshallproject.org/rss/recent.rss", siteUrl: "https://www.themarshallproject.org", category: "investigative", region: "US", tier: 3 },
  { id: "bellingcat", name: "Bellingcat", section: "All", feedUrl: "https://www.bellingcat.com/feed/", siteUrl: "https://www.bellingcat.com", category: "investigative", region: "Global", tier: 3 },
  { id: "icij", name: "ICIJ", section: "All", feedUrl: "https://www.icij.org/feed/", siteUrl: "https://www.icij.org", category: "investigative", region: "Global", tier: 3 },
  { id: "intercept", name: "The Intercept", section: "All", feedUrl: "https://theintercept.com/feed/?rss", siteUrl: "https://theintercept.com", category: "investigative", region: "US", tier: 3 },
  { id: "texastribune", name: "The Texas Tribune", section: "All", feedUrl: "https://www.texastribune.org/feeds/main/", siteUrl: "https://www.texastribune.org", category: "local", region: "US", tier: 3 },
  { id: "calmatters", name: "CalMatters", section: "All", feedUrl: "https://calmatters.org/feed/", siteUrl: "https://calmatters.org", category: "local", region: "US", tier: 3 },

  // ---- Climate and energy --------------------------------------------------
  { id: "insideclimate", name: "Inside Climate News", section: "All", feedUrl: "https://insideclimatenews.org/feed/", siteUrl: "https://insideclimatenews.org", category: "climate", region: "US", tier: 3, panel: true },
  { id: "canarymedia", name: "Canary Media", section: "All", feedUrl: "https://www.canarymedia.com/rss", siteUrl: "https://www.canarymedia.com", category: "climate", region: "US", tier: 3 },
  { id: "heatmap", name: "Heatmap News", section: "All", feedUrl: "https://heatmap.news/feeds/feed.rss", siteUrl: "https://heatmap.news", category: "climate", region: "US", tier: 3 },
  { id: "grist", name: "Grist", section: "All", feedUrl: "https://grist.org/feed/", siteUrl: "https://grist.org", category: "climate", region: "US", tier: 3 },
  { id: "carbonbrief", name: "Carbon Brief", section: "All", feedUrl: "https://www.carbonbrief.org/feed/", siteUrl: "https://www.carbonbrief.org", category: "climate", region: "UK", tier: 3 },

  // ---- Defense and foreign policy -----------------------------------------
  { id: "defenseone", name: "Defense One", section: "All", feedUrl: "https://www.defenseone.com/rss/all/", siteUrl: "https://www.defenseone.com", category: "world", region: "US", tier: 3, panel: true },
  { id: "warontherocks", name: "War on the Rocks", section: "All", feedUrl: "https://warontherocks.com/feed/", siteUrl: "https://warontherocks.com", category: "world", region: "US", tier: 3 },
  { id: "foreignpolicy", name: "Foreign Policy", section: "All", feedUrl: "https://foreignpolicy.com/feed/", siteUrl: "https://foreignpolicy.com", category: "world", region: "US", tier: 3 },
  { id: "breakingdefense", name: "Breaking Defense", section: "All", feedUrl: "https://breakingdefense.com/feed/", siteUrl: "https://breakingdefense.com", category: "world", region: "US", tier: 3 },

  // ---- Magazines and commentary -------------------------------------------
  { id: "atlantic", name: "The Atlantic", section: "All", feedUrl: "https://www.theatlantic.com/feed/all/", siteUrl: "https://www.theatlantic.com", category: "general", region: "US", tier: 2, panel: true },
  { id: "newyorker", name: "The New Yorker", section: "News", feedUrl: "https://www.newyorker.com/feed/news", siteUrl: "https://www.newyorker.com", category: "general", region: "US", tier: 2 },
  { id: "vox", name: "Vox", section: "All", feedUrl: "https://www.vox.com/rss/index.xml", siteUrl: "https://www.vox.com", category: "general", region: "US", tier: 3, panel: true },
  { id: "slate", name: "Slate", section: "All", feedUrl: "https://slate.com/feeds/all.rss", siteUrl: "https://slate.com", category: "general", region: "US", tier: 3 },
  { id: "reason", name: "Reason", section: "Latest", feedUrl: "https://reason.com/latest/feed/", siteUrl: "https://reason.com", category: "politics", region: "US", tier: 3 },
  { id: "nationalreview", name: "National Review", section: "All", feedUrl: "https://www.nationalreview.com/feed/", siteUrl: "https://www.nationalreview.com", category: "politics", region: "US", tier: 3 },
  { id: "motherjones", name: "Mother Jones", section: "All", feedUrl: "https://www.motherjones.com/feed/", siteUrl: "https://www.motherjones.com", category: "politics", region: "US", tier: 3 },
  { id: "thedispatch", name: "The Dispatch", section: "All", feedUrl: "https://thedispatch.com/feed/", siteUrl: "https://thedispatch.com", category: "politics", region: "US", tier: 3 },

  // ---- Culture and sport ---------------------------------------------------
  { id: "variety", name: "Variety", section: "All", feedUrl: "https://variety.com/feed/", siteUrl: "https://variety.com", category: "culture", region: "US", tier: 3 },
  { id: "hollywoodreporter", name: "The Hollywood Reporter", section: "All", feedUrl: "https://www.hollywoodreporter.com/feed/", siteUrl: "https://www.hollywoodreporter.com", category: "culture", region: "US", tier: 3 },
  { id: "deadline", name: "Deadline", section: "All", feedUrl: "https://deadline.com/feed/", siteUrl: "https://deadline.com", category: "culture", region: "US", tier: 3 },
  { id: "pitchfork", name: "Pitchfork", section: "All", feedUrl: "https://pitchfork.com/feed/feed-news/rss", siteUrl: "https://pitchfork.com", category: "culture", region: "US", tier: 3 },
  { id: "rollingstone", name: "Rolling Stone", section: "All", feedUrl: "https://www.rollingstone.com/feed/", siteUrl: "https://www.rollingstone.com", category: "culture", region: "US", tier: 3 },
  { id: "espn", name: "ESPN", section: "Top news", feedUrl: googleNews("espn.com"), siteUrl: "https://www.espn.com", category: "sports", region: "US", tier: 2, front: true },
  { id: "bbc-sport", name: "BBC Sport", section: "All", feedUrl: "https://feeds.bbci.co.uk/sport/rss.xml", siteUrl: "https://www.bbc.com/sport", category: "sports", region: "UK", tier: 2 },
  { id: "skysports", name: "Sky Sports", section: "All", feedUrl: "https://www.skysports.com/rss/12040", siteUrl: "https://www.skysports.com", category: "sports", region: "UK", tier: 3 },

  // ---- Major US metros -----------------------------------------------------
  { id: "sfchronicle", name: "San Francisco Chronicle", section: "All", feedUrl: googleNews("sfchronicle.com"), siteUrl: "https://www.sfchronicle.com", category: "local", region: "US", tier: 3 },
  { id: "chicagotribune", name: "Chicago Tribune", section: "All", feedUrl: googleNews("chicagotribune.com"), siteUrl: "https://www.chicagotribune.com", category: "local", region: "US", tier: 3 },
  { id: "bostonglobe", name: "The Boston Globe", section: "All", feedUrl: "https://www.bostonglobe.com/arc/outboundfeeds/rss/?outputType=xml", siteUrl: "https://www.bostonglobe.com", category: "local", region: "US", tier: 3 },
  { id: "seattletimes", name: "The Seattle Times", section: "All", feedUrl: "https://www.seattletimes.com/feed/", siteUrl: "https://www.seattletimes.com", category: "local", region: "US", tier: 3 },
  { id: "miamiherald", name: "Miami Herald", section: "All", feedUrl: googleNews("miamiherald.com"), siteUrl: "https://www.miamiherald.com", category: "local", region: "US", tier: 3 },
  { id: "dallasnews", name: "The Dallas Morning News", section: "All", feedUrl: googleNews("dallasnews.com"), siteUrl: "https://www.dallasnews.com", category: "local", region: "US", tier: 3 },
  { id: "denverpost", name: "The Denver Post", section: "All", feedUrl: googleNews("denverpost.com"), siteUrl: "https://www.denverpost.com", category: "local", region: "US", tier: 3 },
  { id: "startribune", name: "Star Tribune", section: "All", feedUrl: "https://www.startribune.com/local/index.rss2", siteUrl: "https://www.startribune.com", category: "local", region: "US", tier: 3 },
  { id: "ajc", name: "The Atlanta Journal-Constitution", section: "All", feedUrl: googleNews("ajc.com"), siteUrl: "https://www.ajc.com", category: "local", region: "US", tier: 3 },
  { id: "inquirer", name: "The Philadelphia Inquirer", section: "All", feedUrl: "https://www.inquirer.com/arc/outboundfeeds/rss/?outputType=xml", siteUrl: "https://www.inquirer.com", category: "local", region: "US", tier: 3 },
  { id: "oregonian", name: "The Oregonian", section: "All", feedUrl: "https://www.oregonlive.com/arc/outboundfeeds/rss/", siteUrl: "https://www.oregonlive.com", category: "local", region: "US", tier: 3 },
  { id: "azcentral", name: "The Arizona Republic", section: "All", feedUrl: googleNews("azcentral.com"), siteUrl: "https://www.azcentral.com", category: "local", region: "US", tier: 3 },
  { id: "nevadaindependent", name: "The Nevada Independent", section: "All", feedUrl: "https://thenevadaindependent.com/feed", siteUrl: "https://thenevadaindependent.com", category: "local", region: "US", tier: 3 },

  // ---- Research: journals, preprints and the people who read them --------
  // Every feed here was read from the deployment on 11 Oct 2026, each with
  // that week's papers (docs/COLLECTION.md §2). Where a journal's own feed
  // refused (jneurosci.org, Oxford, Springer's bot check) or was undated
  // (ScienceDirect), its newest papers come by ISSN instead. None of these
  // is in the ranking panel: a paper is not a news story.
  { id: "nature-neuro", name: "Nature Neuroscience", feedUrl: "https://www.nature.com/neuro.rss", siteUrl: "https://www.nature.com/neuro", category: "neuroscience", region: "Global", tier: 3, issn: ["1097-6256", "1546-1726"] },
  { id: "nature-nrn", name: "Nature Reviews Neuroscience", feedUrl: "https://www.nature.com/nrn.rss", siteUrl: "https://www.nature.com/nrn", category: "neuroscience", region: "Global", tier: 3, issn: ["1471-003X", "1471-0048"] },
  { id: "nature-subject-neuro", name: "Nature journals", section: "Neuroscience", feedUrl: "https://www.nature.com/subjects/neuroscience.rss", siteUrl: "https://www.nature.com/subjects/neuroscience", category: "neuroscience", region: "Global", tier: 3 },
  { id: "ncomms-neuro", name: "Nature Communications", section: "Neuroscience", feedUrl: "https://www.nature.com/subjects/neuroscience/ncomms.rss", siteUrl: "https://www.nature.com/subjects/neuroscience/ncomms", category: "neuroscience", region: "Global", tier: 3 },
  { id: "nathumbehav", name: "Nature Human Behaviour", feedUrl: "https://www.nature.com/nathumbehav.rss", siteUrl: "https://www.nature.com/nathumbehav", category: "neuroscience", region: "Global", tier: 3, issn: ["2397-3374"] },
  { id: "neuron", name: "Neuron", feedUrl: "https://www.cell.com/neuron/inpress.rss", siteUrl: "https://www.cell.com/neuron", category: "neuroscience", region: "US", tier: 3, issn: ["0896-6273", "1097-4199"] },
  { id: "tins", name: "Trends in Neurosciences", feedUrl: "https://www.cell.com/trends/neurosciences/inpress.rss", siteUrl: "https://www.cell.com/trends/neurosciences", category: "neuroscience", region: "US", tier: 3, issn: ["0166-2236", "1878-108X"] },
  { id: "tics", name: "Trends in Cognitive Sciences", feedUrl: "https://www.cell.com/trends/cognitive-sciences/inpress.rss", siteUrl: "https://www.cell.com/trends/cognitive-sciences", category: "neuroscience", region: "US", tier: 3, issn: ["1364-6613", "1879-307X"] },
  { id: "jneurosci", name: "The Journal of Neuroscience", feedUrl: journal("0270-6474", "The Journal of Neuroscience"), siteUrl: "https://www.jneurosci.org", category: "neuroscience", region: "US", tier: 3, issn: ["0270-6474", "1529-2401"] },
  { id: "eneuro", name: "eNeuro", feedUrl: "https://www.eneuro.org/rss/current.xml", siteUrl: "https://www.eneuro.org", category: "neuroscience", region: "US", tier: 3, issn: ["2373-2822"] },
  { id: "elife-neuro", name: "eLife", section: "Neuroscience", feedUrl: "https://elifesciences.org/rss/subject/neuroscience.xml", siteUrl: "https://elifesciences.org/subjects/neuroscience", category: "neuroscience", region: "Global", tier: 3 },
  { id: "plos-compbio", name: "PLOS Computational Biology", feedUrl: "https://journals.plos.org/ploscompbiol/feed/atom", siteUrl: "https://journals.plos.org/ploscompbiol", category: "neuroscience", region: "Global", tier: 3, issn: ["1553-734X", "1553-7358"] },
  { id: "jneurophys", name: "Journal of Neurophysiology", feedUrl: "https://journals.physiology.org/action/showFeed?type=etoc&feed=rss&jc=jn", siteUrl: "https://journals.physiology.org/journal/jn", category: "neuroscience", region: "US", tier: 3, issn: ["0022-3077", "1522-1598"] },
  { id: "neuroimage", name: "NeuroImage", feedUrl: journal("1053-8119", "NeuroImage"), siteUrl: "https://www.sciencedirect.com/journal/neuroimage", category: "neuroscience", region: "Global", tier: 3, issn: ["1053-8119", "1095-9572"] },
  { id: "brain", name: "Brain", feedUrl: journal("0006-8950", "Brain"), siteUrl: "https://academic.oup.com/brain", category: "neuroscience", region: "UK", tier: 3, issn: ["0006-8950", "1460-2156"] },
  { id: "cercor", name: "Cerebral Cortex", feedUrl: journal("1047-3211", "Cerebral Cortex"), siteUrl: "https://academic.oup.com/cercor", category: "neuroscience", region: "Global", tier: 3, issn: ["1047-3211", "1460-2199"] },
  { id: "biorxiv-neuro", name: "bioRxiv", section: "Neuroscience", feedUrl: "api:rxiv?server=biorxiv&subject=neuroscience", siteUrl: "https://www.biorxiv.org/collection/neuroscience", category: "neuroscience", region: "Global", tier: 3 },
  { id: "medrxiv-neuro", name: "medRxiv", section: "Neurology", feedUrl: "api:rxiv?server=medrxiv&subject=neurology", siteUrl: "https://www.medrxiv.org/collection/neurology", category: "neuroscience", region: "Global", tier: 3 },
  { id: "arxiv-qbio-nc", name: "arXiv", section: "Neurons and Cognition", feedUrl: arxiv("q-bio.NC"), siteUrl: "https://arxiv.org/list/q-bio.NC/recent", category: "neuroscience", region: "Global", tier: 3 },
  { id: "neurosciencenews", name: "Neuroscience News", feedUrl: "https://neurosciencenews.com/feed/", siteUrl: "https://neurosciencenews.com", category: "neuroscience", region: "US", tier: 3 },
  { id: "transmitter", name: "The Transmitter", feedUrl: "https://www.thetransmitter.org/feed/", siteUrl: "https://www.thetransmitter.org", category: "neuroscience", region: "US", tier: 3 },

  { id: "sep", name: "Stanford Encyclopedia of Philosophy", section: "New and revised entries", feedUrl: "https://plato.stanford.edu/rss/sep.xml", siteUrl: "https://plato.stanford.edu", category: "philosophy", region: "US", tier: 3 },
  { id: "dailynous", name: "Daily Nous", feedUrl: "https://dailynous.com/feed/", siteUrl: "https://dailynous.com", category: "philosophy", region: "US", tier: 3 },
  { id: "aeon", name: "Aeon", section: "Essays", feedUrl: "https://aeon.co/feed.rss", siteUrl: "https://aeon.co", category: "philosophy", region: "Global", tier: 3 },
  { id: "psyche", name: "Psyche", feedUrl: "https://psyche.co/feed.rss", siteUrl: "https://psyche.co", category: "philosophy", region: "Global", tier: 3 },
  { id: "brainsblog", name: "The Brains Blog", feedUrl: "https://philosophyofbrains.com/feed", siteUrl: "https://philosophyofbrains.com", category: "philosophy", region: "Global", tier: 3 },
  { id: "peasoup", name: "PEA Soup", feedUrl: "https://peasoupblog.com/feed/", siteUrl: "https://peasoupblog.com", category: "philosophy", region: "Global", tier: 3 },
  { id: "leiter", name: "Leiter Reports", feedUrl: "https://leiterreports.com/feed/", siteUrl: "https://leiterreports.com", category: "philosophy", region: "US", tier: 3 },
  { id: "nous", name: "Noûs", feedUrl: "https://onlinelibrary.wiley.com/feed/14680068/most-recent", siteUrl: "https://onlinelibrary.wiley.com/journal/14680068", category: "philosophy", region: "Global", tier: 3, issn: ["0029-4624", "1468-0068"] },
  { id: "ppr", name: "Philosophy and Phenomenological Research", feedUrl: "https://onlinelibrary.wiley.com/feed/19331592/most-recent", siteUrl: "https://onlinelibrary.wiley.com/journal/19331592", category: "philosophy", region: "Global", tier: 3, issn: ["0031-8205", "1933-1592"] },
  { id: "mindlang", name: "Mind & Language", feedUrl: "https://onlinelibrary.wiley.com/feed/14680017/most-recent", siteUrl: "https://onlinelibrary.wiley.com/journal/14680017", category: "philosophy", region: "Global", tier: 3, issn: ["0268-1064", "1468-0017"] },
  { id: "philcompass", name: "Philosophy Compass", feedUrl: "https://onlinelibrary.wiley.com/feed/17479991/most-recent", siteUrl: "https://onlinelibrary.wiley.com/journal/17479991", category: "philosophy", region: "Global", tier: 3, issn: ["1747-9991"] },
  { id: "ajp", name: "Australasian Journal of Philosophy", feedUrl: "https://www.tandfonline.com/feed/rss/rajp20", siteUrl: "https://www.tandfonline.com/journals/rajp20", category: "philosophy", region: "Global", tier: 3, issn: ["0004-8402", "1471-6828"] },
  { id: "mind", name: "Mind", feedUrl: journal("0026-4423", "Mind"), siteUrl: "https://academic.oup.com/mind", category: "philosophy", region: "UK", tier: 3, issn: ["0026-4423", "1460-2113"] },
  { id: "pq", name: "The Philosophical Quarterly", feedUrl: journal("0031-8094", "The Philosophical Quarterly"), siteUrl: "https://academic.oup.com/pq", category: "philosophy", region: "UK", tier: 3, issn: ["0031-8094", "1467-9213"] },
  { id: "philreview", name: "The Philosophical Review", feedUrl: journal("0031-8108", "The Philosophical Review"), siteUrl: "https://read.dukeupress.edu/the-philosophical-review", category: "philosophy", region: "US", tier: 3, issn: ["0031-8108", "1558-1470"] },
  { id: "jphil", name: "The Journal of Philosophy", feedUrl: journal("0022-362X", "The Journal of Philosophy", "crossref"), siteUrl: "https://www.pdcnet.org/jphil", category: "philosophy", region: "US", tier: 3, issn: ["0022-362X", "1939-8549"] },
  { id: "ethics", name: "Ethics", feedUrl: journal("0014-1704", "Ethics"), siteUrl: "https://www.journals.uchicago.edu/journal/et", category: "philosophy", region: "US", tier: 3, issn: ["0014-1704", "1539-297X"] },
  { id: "philstudies", name: "Philosophical Studies", feedUrl: journal("0031-8116", "Philosophical Studies"), siteUrl: "https://link.springer.com/journal/11098", category: "philosophy", region: "Global", tier: 3, issn: ["0031-8116", "1573-0883"] },
  { id: "synthese", name: "Synthese", feedUrl: journal("0039-7857", "Synthese"), siteUrl: "https://link.springer.com/journal/11229", category: "philosophy", region: "Global", tier: 3, issn: ["0039-7857", "1573-0964"] },
  { id: "erkenntnis", name: "Erkenntnis", feedUrl: journal("0165-0106", "Erkenntnis"), siteUrl: "https://link.springer.com/journal/10670", category: "philosophy", region: "Global", tier: 3, issn: ["0165-0106", "1572-8420"] },
  { id: "ergo", name: "Ergo", feedUrl: journal("2330-4014", "Ergo", "crossref"), siteUrl: "https://journals.publishing.umich.edu/ergo", category: "philosophy", region: "Global", tier: 3, issn: ["2330-4014"] },
  { id: "philsci", name: "Philosophy of Science", feedUrl: journal("0031-8248", "Philosophy of Science"), siteUrl: "https://www.cambridge.org/core/journals/philosophy-of-science", category: "philosophy", region: "Global", tier: 3, issn: ["0031-8248", "1539-767X"] },
  { id: "bjps", name: "The British Journal for the Philosophy of Science", feedUrl: journal("0007-0882", "The British Journal for the Philosophy of Science"), siteUrl: "https://www.journals.uchicago.edu/journal/bjps", category: "philosophy", region: "UK", tier: 3, issn: ["0007-0882", "1464-3537"] },
  { id: "arxiv-hist-ph", name: "arXiv", section: "History and Philosophy of Physics", feedUrl: arxiv("physics.hist-ph"), siteUrl: "https://arxiv.org/list/physics.hist-ph/recent", category: "philosophy", region: "Global", tier: 3 },

  { id: "science-journal", name: "Science", section: "Table of contents", feedUrl: "https://www.science.org/action/showFeed?type=etoc&feed=rss&jc=science", siteUrl: "https://www.science.org/journal/science", category: "research", region: "US", tier: 3, issn: ["0036-8075", "1095-9203"] },
  { id: "pnas", name: "PNAS", feedUrl: "https://www.pnas.org/action/showFeed?type=etoc&feed=rss&jc=pnas", siteUrl: "https://www.pnas.org", category: "research", region: "US", tier: 3, issn: ["0027-8424", "1091-6490"] },
  { id: "cell", name: "Cell", feedUrl: "https://www.cell.com/cell/inpress.rss", siteUrl: "https://www.cell.com/cell", category: "biology", region: "US", tier: 3, issn: ["0092-8674", "1097-4172"] },
  { id: "curbio", name: "Current Biology", feedUrl: "https://www.cell.com/current-biology/inpress.rss", siteUrl: "https://www.cell.com/current-biology", category: "biology", region: "US", tier: 3, issn: ["0960-9822", "1879-0445"] },
  { id: "elife", name: "eLife", feedUrl: "https://elifesciences.org/rss/recent.xml", siteUrl: "https://elifesciences.org", category: "research", region: "Global", tier: 3, issn: ["2050-084X"] },
  { id: "plos-biology", name: "PLOS Biology", feedUrl: "https://journals.plos.org/plosbiology/feed/atom", siteUrl: "https://journals.plos.org/plosbiology", category: "biology", region: "Global", tier: 3, issn: ["1544-9173", "1545-7885"] },
  { id: "arxiv-cs-ai", name: "arXiv", section: "Artificial Intelligence", feedUrl: arxiv("cs.AI"), siteUrl: "https://arxiv.org/list/cs.AI/recent", category: "computing", region: "Global", tier: 3 },
  { id: "arxiv-cs-lg", name: "arXiv", section: "Machine Learning", feedUrl: arxiv("cs.LG"), siteUrl: "https://arxiv.org/list/cs.LG/recent", category: "computing", region: "Global", tier: 3 },
  { id: "arxiv-cs-cl", name: "arXiv", section: "Computation and Language", feedUrl: arxiv("cs.CL"), siteUrl: "https://arxiv.org/list/cs.CL/recent", category: "computing", region: "Global", tier: 3 },
  { id: "arxiv-stat-ml", name: "arXiv", section: "Machine Learning (Statistics)", feedUrl: arxiv("stat.ML"), siteUrl: "https://arxiv.org/list/stat.ML/recent", category: "computing", region: "Global", tier: 3 },
  { id: "arxiv-cs-cy", name: "arXiv", section: "Computers and Society", feedUrl: arxiv("cs.CY"), siteUrl: "https://arxiv.org/list/cs.CY/recent", category: "computing", region: "Global", tier: 3 },
  { id: "arxiv-quant-ph", name: "arXiv", section: "Quantum Physics", feedUrl: arxiv("quant-ph"), siteUrl: "https://arxiv.org/list/quant-ph/recent", category: "physics", region: "Global", tier: 3 },
  { id: "arxiv-astro-ph", name: "arXiv", section: "Astrophysics", feedUrl: arxiv("astro-ph"), siteUrl: "https://arxiv.org/list/astro-ph/recent", category: "physics", region: "Global", tier: 3 },
  { id: "arxiv-econ-gn", name: "arXiv", section: "General Economics", feedUrl: arxiv("econ.GN"), siteUrl: "https://arxiv.org/list/econ.GN/recent", category: "economics", region: "Global", tier: 3 },

  // ---- Every discipline (12 Oct 2026) -------------------------------------
  // Measured from a preview deployment before any was added (docs/COLLECTION.md
  // §2, "Every discipline"). A publisher's own table of contents wherever it
  // answered — Wiley, Chicago, SAGE, Taylor & Francis, Nature, Cell Press, APS,
  // NEJM, the Lancet, JAMA, the BMJ — because a feed costs nothing to read and
  // OpenAlex allows a thousand requests a day. By ISSN only where the
  // publisher refused (Oxford, Cambridge, APA, Annual Reviews, AEA, ACS) or
  // served nonsense; through Crossref first where OpenAlex knows only the year.

  // Economics and finance
  { id: "aer", name: "American Economic Review", feedUrl: journal("0002-8282", "American Economic Review"), siteUrl: "https://www.aeaweb.org/journals/aer", category: "economics", region: "US", tier: 3, issn: ["0002-8282", "1944-7981"] },
  { id: "qje", name: "The Quarterly Journal of Economics", feedUrl: journal("0033-5533", "The Quarterly Journal of Economics"), siteUrl: "https://academic.oup.com/qje", category: "economics", region: "US", tier: 3, issn: ["0033-5533", "1531-4650"] },
  { id: "jpe", name: "Journal of Political Economy", feedUrl: chicago("jpe"), siteUrl: "https://www.journals.uchicago.edu/journal/jpe", category: "economics", region: "US", tier: 3, issn: ["0022-3808", "1537-534X"] },
  { id: "econometrica", name: "Econometrica", feedUrl: wiley("14680262"), siteUrl: "https://onlinelibrary.wiley.com/journal/14680262", category: "economics", region: "Global", tier: 3, issn: ["0012-9682", "1468-0262"] },
  { id: "restud", name: "The Review of Economic Studies", feedUrl: journal("0034-6527", "The Review of Economic Studies"), siteUrl: "https://academic.oup.com/restud", category: "economics", region: "UK", tier: 3, issn: ["0034-6527", "1467-937X"] },
  { id: "jep", name: "Journal of Economic Perspectives", feedUrl: journal("0895-3309", "Journal of Economic Perspectives"), siteUrl: "https://www.aeaweb.org/journals/jep", category: "economics", region: "US", tier: 3, issn: ["0895-3309", "1944-7965"] },
  { id: "jfinance", name: "The Journal of Finance", feedUrl: wiley("15406261"), siteUrl: "https://onlinelibrary.wiley.com/journal/15406261", category: "economics", region: "US", tier: 3, issn: ["0022-1082", "1540-6261"] },
  { id: "areconomics", name: "Annual Review of Economics", feedUrl: journal("1941-1383", "Annual Review of Economics"), siteUrl: "https://www.annualreviews.org/content/journals/economics", category: "economics", region: "US", tier: 3, issn: ["1941-1383", "1941-1391"] },
  { id: "nber", name: "NBER", section: "New working papers", feedUrl: "https://www.nber.org/rss/new.xml", siteUrl: "https://www.nber.org/papers", category: "economics", region: "US", tier: 3 },
  { id: "arxiv-econ-em", name: "arXiv", section: "Econometrics", feedUrl: arxiv("econ.EM"), siteUrl: "https://arxiv.org/list/econ.EM/recent", category: "economics", region: "Global", tier: 3 },

  // Psychology
  { id: "psychsci", name: "Psychological Science", feedUrl: sage("pss"), siteUrl: "https://journals.sagepub.com/home/pss", category: "psychology", region: "US", tier: 3, issn: ["0956-7976", "1467-9280"] },
  { id: "psychreview", name: "Psychological Review", feedUrl: journal("0033-295X", "Psychological Review"), siteUrl: "https://psycnet.apa.org/PsycARTICLES/journal/rev", category: "psychology", region: "US", tier: 3, issn: ["0033-295X", "1939-1471"] },
  { id: "psychbull", name: "Psychological Bulletin", feedUrl: journal("0033-2909", "Psychological Bulletin"), siteUrl: "https://psycnet.apa.org/PsycARTICLES/journal/bul", category: "psychology", region: "US", tier: 3, issn: ["0033-2909", "1939-1455"] },
  { id: "jpsp", name: "Journal of Personality and Social Psychology", feedUrl: journal("0022-3514", "Journal of Personality and Social Psychology"), siteUrl: "https://psycnet.apa.org/PsycARTICLES/journal/psp", category: "psychology", region: "US", tier: 3, issn: ["0022-3514", "1939-1315"] },
  { id: "jepgeneral", name: "Journal of Experimental Psychology: General", feedUrl: journal("0096-3445", "Journal of Experimental Psychology: General"), siteUrl: "https://psycnet.apa.org/PsycARTICLES/journal/xge", category: "psychology", region: "US", tier: 3, issn: ["0096-3445", "1939-2222"] },
  { id: "cognition", name: "Cognition", feedUrl: journal("0010-0277", "Cognition"), siteUrl: "https://www.sciencedirect.com/journal/cognition", category: "psychology", region: "Global", tier: 3, issn: ["0010-0277", "1873-7838"] },
  { id: "perspectives-psych", name: "Perspectives on Psychological Science", feedUrl: sage("pps"), siteUrl: "https://journals.sagepub.com/home/pps", category: "psychology", region: "US", tier: 3, issn: ["1745-6916", "1745-6924"] },
  { id: "bbs", name: "Behavioral and Brain Sciences", feedUrl: journal("0140-525X", "Behavioral and Brain Sciences"), siteUrl: "https://www.cambridge.org/core/journals/behavioral-and-brain-sciences", category: "psychology", region: "Global", tier: 3, issn: ["0140-525X", "1469-1825"] },
  { id: "arpsych", name: "Annual Review of Psychology", feedUrl: journal("0066-4308", "Annual Review of Psychology"), siteUrl: "https://www.annualreviews.org/content/journals/psych", category: "psychology", region: "US", tier: 3, issn: ["0066-4308", "1545-2085"] },
  { id: "nrpsych", name: "Nature Reviews Psychology", feedUrl: natureFeed("nrpsychol"), siteUrl: "https://www.nature.com/nrpsychol", category: "psychology", region: "Global", tier: 3, issn: ["2731-0574"] },
  { id: "psyarxiv", name: "PsyArXiv", feedUrl: osf("psyarxiv"), siteUrl: "https://osf.io/preprints/psyarxiv", category: "psychology", region: "Global", tier: 3 },
  { id: "medrxiv-psych", name: "medRxiv", section: "Psychiatry and clinical psychology", feedUrl: rxiv("medrxiv", "psychiatry_and_clinical_psychology"), siteUrl: "https://www.medrxiv.org/collection/psychiatry-and-clinical-psychology", category: "psychology", region: "Global", tier: 3 },

  // Sociology and demography
  { id: "asr", name: "American Sociological Review", feedUrl: sage("asr"), siteUrl: "https://journals.sagepub.com/home/asr", category: "sociology", region: "US", tier: 3, issn: ["0003-1224", "1939-8271"] },
  { id: "ajs", name: "American Journal of Sociology", feedUrl: chicago("ajs"), siteUrl: "https://www.journals.uchicago.edu/journal/ajs", category: "sociology", region: "US", tier: 3, issn: ["0002-9602", "1537-5390"] },
  { id: "arsoc", name: "Annual Review of Sociology", feedUrl: journal("0360-0572", "Annual Review of Sociology"), siteUrl: "https://www.annualreviews.org/content/journals/soc", category: "sociology", region: "US", tier: 3, issn: ["0360-0572", "1545-2115"] },
  { id: "socforces", name: "Social Forces", feedUrl: journal("0037-7732", "Social Forces"), siteUrl: "https://academic.oup.com/sf", category: "sociology", region: "US", tier: 3, issn: ["0037-7732", "1534-7605"] },
  { id: "socscience", name: "Sociological Science", feedUrl: journal("2330-6696", "Sociological Science", "crossref"), siteUrl: "https://sociologicalscience.com", category: "sociology", region: "US", tier: 3, issn: ["2330-6696"] },
  { id: "esr", name: "European Sociological Review", feedUrl: journal("0266-7215", "European Sociological Review"), siteUrl: "https://academic.oup.com/esr", category: "sociology", region: "Europe", tier: 3, issn: ["0266-7215", "1468-2672"] },
  { id: "demography", name: "Demography", feedUrl: journal("0070-3370", "Demography"), siteUrl: "https://read.dukeupress.edu/demography", category: "sociology", region: "US", tier: 3, issn: ["0070-3370", "1533-7790"] },
  { id: "ssresearch", name: "Social Science Research", feedUrl: journal("0049-089X", "Social Science Research"), siteUrl: "https://www.sciencedirect.com/journal/social-science-research", category: "sociology", region: "Global", tier: 3, issn: ["0049-089X", "1096-0317"] },
  { id: "socarxiv", name: "SocArXiv", feedUrl: osf("socarxiv"), siteUrl: "https://osf.io/preprints/socarxiv", category: "sociology", region: "Global", tier: 3 },

  // Political science
  { id: "apsr", name: "American Political Science Review", feedUrl: journal("0003-0554", "American Political Science Review"), siteUrl: "https://www.cambridge.org/core/journals/american-political-science-review", category: "polisci", region: "US", tier: 3, issn: ["0003-0554", "1537-5943"] },
  { id: "ajps", name: "American Journal of Political Science", feedUrl: wiley("15405907"), siteUrl: "https://onlinelibrary.wiley.com/journal/15405907", category: "polisci", region: "US", tier: 3, issn: ["0092-5853", "1540-5907"] },
  { id: "jop", name: "The Journal of Politics", feedUrl: chicago("jop"), siteUrl: "https://www.journals.uchicago.edu/journal/jop", category: "polisci", region: "US", tier: 3, issn: ["0022-3816", "1468-2508"] },
  { id: "intorg", name: "International Organization", feedUrl: journal("0020-8183", "International Organization"), siteUrl: "https://www.cambridge.org/core/journals/international-organization", category: "polisci", region: "Global", tier: 3, issn: ["0020-8183", "1531-5088"] },
  { id: "arpolisci", name: "Annual Review of Political Science", feedUrl: journal("1094-2939", "Annual Review of Political Science"), siteUrl: "https://www.annualreviews.org/content/journals/polisci", category: "polisci", region: "US", tier: 3, issn: ["1094-2939", "1545-1577"] },
  { id: "cps", name: "Comparative Political Studies", feedUrl: sage("cps"), siteUrl: "https://journals.sagepub.com/home/cps", category: "polisci", region: "Global", tier: 3, issn: ["0010-4140", "1552-3829"] },
  { id: "polanalysis", name: "Political Analysis", feedUrl: journal("1047-1987", "Political Analysis"), siteUrl: "https://www.cambridge.org/core/journals/political-analysis", category: "polisci", region: "Global", tier: 3, issn: ["1047-1987", "1476-4989"] },
  { id: "bjpolsci", name: "British Journal of Political Science", feedUrl: journal("0007-1234", "British Journal of Political Science", "crossref"), siteUrl: "https://www.cambridge.org/core/journals/british-journal-of-political-science", category: "polisci", region: "UK", tier: 3, issn: ["0007-1234", "1469-2112"] },
  { id: "goodauthority", name: "Good Authority", feedUrl: "https://goodauthority.org/feed/", siteUrl: "https://goodauthority.org", category: "polisci", region: "US", tier: 3 },

  // Anthropology
  { id: "amanth", name: "American Anthropologist", feedUrl: wiley("15481433"), siteUrl: "https://anthrosource.onlinelibrary.wiley.com/journal/15481433", category: "anthropology", region: "US", tier: 3, issn: ["0002-7294", "1548-1433"] },
  { id: "curranth", name: "Current Anthropology", feedUrl: chicago("ca"), siteUrl: "https://www.journals.uchicago.edu/journal/ca", category: "anthropology", region: "Global", tier: 3, issn: ["0011-3204", "1537-5382"] },
  { id: "aranth", name: "Annual Review of Anthropology", feedUrl: journal("0084-6570", "Annual Review of Anthropology"), siteUrl: "https://www.annualreviews.org/content/journals/anthro", category: "anthropology", region: "US", tier: 3, issn: ["0084-6570", "1545-4290"] },
  { id: "jrai", name: "Journal of the Royal Anthropological Institute", feedUrl: wiley("14679655"), siteUrl: "https://rai.onlinelibrary.wiley.com/journal/14679655", category: "anthropology", region: "UK", tier: 3, issn: ["1359-0987", "1467-9655"] },
  { id: "amethnologist", name: "American Ethnologist", feedUrl: wiley("15481425"), siteUrl: "https://anthrosource.onlinelibrary.wiley.com/journal/15481425", category: "anthropology", region: "US", tier: 3, issn: ["0094-0496", "1548-1425"] },
  { id: "culanth", name: "Cultural Anthropology", feedUrl: journal("0886-7356", "Cultural Anthropology"), siteUrl: "https://journal.culanth.org", category: "anthropology", region: "US", tier: 3, issn: ["0886-7356", "1548-1360"] },
  { id: "hau", name: "HAU: Journal of Ethnographic Theory", feedUrl: chicago("hau"), siteUrl: "https://www.journals.uchicago.edu/journal/hau", category: "anthropology", region: "Global", tier: 3, issn: ["2575-1433", "2049-1115"] },
  { id: "jhumevol", name: "Journal of Human Evolution", feedUrl: journal("0047-2484", "Journal of Human Evolution"), siteUrl: "https://www.sciencedirect.com/journal/journal-of-human-evolution", category: "anthropology", region: "Global", tier: 3, issn: ["0047-2484", "1095-8606"] },

  // History
  { id: "ahr", name: "The American Historical Review", feedUrl: journal("0002-8762", "The American Historical Review"), siteUrl: "https://academic.oup.com/ahr", category: "history", region: "US", tier: 3, issn: ["0002-8762", "1937-5239"] },
  { id: "pastpresent", name: "Past & Present", feedUrl: journal("0031-2746", "Past & Present"), siteUrl: "https://academic.oup.com/past", category: "history", region: "UK", tier: 3, issn: ["0031-2746", "1477-464X"] },
  { id: "jmodhist", name: "The Journal of Modern History", feedUrl: chicago("jmh"), siteUrl: "https://www.journals.uchicago.edu/journal/jmh", category: "history", region: "US", tier: 3, issn: ["0022-2801", "1537-5358"] },
  { id: "isis", name: "Isis", feedUrl: chicago("isis"), siteUrl: "https://www.journals.uchicago.edu/journal/isis", category: "history", region: "US", tier: 3, issn: ["0021-1753", "1545-6994"] },
  { id: "hwj", name: "History Workshop Journal", feedUrl: journal("1363-3554", "History Workshop Journal", "crossref"), siteUrl: "https://academic.oup.com/hwj", category: "history", region: "UK", tier: 3, issn: ["1363-3554", "1477-4569"] },
  { id: "jamhist", name: "Journal of American History", feedUrl: journal("0021-8723", "Journal of American History"), siteUrl: "https://academic.oup.com/jah", category: "history", region: "US", tier: 3, issn: ["0021-8723", "1945-2314"] },
  { id: "histtheory", name: "History and Theory", feedUrl: wiley("14682303"), siteUrl: "https://onlinelibrary.wiley.com/journal/14682303", category: "history", region: "Global", tier: 3, issn: ["0018-2656", "1468-2303"] },
  { id: "econhistrev", name: "The Economic History Review", feedUrl: wiley("14680289"), siteUrl: "https://onlinelibrary.wiley.com/journal/14680289", category: "history", region: "UK", tier: 3, issn: ["0013-0117", "1468-0289"] },

  // Linguistics
  { id: "language-lsa", name: "Language", feedUrl: journal("0097-8507", "Language"), siteUrl: "https://www.linguisticsociety.org/lsa-publications/language", category: "linguistics", region: "US", tier: 3, issn: ["0097-8507", "1535-0665"] },
  { id: "linginquiry", name: "Linguistic Inquiry", feedUrl: journal("0024-3892", "Linguistic Inquiry"), siteUrl: "https://direct.mit.edu/ling", category: "linguistics", region: "US", tier: 3, issn: ["0024-3892", "1530-9150"] },
  { id: "jling", name: "Journal of Linguistics", feedUrl: journal("0022-2267", "Journal of Linguistics"), siteUrl: "https://www.cambridge.org/core/journals/journal-of-linguistics", category: "linguistics", region: "UK", tier: 3, issn: ["0022-2267", "1469-7742"] },
  { id: "nllt", name: "Natural Language & Linguistic Theory", feedUrl: journal("0167-806X", "Natural Language & Linguistic Theory"), siteUrl: "https://link.springer.com/journal/11049", category: "linguistics", region: "Global", tier: 3, issn: ["0167-806X", "1573-0859"] },
  { id: "glossa", name: "Glossa", feedUrl: journal("2397-1835", "Glossa"), siteUrl: "https://www.glossa-journal.org", category: "linguistics", region: "Global", tier: 3, issn: ["2397-1835"] },
  { id: "jml", name: "Journal of Memory and Language", feedUrl: journal("0749-596X", "Journal of Memory and Language"), siteUrl: "https://www.sciencedirect.com/journal/journal-of-memory-and-language", category: "linguistics", region: "Global", tier: 3, issn: ["0749-596X", "1096-0821"] },
  { id: "languagelog", name: "Language Log", feedUrl: "https://languagelog.ldc.upenn.edu/nll/?feed=rss2", siteUrl: "https://languagelog.ldc.upenn.edu/nll/", category: "linguistics", region: "US", tier: 3 },

  // Education
  { id: "aerj", name: "American Educational Research Journal", feedUrl: sage("aer"), siteUrl: "https://journals.sagepub.com/home/aer", category: "education", region: "US", tier: 3, issn: ["0002-8312", "1935-1011"] },
  { id: "rer", name: "Review of Educational Research", feedUrl: sage("rer"), siteUrl: "https://journals.sagepub.com/home/rer", category: "education", region: "US", tier: 3, issn: ["0034-6543", "1935-1046"] },
  { id: "edresearcher", name: "Educational Researcher", feedUrl: sage("edr"), siteUrl: "https://journals.sagepub.com/home/edr", category: "education", region: "US", tier: 3, issn: ["0013-189X", "1935-102X"] },
  { id: "socofed", name: "Sociology of Education", feedUrl: sage("soe"), siteUrl: "https://journals.sagepub.com/home/soe", category: "education", region: "US", tier: 3, issn: ["0038-0407", "1939-8573"] },
  { id: "jedpsych", name: "Journal of Educational Psychology", feedUrl: journal("0022-0663", "Journal of Educational Psychology"), siteUrl: "https://psycnet.apa.org/PsycARTICLES/journal/edu", category: "education", region: "US", tier: 3, issn: ["0022-0663", "1939-2176"] },
  { id: "edarxiv", name: "EdArXiv", feedUrl: osf("edarxiv"), siteUrl: "https://osf.io/preprints/edarxiv", category: "education", region: "Global", tier: 3 },

  // Legal scholarship
  { id: "harvardlawreview", name: "Harvard Law Review", feedUrl: "https://harvardlawreview.org/feed/", siteUrl: "https://harvardlawreview.org", category: "legal", region: "US", tier: 3, issn: ["0017-811X", "2161-976X"] },
  { id: "lawsocreview", name: "Law & Society Review", feedUrl: journal("0023-9216", "Law & Society Review"), siteUrl: "https://www.cambridge.org/core/journals/law-and-society-review", category: "legal", region: "US", tier: 3, issn: ["0023-9216", "1540-5893"] },
  { id: "jlegalstudies", name: "The Journal of Legal Studies", feedUrl: chicago("jls"), siteUrl: "https://www.journals.uchicago.edu/journal/jls", category: "legal", region: "US", tier: 3, issn: ["0047-2530", "1537-5366"] },
  { id: "jlaweconomics", name: "The Journal of Law and Economics", feedUrl: chicago("jle"), siteUrl: "https://www.journals.uchicago.edu/journal/jle", category: "legal", region: "US", tier: 3, issn: ["0022-2186", "1537-5285"] },
  { id: "lawarxiv", name: "LawArXiv", feedUrl: osf("lawarxiv"), siteUrl: "https://osf.io/preprints/lawarxiv", category: "legal", region: "Global", tier: 3 },

  // Geography and urban studies
  { id: "annalsaag", name: "Annals of the American Association of Geographers", feedUrl: tandf("raag21"), siteUrl: "https://www.tandfonline.com/journals/raag21", category: "geography", region: "US", tier: 3, issn: ["2469-4452", "2469-4460"] },
  { id: "phg", name: "Progress in Human Geography", feedUrl: sage("phg"), siteUrl: "https://journals.sagepub.com/home/phg", category: "geography", region: "UK", tier: 3, issn: ["0309-1325", "1477-0288"] },
  { id: "urbanstudies", name: "Urban Studies", feedUrl: sage("usj"), siteUrl: "https://journals.sagepub.com/home/usj", category: "geography", region: "UK", tier: 3, issn: ["0042-0980", "1360-063X"] },
  { id: "tibg", name: "Transactions of the Institute of British Geographers", feedUrl: wiley("14755661"), siteUrl: "https://rgs-ibg.onlinelibrary.wiley.com/journal/14755661", category: "geography", region: "UK", tier: 3, issn: ["0020-2754", "1475-5661"] },

  // Literature, arts and classics
  { id: "pmla", name: "PMLA", feedUrl: journal("0030-8129", "PMLA", "crossref"), siteUrl: "https://www.cambridge.org/core/journals/pmla", category: "humanities", region: "US", tier: 3, issn: ["0030-8129", "1938-1530"] },
  { id: "critinquiry", name: "Critical Inquiry", feedUrl: chicago("ci"), siteUrl: "https://www.journals.uchicago.edu/journal/ci", category: "humanities", region: "US", tier: 3, issn: ["0093-1896", "1539-7858"] },
  { id: "nlh", name: "New Literary History", feedUrl: journal("0028-6087", "New Literary History", "crossref"), siteUrl: "https://www.press.jhu.edu/journals/new-literary-history", category: "humanities", region: "US", tier: 3, issn: ["0028-6087", "1080-661X"] },
  { id: "artbulletin", name: "The Art Bulletin", feedUrl: tandf("rcab20"), siteUrl: "https://www.tandfonline.com/journals/rcab20", category: "humanities", region: "US", tier: 3, issn: ["0004-3079", "1559-6478"] },
  { id: "classicalq", name: "The Classical Quarterly", feedUrl: journal("0009-8388", "The Classical Quarterly"), siteUrl: "https://www.cambridge.org/core/journals/classical-quarterly", category: "humanities", region: "UK", tier: 3, issn: ["0009-8388", "1471-6844"] },
  { id: "representations", name: "Representations", feedUrl: journal("0734-6018", "Representations", "crossref"), siteUrl: "https://online.ucpress.edu/representations", category: "humanities", region: "US", tier: 3, issn: ["0734-6018", "1533-855X"] },

  // Biology and genetics
  { id: "natgenet", name: "Nature Genetics", feedUrl: natureFeed("ng"), siteUrl: "https://www.nature.com/ng", category: "biology", region: "Global", tier: 3, issn: ["1061-4036", "1546-1718"] },
  { id: "natcellbio", name: "Nature Cell Biology", feedUrl: natureFeed("ncb"), siteUrl: "https://www.nature.com/ncb", category: "biology", region: "Global", tier: 3, issn: ["1465-7392", "1476-4679"] },
  { id: "natmicro", name: "Nature Microbiology", feedUrl: natureFeed("nmicrobiol"), siteUrl: "https://www.nature.com/nmicrobiol", category: "biology", region: "Global", tier: 3, issn: ["2058-5276"] },
  { id: "molcell", name: "Molecular Cell", feedUrl: "https://www.cell.com/molecular-cell/inpress.rss", siteUrl: "https://www.cell.com/molecular-cell", category: "biology", region: "US", tier: 3, issn: ["1097-2765", "1097-4164"] },
  { id: "ajhg", name: "The American Journal of Human Genetics", feedUrl: "https://www.cell.com/ajhg/inpress.rss", siteUrl: "https://www.cell.com/ajhg", category: "biology", region: "US", tier: 3, issn: ["0002-9297", "1537-6605"] },
  { id: "genomeres", name: "Genome Research", feedUrl: journal("1088-9051", "Genome Research"), siteUrl: "https://genome.cshlp.org", category: "biology", region: "US", tier: 3, issn: ["1088-9051", "1549-5469"] },
  { id: "biorxiv-genomics", name: "bioRxiv", section: "Genomics", feedUrl: rxiv("biorxiv", "genomics"), siteUrl: "https://www.biorxiv.org/collection/genomics", category: "biology", region: "Global", tier: 3 },
  { id: "biorxiv-cellbio", name: "bioRxiv", section: "Cell biology", feedUrl: rxiv("biorxiv", "cell_biology"), siteUrl: "https://www.biorxiv.org/collection/cell-biology", category: "biology", region: "Global", tier: 3 },
  { id: "biorxiv-micro", name: "bioRxiv", section: "Microbiology", feedUrl: rxiv("biorxiv", "microbiology"), siteUrl: "https://www.biorxiv.org/collection/microbiology", category: "biology", region: "Global", tier: 3 },

  // Ecology and evolution
  { id: "natecolevol", name: "Nature Ecology & Evolution", feedUrl: natureFeed("natecolevol"), siteUrl: "https://www.nature.com/natecolevol", category: "ecology", region: "Global", tier: 3, issn: ["2397-334X"] },
  { id: "tree", name: "Trends in Ecology & Evolution", feedUrl: "https://www.cell.com/trends/ecology-evolution/inpress.rss", siteUrl: "https://www.cell.com/trends/ecology-evolution", category: "ecology", region: "Global", tier: 3, issn: ["0169-5347", "1872-8383"] },
  { id: "ecolett", name: "Ecology Letters", feedUrl: wiley("14610248"), siteUrl: "https://onlinelibrary.wiley.com/journal/14610248", category: "ecology", region: "Global", tier: 3, issn: ["1461-023X", "1461-0248"] },
  { id: "gcb", name: "Global Change Biology", feedUrl: wiley("13652486"), siteUrl: "https://onlinelibrary.wiley.com/journal/13652486", category: "ecology", region: "Global", tier: 3, issn: ["1354-1013", "1365-2486"] },
  { id: "ecology-esa", name: "Ecology", feedUrl: wiley("19399170"), siteUrl: "https://esajournals.onlinelibrary.wiley.com/journal/19399170", category: "ecology", region: "US", tier: 3, issn: ["0012-9658", "1939-9170"] },
  { id: "mbe", name: "Molecular Biology and Evolution", feedUrl: journal("0737-4038", "Molecular Biology and Evolution"), siteUrl: "https://academic.oup.com/mbe", category: "ecology", region: "Global", tier: 3, issn: ["0737-4038", "1537-1719"] },
  { id: "biorxiv-ecology", name: "bioRxiv", section: "Ecology", feedUrl: rxiv("biorxiv", "ecology"), siteUrl: "https://www.biorxiv.org/collection/ecology", category: "ecology", region: "Global", tier: 3 },
  { id: "biorxiv-evo", name: "bioRxiv", section: "Evolutionary biology", feedUrl: rxiv("biorxiv", "evolutionary_biology"), siteUrl: "https://www.biorxiv.org/collection/evolutionary-biology", category: "ecology", region: "Global", tier: 3 },

  // Medicine and public health
  { id: "nejm", name: "The New England Journal of Medicine", feedUrl: "https://www.nejm.org/action/showFeed?jc=nejm&type=etoc&feed=rss", siteUrl: "https://www.nejm.org", category: "medicine", region: "US", tier: 3, issn: ["0028-4793", "1533-4406"] },
  { id: "lancet", name: "The Lancet", feedUrl: "https://www.thelancet.com/rssfeed/lancet_online.xml", siteUrl: "https://www.thelancet.com/journals/lancet/home", category: "medicine", region: "UK", tier: 3, issn: ["0140-6736", "1474-547X"] },
  { id: "jama", name: "JAMA", section: "Online first", feedUrl: "https://jamanetwork.com/rss/site_3/onlineFirst_67.xml", siteUrl: "https://jamanetwork.com/journals/jama", category: "medicine", region: "US", tier: 3, issn: ["0098-7484", "1538-3598"] },
  { id: "bmj", name: "The BMJ", feedUrl: "https://www.bmj.com/rss/recent.xml", siteUrl: "https://www.bmj.com", category: "medicine", region: "UK", tier: 3, issn: ["0959-8138", "1756-1833"] },
  { id: "natmed", name: "Nature Medicine", feedUrl: natureFeed("nm"), siteUrl: "https://www.nature.com/nm", category: "medicine", region: "Global", tier: 3, issn: ["1078-8956", "1546-170X"] },
  { id: "plosmed", name: "PLOS Medicine", feedUrl: "https://journals.plos.org/plosmedicine/feed/atom", siteUrl: "https://journals.plos.org/plosmedicine", category: "medicine", region: "Global", tier: 3, issn: ["1549-1277", "1549-1676"] },
  { id: "annalsim", name: "Annals of Internal Medicine", feedUrl: "https://www.acpjournals.org/action/showFeed?type=etoc&feed=rss&jc=aim", siteUrl: "https://www.acpjournals.org/journal/aim", category: "medicine", region: "US", tier: 3, issn: ["0003-4819", "1539-3704"] },
  { id: "medrxiv-epi", name: "medRxiv", section: "Epidemiology", feedUrl: rxiv("medrxiv", "epidemiology"), siteUrl: "https://www.medrxiv.org/collection/epidemiology", category: "medicine", region: "Global", tier: 3 },
  { id: "medrxiv-pubhealth", name: "medRxiv", section: "Public and global health", feedUrl: rxiv("medrxiv", "public_and_global_health"), siteUrl: "https://www.medrxiv.org/collection/public-and-global-health", category: "medicine", region: "Global", tier: 3 },

  // Physics and astronomy
  { id: "prl", name: "Physical Review Letters", feedUrl: "https://feeds.aps.org/rss/recent/prl.xml", siteUrl: "https://journals.aps.org/prl", category: "physics", region: "US", tier: 3, issn: ["0031-9007", "1079-7114"] },
  { id: "natphys", name: "Nature Physics", feedUrl: natureFeed("nphys"), siteUrl: "https://www.nature.com/nphys", category: "physics", region: "Global", tier: 3, issn: ["1745-2473", "1745-2481"] },
  { id: "natastro", name: "Nature Astronomy", feedUrl: natureFeed("natastron"), siteUrl: "https://www.nature.com/natastron", category: "physics", region: "Global", tier: 3, issn: ["2397-3366"] },
  { id: "aps-physics", name: "Physics", section: "APS's magazine", feedUrl: "https://feeds.aps.org/rss/recent/physics.xml", siteUrl: "https://physics.aps.org", category: "physics", region: "US", tier: 3 },
  { id: "arxiv-cond-mat", name: "arXiv", section: "Condensed Matter", feedUrl: arxiv("cond-mat"), siteUrl: "https://arxiv.org/list/cond-mat/recent", category: "physics", region: "Global", tier: 3 },
  { id: "arxiv-hep-th", name: "arXiv", section: "High Energy Physics \u2013 Theory", feedUrl: arxiv("hep-th"), siteUrl: "https://arxiv.org/list/hep-th/recent", category: "physics", region: "Global", tier: 3 },
  { id: "arxiv-gr-qc", name: "arXiv", section: "General Relativity and Quantum Cosmology", feedUrl: arxiv("gr-qc"), siteUrl: "https://arxiv.org/list/gr-qc/recent", category: "physics", region: "Global", tier: 3 },
  { id: "arxiv-soc-ph", name: "arXiv", section: "Physics and Society", feedUrl: arxiv("physics.soc-ph"), siteUrl: "https://arxiv.org/list/physics.soc-ph/recent", category: "physics", region: "Global", tier: 3 },

  // Chemistry and materials
  { id: "jacs", name: "Journal of the American Chemical Society", feedUrl: journal("0002-7863", "Journal of the American Chemical Society"), siteUrl: "https://pubs.acs.org/journal/jacsat", category: "chemistry", region: "US", tier: 3, issn: ["0002-7863", "1520-5126"] },
  { id: "natchem", name: "Nature Chemistry", feedUrl: natureFeed("nchem"), siteUrl: "https://www.nature.com/nchem", category: "chemistry", region: "Global", tier: 3, issn: ["1755-4330", "1755-4349"] },
  { id: "natmater", name: "Nature Materials", feedUrl: natureFeed("nmat"), siteUrl: "https://www.nature.com/nmat", category: "chemistry", region: "Global", tier: 3, issn: ["1476-1122", "1476-4660"] },
  { id: "angewandte", name: "Angewandte Chemie", feedUrl: wiley("15213773"), siteUrl: "https://onlinelibrary.wiley.com/journal/15213773", category: "chemistry", region: "Europe", tier: 3, issn: ["1433-7851", "1521-3773"] },

  // Earth and climate science
  { id: "natclimate", name: "Nature Climate Change", feedUrl: natureFeed("nclimate"), siteUrl: "https://www.nature.com/nclimate", category: "earth", region: "Global", tier: 3, issn: ["1758-678X", "1758-6798"] },
  { id: "natgeosci", name: "Nature Geoscience", feedUrl: natureFeed("ngeo"), siteUrl: "https://www.nature.com/ngeo", category: "earth", region: "Global", tier: 3, issn: ["1752-0894", "1752-0908"] },
  { id: "natsustain", name: "Nature Sustainability", feedUrl: natureFeed("natsustain"), siteUrl: "https://www.nature.com/natsustain", category: "earth", region: "Global", tier: 3, issn: ["2398-9629"] },
  { id: "grl", name: "Geophysical Research Letters", feedUrl: wiley("19448007"), siteUrl: "https://agupubs.onlinelibrary.wiley.com/journal/19448007", category: "earth", region: "Global", tier: 3, issn: ["0094-8276", "1944-8007"] },
  { id: "jclimate", name: "Journal of Climate", feedUrl: journal("0894-8755", "Journal of Climate"), siteUrl: "https://journals.ametsoc.org/view/journals/clim/clim-overview.xml", category: "earth", region: "US", tier: 3, issn: ["0894-8755", "1520-0442"] },

  // Mathematics and statistics
  { id: "annalsmath", name: "Annals of Mathematics", feedUrl: journal("0003-486X", "Annals of Mathematics"), siteUrl: "https://annals.math.princeton.edu", category: "mathematics", region: "US", tier: 3, issn: ["0003-486X", "1939-8980"] },
  { id: "jams", name: "Journal of the American Mathematical Society", feedUrl: journal("0894-0347", "Journal of the American Mathematical Society"), siteUrl: "https://www.ams.org/journals/jams", category: "mathematics", region: "US", tier: 3, issn: ["0894-0347", "1088-6834"] },
  { id: "inventiones", name: "Inventiones mathematicae", feedUrl: journal("0020-9910", "Inventiones mathematicae"), siteUrl: "https://link.springer.com/journal/222", category: "mathematics", region: "Global", tier: 3, issn: ["0020-9910", "1432-1297"] },
  { id: "annalsstats", name: "The Annals of Statistics", feedUrl: journal("0090-5364", "The Annals of Statistics"), siteUrl: "https://imstat.org/journals-and-publications/annals-of-statistics", category: "mathematics", region: "US", tier: 3, issn: ["0090-5364", "2168-8966"] },
  { id: "jasa", name: "Journal of the American Statistical Association", feedUrl: tandf("uasa20"), siteUrl: "https://www.tandfonline.com/journals/uasa20", category: "mathematics", region: "US", tier: 3, issn: ["0162-1459", "1537-274X"] },
  { id: "arxiv-math-pr", name: "arXiv", section: "Probability", feedUrl: arxiv("math.PR"), siteUrl: "https://arxiv.org/list/math.PR/recent", category: "mathematics", region: "Global", tier: 3 },
  { id: "arxiv-math-nt", name: "arXiv", section: "Number Theory", feedUrl: arxiv("math.NT"), siteUrl: "https://arxiv.org/list/math.NT/recent", category: "mathematics", region: "Global", tier: 3 },
  { id: "arxiv-stat-me", name: "arXiv", section: "Statistical Methodology", feedUrl: arxiv("stat.ME"), siteUrl: "https://arxiv.org/list/stat.ME/recent", category: "mathematics", region: "Global", tier: 3 },

  // Computer science
  { id: "cacm", name: "Communications of the ACM", feedUrl: journal("0001-0782", "Communications of the ACM"), siteUrl: "https://cacm.acm.org", category: "computing", region: "US", tier: 3, issn: ["0001-0782", "1557-7317"] },
  { id: "natmachintell", name: "Nature Machine Intelligence", feedUrl: natureFeed("natmachintell"), siteUrl: "https://www.nature.com/natmachintell", category: "computing", region: "Global", tier: 3, issn: ["2522-5839"] },
  { id: "arxiv-cs-cr", name: "arXiv", section: "Cryptography and Security", feedUrl: arxiv("cs.CR"), siteUrl: "https://arxiv.org/list/cs.CR/recent", category: "computing", region: "Global", tier: 3 },
  { id: "arxiv-cs-hc", name: "arXiv", section: "Human-Computer Interaction", feedUrl: arxiv("cs.HC"), siteUrl: "https://arxiv.org/list/cs.HC/recent", category: "computing", region: "Global", tier: 3 },
  { id: "arxiv-cs-ds", name: "arXiv", section: "Data Structures and Algorithms", feedUrl: arxiv("cs.DS"), siteUrl: "https://arxiv.org/list/cs.DS/recent", category: "computing", region: "Global", tier: 3 },

  // General science
  { id: "sciadv", name: "Science Advances", feedUrl: "https://www.science.org/action/showFeed?type=etoc&feed=rss&jc=sciadv", siteUrl: "https://www.science.org/journal/sciadv", category: "research", region: "US", tier: 3, issn: ["2375-2548"] },
];
/* eslint-enable prettier/prettier */

/**
 * Subreddits carried as sources, and — for those marked `panel` — read for
 * engagement. A subreddit's `top` feed for the day is itself a ranking: the
 * community's own verdict on what mattered, which is the closest thing to a
 * vote count available without Reddit's JSON API (blocked from serverless).
 */
export type SubredditEntry = {
  name: string;
  label: string;
  category: OutletCategory;
  /** How much this community's attention says about general importance. */
  weight: 1 | 2 | 3;
  panel?: boolean;
};

export const SUBREDDITS: SubredditEntry[] = [
  { name: "news", label: "r/news", category: "general", weight: 1, panel: true },
  { name: "worldnews", label: "r/worldnews", category: "world", weight: 1, panel: true },
  { name: "politics", label: "r/politics", category: "politics", weight: 1, panel: true },
  { name: "inthenews", label: "r/inthenews", category: "general", weight: 3 },
  { name: "nottheonion", label: "r/nottheonion", category: "general", weight: 3, panel: true },
  { name: "upliftingnews", label: "r/UpliftingNews", category: "general", weight: 3 },
  { name: "geopolitics", label: "r/geopolitics", category: "world", weight: 2, panel: true },
  { name: "europe", label: "r/europe", category: "world", weight: 2, panel: true },
  { name: "ukraine", label: "r/ukraine", category: "world", weight: 3 },
  { name: "unitedkingdom", label: "r/unitedkingdom", category: "world", weight: 3 },
  { name: "canada", label: "r/canada", category: "world", weight: 3 },
  { name: "australia", label: "r/australia", category: "world", weight: 3 },
  { name: "india", label: "r/india", category: "world", weight: 3 },
  { name: "china", label: "r/China", category: "world", weight: 3 },
  { name: "economics", label: "r/Economics", category: "business", weight: 2, panel: true },
  { name: "business", label: "r/business", category: "business", weight: 3 },
  { name: "finance", label: "r/finance", category: "business", weight: 3 },
  { name: "investing", label: "r/investing", category: "business", weight: 2, panel: true },
  { name: "stocks", label: "r/stocks", category: "business", weight: 3 },
  { name: "wallstreetbets", label: "r/wallstreetbets", category: "business", weight: 3 },
  { name: "technology", label: "r/technology", category: "tech", weight: 1, panel: true },
  { name: "programming", label: "r/programming", category: "tech", weight: 2, panel: true },
  { name: "MachineLearning", label: "r/MachineLearning", category: "tech", weight: 2, panel: true },
  { name: "artificial", label: "r/artificial", category: "tech", weight: 3 },
  { name: "LocalLLaMA", label: "r/LocalLLaMA", category: "tech", weight: 3 },
  { name: "singularity", label: "r/singularity", category: "tech", weight: 3 },
  { name: "cybersecurity", label: "r/cybersecurity", category: "tech", weight: 3, panel: true },
  { name: "netsec", label: "r/netsec", category: "tech", weight: 3 },
  { name: "gadgets", label: "r/gadgets", category: "tech", weight: 3 },
  { name: "apple", label: "r/apple", category: "tech", weight: 3 },
  { name: "android", label: "r/Android", category: "tech", weight: 3 },
  { name: "science", label: "r/science", category: "science", weight: 1, panel: true },
  { name: "EverythingScience", label: "r/EverythingScience", category: "science", weight: 3 },
  { name: "space", label: "r/space", category: "science", weight: 2, panel: true },
  { name: "askscience", label: "r/askscience", category: "science", weight: 3 },
  { name: "medicine", label: "r/medicine", category: "health", weight: 3 },
  { name: "health", label: "r/Health", category: "health", weight: 3 },
  { name: "climate", label: "r/climate", category: "climate", weight: 3, panel: true },
  { name: "energy", label: "r/energy", category: "climate", weight: 3 },
  { name: "environment", label: "r/environment", category: "climate", weight: 3 },
  { name: "law", label: "r/law", category: "law", weight: 2, panel: true },
  { name: "scotus", label: "r/scotus", category: "law", weight: 3 },
  { name: "supremecourt", label: "r/supremecourt", category: "law", weight: 3 },
  { name: "movies", label: "r/movies", category: "culture", weight: 3 },
  { name: "television", label: "r/television", category: "culture", weight: 3 },
  { name: "music", label: "r/Music", category: "culture", weight: 3 },
  { name: "books", label: "r/books", category: "culture", weight: 3 },
  { name: "games", label: "r/Games", category: "culture", weight: 3 },
  { name: "sports", label: "r/sports", category: "sports", weight: 3 },
  { name: "nba", label: "r/nba", category: "sports", weight: 3 },
  { name: "nfl", label: "r/nfl", category: "sports", weight: 3 },
  { name: "soccer", label: "r/soccer", category: "sports", weight: 3 },
  { name: "formula1", label: "r/formula1", category: "sports", weight: 3 },
  { name: "baseball", label: "r/baseball", category: "sports", weight: 3 },
  { name: "hockey", label: "r/hockey", category: "sports", weight: 3 },
  { name: "dataisbeautiful", label: "r/dataisbeautiful", category: "science", weight: 3 },
  { name: "todayilearned", label: "r/todayilearned", category: "general", weight: 3 },
  { name: "futurology", label: "r/Futurology", category: "tech", weight: 3 },
];

/**
 * Feeds this directory used to list that were measured dead or frozen on
 * 12 Oct 2026, each with the entry that replaced it. A source saved from the
 * old entry is rewritten to the new one when a device loads its list
 * (lib/publishers.ts, `repairSources`) — by exact address only, so nothing
 * that still answers is touched. CNN World has no replacement on purpose: no
 * route answers for the section alone, and the whole of CNN in its place would
 * be a section silently becoming the paper (docs/COLLECTION.md §3).
 */
export const RETIRED_FEEDS: Record<string, string> = {
  "http://rss.cnn.com/rss/cnn_topstories.rss": "cnn-top",
  "https://www.telegraph.co.uk/rss.xml": "telegraph",
  "https://www.timesofisrael.com/feed/": "timesofisrael",
  "https://www.jpost.com/rss/rssfeedsheadlines.aspx": "jpost",
  "https://kyivindependent.com/feed/": "kyivindependent",
  "https://feeds.content.dowjones.io/public/rss/RSSBarronsRealTime": "barrons",
  "https://www.bleepingcomputer.com/feed/": "bleepingcomputer",
  "https://tools.cdc.gov/api/v2/resources/media/404952.rss": "cdc-newsroom",
  "https://www.lawfaremedia.org/feeds/articles.rss": "lawfare",
  "https://www.abajournal.com/feed": "abajournal",
  "https://www.canarymedia.com/articles/feed": "canarymedia",
  "https://www.espn.com/espn/rss/news": "espn",
  "https://www.sfchronicle.com/rss/feed/Bay-Area-News-429.php": "sfchronicle",
  "https://www.chicagotribune.com/feed/": "chicagotribune",
  "https://www.bostonglobe.com/rss/bigstory": "bostonglobe",
  "https://www.miamiherald.com/news/local/?widgetName=rssfeed&widgetContentId=712015&getXmlFeed=true": "miamiherald",
  "https://www.dallasnews.com/arc/outboundfeeds/rss/": "dallasnews",
  "https://www.denverpost.com/feed/": "denverpost",
  "https://www.ajc.com/arcio/rss/": "ajc",
  "https://www.inquirer.com/arc/outboundfeeds/rss/": "inquirer",
  "https://rssfeeds.azcentral.com/phoenix/local": "azcentral",
  // arXiv read `cat:astro-ph` as the archive's pre-2009 filings: newest paper 2019.
  "api:arxiv?q=cat%3Aastro-ph": "arxiv-astro-ph",
  // OpenAlex dates these only by the year, which hid that week's papers.
  "api:journal?issn=0022-362X&name=The+Journal+of+Philosophy": "jphil",
  "api:journal?issn=2330-4014&name=Ergo": "ergo",
};

/** Ready-made bundles, so a reader can follow a beat in one tap. */
export const PACKS: { id: string; name: string; blurb: string; outlets: string[]; subreddits?: string[] }[] = [
  { id: "front-pages", name: "Front pages", blurb: "What the big newsrooms are leading with today.", outlets: ["ap-wire", "nyt-home", "wapo-national", "wsj-world", "bbc-top", "guardian-front", "npr-news", "aljazeera", "cnn-top", "nbc-news"] },
  { id: "us-politics", name: "U.S. politics", blurb: "Washington from several directions at once.", outlets: ["politico", "thehill", "npr-politics", "nyt-politics", "wapo-politics", "axios", "nationalreview", "motherjones", "thedispatch"], subreddits: ["politics"] },
  { id: "markets", name: "Markets & business", blurb: "Markets, earnings and the economy.", outlets: ["wsj-markets", "ft-home", "cnbc-top", "bloomberg-markets", "marketwatch", "businessinsider", "economist"], subreddits: ["Economics", "investing"] },
  { id: "tech", name: "Technology", blurb: "The industry, its politics and its hardware.", outlets: ["verge", "arstechnica", "techcrunch", "wired", "404media", "techmeme", "hn-frontpage", "bloomberg-tech"], subreddits: ["technology", "programming"] },
  { id: "ai", name: "AI", blurb: "Labs, research and the argument about all of it.", outlets: ["mittr", "simonwillison", "openai-blog", "googleblog-ai", "stratechery"], subreddits: ["MachineLearning", "LocalLLaMA", "artificial"] },
  { id: "world", name: "World", blurb: "Newsrooms reporting from where the story is.", outlets: ["aljazeera", "bbc-world", "guardian-world", "dw", "france24", "scmp", "timesofisrael", "kyivindependent", "nyt-world"], subreddits: ["worldnews", "geopolitics"] },
  { id: "science", name: "Science", blurb: "The journals and the people who read them for you.", outlets: ["nature-news", "science-news", "quanta", "sciencenews", "physorg", "nasa"], subreddits: ["science", "space"] },
  { id: "law", name: "Law & courts", blurb: "Courts, filings and the people who read them.", outlets: ["scotusblog", "lawfare", "courthousenews", "justice-gov", "federalregister"], subreddits: ["law", "supremecourt"] },
  { id: "climate", name: "Climate & energy", blurb: "The transition, reported by people who cover it daily.", outlets: ["insideclimate", "canarymedia", "heatmap", "grist", "carbonbrief"], subreddits: ["climate"] },
  { id: "investigative", name: "Investigative", blurb: "Long-lead reporting and document work.", outlets: ["propublica", "marshallproject", "bellingcat", "icij", "intercept"] },
  { id: "health", name: "Health", blurb: "Medicine, public health and the money in both.", outlets: ["statnews", "kffhealth", "cdc-newsroom"], subreddits: ["medicine"] },
  { id: "culture", name: "Culture", blurb: "Film, music and television.", outlets: ["variety", "hollywoodreporter", "deadline", "pitchfork", "rollingstone"], subreddits: ["movies", "television"] },
  { id: "neuroscience", name: "Neuroscience", blurb: "The journals, the preprints and the people who report on both.", outlets: ["nature-neuro", "neuron", "jneurosci", "elife-neuro", "tics", "biorxiv-neuro", "arxiv-qbio-nc", "transmitter"] },
  { id: "philosophy", name: "Philosophy", blurb: "The journals, the encyclopedia and the profession's own news.", outlets: ["sep", "dailynous", "nous", "ppr", "mind", "philreview", "philstudies", "aeon"] },
  { id: "ai-papers", name: "AI papers", blurb: "New arXiv submissions in AI, machine learning and language.", outlets: ["arxiv-cs-ai", "arxiv-cs-lg", "arxiv-cs-cl", "arxiv-stat-ml"] },
  { id: "journals", name: "Flagship journals", blurb: "The general science journals, as they publish.", outlets: ["nature-news", "science-journal", "pnas", "cell", "elife", "plos-biology"] },
];

/**
 * The directory entry that means a bare domain.
 *
 * The directory already holds a verified feed for every outlet in it — it is
 * audited by `/api/outlets/audit`, and the panel is swept every run — but
 * discovery never consulted it, so pasting `cnbc.com` went off to crawl a
 * site that publishes its RSS through a search endpoint no amount of looking
 * at the HTML will find.
 *
 * A front-page entry is preferred, then the lowest tier, then whichever entry
 * carries no section: a bare domain means the newsroom, not one of its desks.
 */
export function frontOutletForHost(host: string): Outlet | null {
  const wanted = host.replace(/^www\./, "").toLowerCase();
  if (!wanted) return null;

  const matches = OUTLETS.filter((outlet) => {
    // Research is found by its own rung (lib/scholarly.ts); some of it is not a feed at all.
    if (isResearchCategory(outlet.category)) return false;
    let outletHost: string;
    try {
      outletHost = new URL(outlet.siteUrl).hostname.replace(/^www\./, "").toLowerCase();
    } catch {
      return false;
    }
    return outletHost === wanted;
  });
  if (matches.length === 0) return null;

  return [...matches].sort((a, b) => {
    const front = Number(Boolean(b.front)) - Number(Boolean(a.front));
    if (front !== 0) return front;
    if (a.tier !== b.tier) return a.tier - b.tier;
    return Number(Boolean(a.section)) - Number(Boolean(b.section));
  })[0];
}

export function outletById(id: string) {
  return OUTLETS.find((outlet) => outlet.id === id);
}

/** The outlets swept into the corpus that ranking is measured against. */
export function panelOutlets() {
  return OUTLETS.filter((outlet) => outlet.panel);
}

export function panelSubreddits() {
  return SUBREDDITS.filter((entry) => entry.panel);
}

/** How much one outlet's attention counts toward a story's breadth. */
export function tierWeight(tier: 1 | 2 | 3) {
  return tier === 1 ? 1 : tier === 2 ? 0.65 : 0.4;
}

export function outletsByCategory() {
  const groups = new Map<OutletCategory, Outlet[]>();
  for (const outlet of OUTLETS) {
    const bucket = groups.get(outlet.category) ?? [];
    bucket.push(outlet);
    groups.set(outlet.category, bucket);
  }
  return groups;
}
