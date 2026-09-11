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
  | "aggregator";

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
};

/* eslint-disable prettier/prettier */
export const OUTLETS: Outlet[] = [
  // ---- Wires and agenda-setting general news (tier 1, the ranking panel) --
  { id: "ap-top", name: "Associated Press", section: "Top news", feedUrl: "https://apnews.com/index.rss", siteUrl: "https://apnews.com", category: "general", region: "US", tier: 1, panel: true, front: true },
  { id: "reuters-top", name: "Reuters", section: "Top news", feedUrl: "https://www.reutersagency.com/feed/?best-topics=top-news&post_type=best", siteUrl: "https://www.reuters.com", category: "general", region: "Global", tier: 1, panel: true, front: true },
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
  { id: "cnn-top", name: "CNN", section: "Top stories", feedUrl: "http://rss.cnn.com/rss/cnn_topstories.rss", siteUrl: "https://www.cnn.com", category: "general", region: "US", tier: 1, panel: true, front: true },
  { id: "cnn-world", name: "CNN", section: "World", feedUrl: "http://rss.cnn.com/rss/cnn_world.rss", siteUrl: "https://www.cnn.com/world", category: "world", region: "US", tier: 1, panel: true },
  { id: "nbc-news", name: "NBC News", section: "Top stories", feedUrl: "https://feeds.nbcnews.com/nbcnews/public/news", siteUrl: "https://www.nbcnews.com", category: "general", region: "US", tier: 1, panel: true, front: true },
  { id: "cbs-news", name: "CBS News", section: "Top stories", feedUrl: "https://www.cbsnews.com/latest/rss/main", siteUrl: "https://www.cbsnews.com", category: "general", region: "US", tier: 1, panel: true, front: true },
  { id: "abc-news", name: "ABC News", section: "Top stories", feedUrl: "https://abcnews.go.com/abcnews/topstories", siteUrl: "https://abcnews.go.com", category: "general", region: "US", tier: 1, panel: true, front: true },
  { id: "fox-news", name: "Fox News", section: "Latest", feedUrl: "https://moxie.foxnews.com/google-publisher/latest.xml", siteUrl: "https://www.foxnews.com", category: "general", region: "US", tier: 1, panel: true, front: true },
  { id: "usatoday", name: "USA Today", section: "Top stories", feedUrl: "https://rssfeeds.usatoday.com/usatoday-newstopstories", siteUrl: "https://www.usatoday.com", category: "general", region: "US", tier: 1, panel: true, front: true },
  { id: "latimes", name: "Los Angeles Times", section: "Top stories", feedUrl: "https://www.latimes.com/rss2.0.xml", siteUrl: "https://www.latimes.com", category: "general", region: "US", tier: 1, panel: true, front: true },
  { id: "politico", name: "Politico", section: "Politics", feedUrl: "https://rss.politico.com/politics-news.xml", siteUrl: "https://www.politico.com", category: "politics", region: "US", tier: 1, panel: true },
  { id: "thehill", name: "The Hill", section: "News", feedUrl: "https://thehill.com/news/feed/", siteUrl: "https://thehill.com", category: "politics", region: "US", tier: 2, panel: true },
  { id: "axios", name: "Axios", section: "All", feedUrl: "https://api.axios.com/feed/", siteUrl: "https://www.axios.com", category: "general", region: "US", tier: 2, panel: true, front: true },
  { id: "semafor", name: "Semafor", section: "All", feedUrl: "https://www.semafor.com/rss.xml", siteUrl: "https://www.semafor.com", category: "general", region: "US", tier: 2 },
  { id: "newsweek", name: "Newsweek", section: "Latest", feedUrl: "https://www.newsweek.com/rss", siteUrl: "https://www.newsweek.com", category: "general", region: "US", tier: 2, panel: true },
  { id: "time", name: "TIME", section: "Latest", feedUrl: "https://time.com/feed/", siteUrl: "https://time.com", category: "general", region: "US", tier: 2, panel: true },
  { id: "pbs-newshour", name: "PBS NewsHour", section: "All", feedUrl: "https://www.pbs.org/newshour/feeds/rss/headlines", siteUrl: "https://www.pbs.org/newshour", category: "general", region: "US", tier: 2, panel: true, front: true },
  { id: "voa", name: "Voice of America", section: "All", feedUrl: "https://www.voanews.com/api/zq$omekvi_", siteUrl: "https://www.voanews.com", category: "world", region: "US", tier: 3 },

  // ---- World and regional --------------------------------------------------
  { id: "dw", name: "Deutsche Welle", section: "All", feedUrl: "https://rss.dw.com/rdf/rss-en-all", siteUrl: "https://www.dw.com/en", category: "world", region: "Europe", tier: 2, panel: true },
  { id: "france24", name: "France 24", section: "All", feedUrl: "https://www.france24.com/en/rss", siteUrl: "https://www.france24.com/en", category: "world", region: "Europe", tier: 2, panel: true },
  { id: "euronews", name: "Euronews", section: "All", feedUrl: "https://www.euronews.com/rss", siteUrl: "https://www.euronews.com", category: "world", region: "Europe", tier: 2 },
  { id: "skynews", name: "Sky News", section: "Home", feedUrl: "https://feeds.skynews.com/feeds/rss/home.xml", siteUrl: "https://news.sky.com", category: "general", region: "UK", tier: 2, panel: true, front: true },
  { id: "independent", name: "The Independent", section: "UK news", feedUrl: "https://www.independent.co.uk/news/uk/rss", siteUrl: "https://www.independent.co.uk", category: "general", region: "UK", tier: 2 },
  { id: "telegraph", name: "The Telegraph", section: "All", feedUrl: "https://www.telegraph.co.uk/rss.xml", siteUrl: "https://www.telegraph.co.uk", category: "general", region: "UK", tier: 2 },
  { id: "cbc", name: "CBC News", section: "Top stories", feedUrl: "https://www.cbc.ca/webfeed/rss/rss-topstories", siteUrl: "https://www.cbc.ca/news", category: "general", region: "Canada", tier: 2, panel: true, front: true },
  { id: "globeandmail", name: "The Globe and Mail", section: "Canada", feedUrl: "https://www.theglobeandmail.com/arc/outboundfeeds/rss/category/canada/", siteUrl: "https://www.theglobeandmail.com", category: "general", region: "Canada", tier: 2 },
  { id: "abc-au", name: "ABC (Australia)", section: "Top stories", feedUrl: "https://www.abc.net.au/news/feed/51120/rss.xml", siteUrl: "https://www.abc.net.au/news", category: "general", region: "Australia", tier: 2, panel: true, front: true },
  { id: "smh", name: "Sydney Morning Herald", section: "All", feedUrl: "https://www.smh.com.au/rss/feed.xml", siteUrl: "https://www.smh.com.au", category: "general", region: "Australia", tier: 2 },
  { id: "scmp", name: "South China Morning Post", section: "All", feedUrl: "https://www.scmp.com/rss/91/feed", siteUrl: "https://www.scmp.com", category: "world", region: "Asia", tier: 2, panel: true },
  { id: "japantimes", name: "The Japan Times", section: "All", feedUrl: "https://www.japantimes.co.jp/feed/", siteUrl: "https://www.japantimes.co.jp", category: "world", region: "Asia", tier: 2 },
  { id: "toi", name: "Times of India", section: "Top stories", feedUrl: "https://timesofindia.indiatimes.com/rssfeedstopstories.cms", siteUrl: "https://timesofindia.indiatimes.com", category: "general", region: "Asia", tier: 2, panel: true, front: true },
  { id: "thehindu", name: "The Hindu", section: "National", feedUrl: "https://www.thehindu.com/news/national/feeder/default.rss", siteUrl: "https://www.thehindu.com", category: "general", region: "Asia", tier: 2 },
  { id: "straitstimes", name: "The Straits Times", section: "World", feedUrl: "https://www.straitstimes.com/news/world/rss.xml", siteUrl: "https://www.straitstimes.com", category: "world", region: "Asia", tier: 3 },
  { id: "timesofisrael", name: "The Times of Israel", section: "All", feedUrl: "https://www.timesofisrael.com/feed/", siteUrl: "https://www.timesofisrael.com", category: "world", region: "Middle East", tier: 2 },
  { id: "jpost", name: "The Jerusalem Post", section: "Headlines", feedUrl: "https://www.jpost.com/rss/rssfeedsheadlines.aspx", siteUrl: "https://www.jpost.com", category: "world", region: "Middle East", tier: 3 },
  { id: "kyivindependent", name: "The Kyiv Independent", section: "All", feedUrl: "https://kyivindependent.com/feed/", siteUrl: "https://kyivindependent.com", category: "world", region: "Europe", tier: 3 },
  { id: "moscowtimes", name: "The Moscow Times", section: "News", feedUrl: "https://www.themoscowtimes.com/rss/news", siteUrl: "https://www.themoscowtimes.com", category: "world", region: "Europe", tier: 3 },
  { id: "allafrica", name: "AllAfrica", section: "Latest", feedUrl: "https://allafrica.com/tools/headlines/rdf/latest/headlines.rdf", siteUrl: "https://allafrica.com", category: "world", region: "Africa", tier: 3 },
  { id: "batimes", name: "Buenos Aires Times", section: "All", feedUrl: "https://www.batimes.com.ar/feed", siteUrl: "https://www.batimes.com.ar", category: "world", region: "Americas", tier: 3 },

  // ---- Business and markets ------------------------------------------------
  { id: "cnbc-top", name: "CNBC", section: "Top news", feedUrl: "https://search.cnbc.com/rs/search/combinedcms/view.xml?partnerId=wrss01&id=100003114", siteUrl: "https://www.cnbc.com", category: "business", region: "US", tier: 1, panel: true, front: true },
  { id: "marketwatch", name: "MarketWatch", section: "Top stories", feedUrl: "https://feeds.content.dowjones.io/public/rss/mw_topstories", siteUrl: "https://www.marketwatch.com", category: "business", region: "US", tier: 2, panel: true, front: true },
  { id: "barrons", name: "Barron's", section: "Real time", feedUrl: "https://feeds.content.dowjones.io/public/rss/RSSBarronsRealTime", siteUrl: "https://www.barrons.com", category: "business", region: "US", tier: 2 },
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
  { id: "engadget", name: "Engadget", section: "All", feedUrl: "https://www.engadget.com/rss.xml", siteUrl: "https://www.engadget.com", category: "tech", region: "US", tier: 3 },
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
  { id: "bleepingcomputer", name: "BleepingComputer", section: "All", feedUrl: "https://www.bleepingcomputer.com/feed/", siteUrl: "https://www.bleepingcomputer.com", category: "tech", region: "US", tier: 3 },

  // ---- Science and health --------------------------------------------------
  { id: "nature-news", name: "Nature", section: "News", feedUrl: "https://www.nature.com/nature.rss", siteUrl: "https://www.nature.com", category: "science", region: "Global", tier: 2, panel: true },
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
  { id: "cdc-newsroom", name: "CDC", section: "Newsroom", feedUrl: "https://tools.cdc.gov/api/v2/resources/media/404952.rss", siteUrl: "https://www.cdc.gov/media", category: "health", region: "US", tier: 3 },

  // ---- Law, policy and courts ---------------------------------------------
  { id: "scotusblog", name: "SCOTUSblog", section: "All", feedUrl: "https://www.scotusblog.com/feed/", siteUrl: "https://www.scotusblog.com", category: "law", region: "US", tier: 3, panel: true },
  { id: "lawfare", name: "Lawfare", section: "All", feedUrl: "https://www.lawfaremedia.org/feeds/articles.rss", siteUrl: "https://www.lawfaremedia.org", category: "law", region: "US", tier: 3 },
  { id: "courthousenews", name: "Courthouse News", section: "All", feedUrl: "https://www.courthousenews.com/feed/", siteUrl: "https://www.courthousenews.com", category: "law", region: "US", tier: 3 },
  { id: "abajournal", name: "ABA Journal", section: "All", feedUrl: "https://www.abajournal.com/feed", siteUrl: "https://www.abajournal.com", category: "law", region: "US", tier: 3 },
  { id: "justice-gov", name: "U.S. Justice Department", section: "Press releases", feedUrl: "https://www.justice.gov/news/rss", siteUrl: "https://www.justice.gov/news", category: "law", region: "US", tier: 3 },
  { id: "federalregister", name: "Federal Register", section: "Documents", feedUrl: "https://www.federalregister.gov/api/v1/articles.rss", siteUrl: "https://www.federalregister.gov", category: "law", region: "US", tier: 3 },
  { id: "sec-litigation", name: "SEC", section: "Litigation", feedUrl: "https://www.sec.gov/rss/litigation/litreleases.xml", siteUrl: "https://www.sec.gov", category: "law", region: "US", tier: 3 },

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
  { id: "canarymedia", name: "Canary Media", section: "All", feedUrl: "https://www.canarymedia.com/articles/feed", siteUrl: "https://www.canarymedia.com", category: "climate", region: "US", tier: 3 },
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
  { id: "espn", name: "ESPN", section: "Top news", feedUrl: "https://www.espn.com/espn/rss/news", siteUrl: "https://www.espn.com", category: "sports", region: "US", tier: 2, front: true },
  { id: "bbc-sport", name: "BBC Sport", section: "All", feedUrl: "https://feeds.bbci.co.uk/sport/rss.xml", siteUrl: "https://www.bbc.com/sport", category: "sports", region: "UK", tier: 2 },
  { id: "skysports", name: "Sky Sports", section: "All", feedUrl: "https://www.skysports.com/rss/12040", siteUrl: "https://www.skysports.com", category: "sports", region: "UK", tier: 3 },

  // ---- Major US metros -----------------------------------------------------
  { id: "sfchronicle", name: "San Francisco Chronicle", section: "All", feedUrl: "https://www.sfchronicle.com/rss/feed/Bay-Area-News-429.php", siteUrl: "https://www.sfchronicle.com", category: "local", region: "US", tier: 3 },
  { id: "chicagotribune", name: "Chicago Tribune", section: "All", feedUrl: "https://www.chicagotribune.com/feed/", siteUrl: "https://www.chicagotribune.com", category: "local", region: "US", tier: 3 },
  { id: "bostonglobe", name: "The Boston Globe", section: "All", feedUrl: "https://www.bostonglobe.com/rss/bigstory", siteUrl: "https://www.bostonglobe.com", category: "local", region: "US", tier: 3 },
  { id: "seattletimes", name: "The Seattle Times", section: "All", feedUrl: "https://www.seattletimes.com/feed/", siteUrl: "https://www.seattletimes.com", category: "local", region: "US", tier: 3 },
  { id: "miamiherald", name: "Miami Herald", section: "All", feedUrl: "https://www.miamiherald.com/news/local/?widgetName=rssfeed&widgetContentId=712015&getXmlFeed=true", siteUrl: "https://www.miamiherald.com", category: "local", region: "US", tier: 3 },
  { id: "dallasnews", name: "The Dallas Morning News", section: "All", feedUrl: "https://www.dallasnews.com/arc/outboundfeeds/rss/", siteUrl: "https://www.dallasnews.com", category: "local", region: "US", tier: 3 },
  { id: "denverpost", name: "The Denver Post", section: "All", feedUrl: "https://www.denverpost.com/feed/", siteUrl: "https://www.denverpost.com", category: "local", region: "US", tier: 3 },
  { id: "startribune", name: "Star Tribune", section: "All", feedUrl: "https://www.startribune.com/local/index.rss2", siteUrl: "https://www.startribune.com", category: "local", region: "US", tier: 3 },
  { id: "ajc", name: "The Atlanta Journal-Constitution", section: "All", feedUrl: "https://www.ajc.com/arcio/rss/", siteUrl: "https://www.ajc.com", category: "local", region: "US", tier: 3 },
  { id: "inquirer", name: "The Philadelphia Inquirer", section: "All", feedUrl: "https://www.inquirer.com/arc/outboundfeeds/rss/", siteUrl: "https://www.inquirer.com", category: "local", region: "US", tier: 3 },
  { id: "oregonian", name: "The Oregonian", section: "All", feedUrl: "https://www.oregonlive.com/arc/outboundfeeds/rss/", siteUrl: "https://www.oregonlive.com", category: "local", region: "US", tier: 3 },
  { id: "azcentral", name: "The Arizona Republic", section: "All", feedUrl: "https://rssfeeds.azcentral.com/phoenix/local", siteUrl: "https://www.azcentral.com", category: "local", region: "US", tier: 3 },
  { id: "nevadaindependent", name: "The Nevada Independent", section: "All", feedUrl: "https://thenevadaindependent.com/feed", siteUrl: "https://thenevadaindependent.com", category: "local", region: "US", tier: 3 },
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

/** Ready-made bundles, so a reader can follow a beat in one tap. */
export const PACKS: { id: string; name: string; blurb: string; outlets: string[]; subreddits?: string[] }[] = [
  { id: "front-pages", name: "Front pages", blurb: "What the big newsrooms are leading with today.", outlets: ["ap-top", "reuters-top", "nyt-home", "wapo-national", "wsj-world", "bbc-top", "guardian-front", "npr-news", "aljazeera"] },
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
];

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
