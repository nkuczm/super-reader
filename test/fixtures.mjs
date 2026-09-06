import http from "node:http";

const rss = `<?xml version="1.0"?><rss version="2.0" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:content="http://purl.org/rss/1.0/modules/content/" xmlns:media="http://search.yahoo.com/mrss/">
<channel><title>Example Blog</title><link>http://127.0.0.1:8781</link><description>A test blog</description>
<item><title>Hello &amp; welcome</title><link>/posts/1</link><guid>p1</guid><dc:creator>Ada</dc:creator>
<pubDate>Tue, 02 Sep 2025 10:00:00 GMT</pubDate>
<content:encoded><![CDATA[<p>First <b>post</b> body.</p><img src="/img/a.png">]]></content:encoded></item>
<item><title>Second post</title><link>http://127.0.0.1:8781/posts/2</link><guid>p2</guid>
<pubDate>Mon, 01 Sep 2025 10:00:00 GMT</pubDate><description>Short summary here.</description>
<enclosure url="http://cdn/x.jpg" type="image/jpeg"/></item>
<item><title>Ben&amp;#8217;s take on AI &amp;#038; chips</title><link>/posts/3</link><guid>p3</guid>
<pubDate>Sun, 31 Aug 2025 10:00:00 GMT</pubDate>
<description>It&amp;#8217;s a test &amp;#8212; really&amp;#8230;</description>
<enclosure url="http://cdn/i.jpg?w=10&amp;#038;ssl=1" type="image/jpeg"/></item>
<item><title>Post with a tracking pixel only</title><link>/posts/4</link><guid>p4</guid>
<pubDate>Sat, 30 Aug 2025 10:00:00 GMT</pubDate>
<description>&lt;p&gt;Body text.&lt;/p&gt;&lt;img src="https://feeds.feedburner.com/~r/pixel.gif" width="1" height="1"&gt;</description></item>
<item><title>Post with media group sizes</title><link>/posts/5</link><guid>p5</guid>
<pubDate>Fri, 29 Aug 2025 10:00:00 GMT</pubDate>
<media:group>
<media:content url="http://cdn/small.jpg" width="320"/>
<media:content url="http://cdn/big.jpg" width="1600"/>
</media:group></item>
</channel></rss>`;

const atom = `<?xml version="1.0" encoding="utf-8"?>
<feed xmlns="http://www.w3.org/2005/Atom"><title>Atom Site</title><subtitle>Sub</subtitle>
<link rel="alternate" href="http://127.0.0.1:8781/atomsite"/>
<entry><title>Atom entry one</title><link rel="alternate" href="/a/1"/><id>tag:a1</id>
<author><name>Grace</name></author><published>2025-09-03T12:00:00Z</published>
<summary>Atom summary text.</summary></entry></feed>`;


// A news index with no feed at all, shaped like a modern JS-framework site:
// nav/footer chrome, cards wrapping a category, date and heading in one <a>.
const newsIndex = `<html><head><title>News \\ Anthropic</title>
<meta property="og:site_name" content="Anthropic">
<meta property="og:description" content="Announcements from Anthropic">
</head><body>
<header><a href="/">Home</a><a href="/pricing">Pricing</a><a href="/careers">Careers</a></header>
<nav><a href="/product">Product</a><a href="/research">Research</a></nav>
<main>
  <a href="/news/claude-opus-5"><div><span>Announcements</span><time datetime="2026-09-02">Sep 2, 2026</time><h3>Introducing Claude Opus 5</h3></div><img src="/img/opus.png"></a>
  <a href="/news/economic-index-update"><div><span>Societal Impacts</span><time datetime="2026-08-28">Aug 28, 2026</time><h3>The Anthropic Economic Index update</h3></div></a>
  <a href="/news/interpretability-progress"><div><span>Research</span><time datetime="2026-08-19">Aug 19, 2026</time><h3>Progress on interpretability research</h3></div></a>
  <a href="/news/enterprise-safeguards"><div><span>Policy</span><time datetime="2026-08-11">Aug 11, 2026</time><h3>Enterprise frontier safeguards</h3></div></a>
  <a href="/news/claude-opus-5">Read more</a>
  <!-- Cards with no heading tag: date and category sit beside the headline,
       exactly as anthropic.com/news renders them. -->
  <a href="/news/watermark-explainer"><div><div>Sep 1, 2026</div><div>Announcements</div><div>How Claude&#8217;s text watermark works</div></div></a>
  <a href="/news/open-weights-position"><div><div>Jul 27, 2026</div><div>Policy</div><div>Our position on open-weights models</div></div></a>
</main>
<footer><a href="/privacy">Privacy</a><a href="/terms">Terms</a><a href="/legal/aup">Usage policy</a></footer>
</body></html>`;

// A page that is not a list of articles at all.
const aboutPage = `<html><head><title>About</title></head><body><main>
<p>We are a company that does things and believes in things.</p>
<a href="/contact-us-today">Contact our team about partnerships</a>
</main></body></html>`;

const routes = {
  "/rss": [200, "application/rss+xml", rss],
  "/atom": [200, "application/atom+xml", atom],
  // Page that declares its feed in <head>.
  "/declared": [200, "text/html",
    `<html><head><link rel="alternate" type="application/rss+xml" href="/rss"></head><body>hi</body></html>`],
  // Page with no declaration; discovery must guess /feed.
  "/silent": [200, "text/html", `<html><body>no feed link</body></html>`],
  "/feed": [200, "application/rss+xml", rss],
};

// A second origin that publishes no feed anywhere — the case this scraper
// exists for. Kept separate so feed discovery cannot short-circuit to /feed.
const article = `<html><head><title>Introducing Claude Opus 5</title>
<meta property="og:site_name" content="Anthropic">
<meta property="og:description" content="Opus 5 is a step change in capability across coding and reasoning.">
<meta property="article:published_time" content="2026-09-02T10:00:00Z">
<meta property="og:image" content="/img/social.png">
</head><body>
<header><a href="/">Home</a></header>
<article>
<h1>Introducing Claude Opus 5</h1>
<p>Opus 5 is a step change in capability across coding, reasoning and long-horizon agentic work. It is available today to all paid plans and through the API.</p>
<p>We measured substantial gains on agentic benchmarks, with the largest improvements on tasks that require many steps of tool use and careful verification of intermediate results.</p>
<blockquote>The model is markedly better at knowing when it does not know.</blockquote>
<p>Read the system card for a full account of evaluations, safety testing and the mitigations we applied before release.</p>
<img src="/img/chart.png" alt="Benchmark chart">
<picture><source srcset="/img/wide-1200.jpg 1200w, /img/wide-600.jpg 600w"><img src="data:image/gif;base64,R0lGODlhAQABAAAAACw=" alt="Wide shot"></picture>
<img src="/img/placeholder.png" data-src="/img/real-photo.jpg" alt="Lazy photo">
<img src="/img/small.jpg" srcset="/img/small.jpg 400w, /img/large.jpg 1600w" alt="Responsive">
<script>window.tracker = 1;</script>
<p onclick="steal()">Availability begins today across every supported region.</p>
<a href="/news/system-card" onclick="evil()">Read the system card</a>
</article>
<footer><a href="/privacy">Privacy</a></footer>
</body></html>`;

const boilerplatePage = `<html><head><title>Interpretability</title>
<meta property="og:description" content="Announcements from Anthropic">
</head><body><article><h1>Progress on interpretability research</h1>
<p>Body text.</p></article></body></html>`;

// A real 1x1 PNG so image-dependent layouts can be measured in tests.
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);

// Mirrors blog.google: a section page that advertises the site-wide feed in
// its <head>, while also exposing its own feed at <section>/rss.
const sectionPage = `<html><head><title>Gemini</title>
<link rel="alternate" type="application/rss+xml" href="/rss">
</head><body><main>
<a href="/topics/gemini/post-one"><h3>A Gemini announcement</h3></a>
<a href="/topics/gemini/post-two"><h3>Another Gemini announcement</h3></a>
<a href="/topics/gemini/post-three"><h3>A third Gemini announcement</h3></a>
</main></body></html>`;

const siteFeed = `<?xml version="1.0"?><rss version="2.0"><channel>
<title>News from Everywhere</title><link>http://127.0.0.1:8784</link>
<item><title>Something about translate</title><link>/x/translate</link><guid>s1</guid>
<pubDate>Thu, 04 Sep 2025 10:00:00 GMT</pubDate></item>
<item><title>Something about education</title><link>/x/education</link><guid>s2</guid>
<pubDate>Wed, 03 Sep 2025 10:00:00 GMT</pubDate></item>
</channel></rss>`;

const sectionFeed = `<?xml version="1.0"?><rss version="2.0"><channel>
<title>Gemini</title><link>http://127.0.0.1:8784/topics/gemini</link>
<item><title>A Gemini announcement</title><link>/topics/gemini/post-one</link><guid>g1</guid>
<pubDate>Thu, 04 Sep 2025 12:00:00 GMT</pubDate></item>
<item><title>Another Gemini announcement</title><link>/topics/gemini/post-two</link><guid>g2</guid>
<pubDate>Wed, 03 Sep 2025 12:00:00 GMT</pubDate></item>
</channel></rss>`;

/** A site whose sections have their own feeds. */
export function startSectionSite(port = 8784, { sectionHasFeed = true } = {}) {
  const routes = {
    "/topics/gemini": [200, "text/html", sectionPage],
    "/rss": [200, "application/rss+xml", siteFeed],
  };
  if (sectionHasFeed) {
    routes["/topics/gemini/rss"] = [200, "application/rss+xml", sectionFeed];
  }
  return serve(routes, port);
}

// Mirrors fbi.gov: the HTML homepage is blocked, while /feeds and the feeds
// themselves are served. Feed entries point at a per-feed page, not the XML.
const feedsIndex = `<html><head><title>Feeds</title></head><body><ul>
<li><a href="/feeds/seattle-news">Seattle Tweets</a></li>
<li><a href="/feeds/inside-podcast">Inside the Bureau Podcast</a></li>
<li><a href="/feeds/national-press-releases">National Press Releases</a></li>
<li><a href="/feeds/all-wanted">All Wanted</a></li>
</ul></body></html>`;

const pressFeed = `<?xml version="1.0"?><rss version="2.0"><channel>
<title>National Press Releases</title><link>http://127.0.0.1:8787/news</link>
<item><title>A national press release</title><link>/news/one</link><guid>n1</guid>
<pubDate>Thu, 04 Sep 2025 10:00:00 GMT</pubDate>
<description>&lt;nav&gt;&lt;a&gt;Home&lt;/a&gt;&lt;a&gt;Search&lt;/a&gt;&lt;/nav&gt;&lt;form&gt;&lt;select&gt;&lt;option&gt;All News&lt;/option&gt;&lt;option&gt;Briefings&lt;/option&gt;&lt;/select&gt;&lt;/form&gt;&lt;p&gt;The Department announced today a significant enforcement action against a long running fraud scheme affecting thousands of people.&lt;/p&gt;</description>
</item></channel></rss>`;

const regionalFeed = `<?xml version="1.0"?><rss version="2.0"><channel>
<title>Seattle Tweets</title><link>http://127.0.0.1:8787/seattle</link>
<item><title>A regional note</title><link>/seattle/one</link><guid>s1</guid>
<pubDate>Thu, 04 Sep 2025 09:00:00 GMT</pubDate></item></channel></rss>`;

/** Homepage 403s; everything else works. */
export function startBlockedHomepageSite(port = 8787) {
  const routes = {
    "/feeds": [200, "text/html", feedsIndex],
    "/feeds/national-press-releases/rss.xml": [200, "application/rss+xml", pressFeed],
    "/feeds/seattle-news/rss.xml": [200, "application/rss+xml", regionalFeed],
  };
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      const path = new URL(req.url, "http://x").pathname;
      if (path === "/") { res.writeHead(403); return res.end("Forbidden"); }
      const hit = routes[path];
      if (!hit) { res.writeHead(404); return res.end("nope"); }
      res.writeHead(hit[0], { "content-type": hit[1] });
      res.end(hit[2]);
    });
    server.listen(port, () => resolve({ server, close: () => server.close() }));
  });
}

const fullTextFeed = `<?xml version="1.0"?><rss version="2.0" xmlns:content="http://purl.org/rss/1.0/modules/content/"><channel>
<title>Guarded Wire</title><link>http://127.0.0.1:8789</link>
<item><title>The blocked story</title><link>http://127.0.0.1:8789/story/one</link><guid>b1</guid>
<pubDate>Thu, 04 Sep 2025 10:00:00 GMT</pubDate>
<content:encoded>&lt;nav&gt;&lt;a&gt;Menu&lt;/a&gt;&lt;/nav&gt;&lt;p&gt;${"The publisher syndicates the whole article in its feed, which is why this fallback is fair game: they chose to hand it over. ".repeat(12)}&lt;/p&gt;&lt;img src="/img/photo.jpg"&gt;&lt;script&gt;alert(1)&lt;/script&gt;</content:encoded>
</item>
<item><title>A teaser only</title><link>http://127.0.0.1:8789/story/two</link><guid>b2</guid>
<pubDate>Wed, 03 Sep 2025 10:00:00 GMT</pubDate>
<description>&lt;p&gt;Just a short teaser.&lt;/p&gt;</description>
</item>
</channel></rss>`;

/** Article pages 403, but the feed carries the full text. */
export function startGuardedSite(port = 8789) {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      const path = new URL(req.url, "http://x").pathname;
      if (path === "/rss.xml") {
        res.writeHead(200, { "content-type": "application/rss+xml" });
        return res.end(fullTextFeed);
      }
      res.writeHead(403);
      res.end("Forbidden");
    });
    server.listen(port, () => resolve({ server, close: () => server.close() }));
  });
}

// A site that links its feed with a plain anchor instead of declaring it.
const anchorOnlyPage = `<html><head><title>Acme News</title></head><body>
<main><p>Welcome.</p></main>
<footer><a href="/news/rss.xml">RSS</a></footer></body></html>`;

export function startAnchorFeedSite(port = 8788) {
  return serve(
    {
      "/": [200, "text/html", anchorOnlyPage],
      "/news/rss.xml": [200, "application/rss+xml", pressFeed],
    },
    port,
  );
}

const noFeedRoutes = {
  "/news": [200, "text/html", newsIndex],
  "/about": [200, "text/html", aboutPage],
  "/news/claude-opus-5": [200, "text/html", article],
  "/news/interpretability-progress": [200, "text/html", boilerplatePage],
  "/img/opus.png": [200, "image/png", PNG],
};

/**
 * A short post with a long comment thread under it — the shape that made
 * Readability return a reader's comment as the article. Modelled on the
 * Substack page that did it: a two-sentence note, 1,700 characters of replies.
 */
const shortPostWithComments = `<html><head><title>On AI and "Jagged Intelligence"</title>
<meta property="og:site_name" content="A Newsletter">
<meta property="article:published_time" content="2026-06-09T12:00:00Z"></head><body>
<nav><a href="/">Home</a><a href="/archive">Archive</a></nav>
<article><h1>On AI and "Jagged Intelligence"</h1>
<div class="available-content"><div class="body markup">
<p>I have been working on a few pieces for this newsletter and hope to post them
soon. In the meantime, you might be interested in an article of mine just
published in The Yale Review, titled "Jagged Intelligence".</p>
<p>I would love to hear what you think of it.</p>
</div></div></article>
<div class="single-post-section comments-section" id="substack-comments">
<h3>Comments</h3>
<div class="comment-list post-page-root-comment-list"><div class="comment-list-items">
<div class="comment"><div class="comment-body expanded">
<p>I think we should all agree to switch to using the term complex information
processing (CIP), or perhaps, for a while, "CIP formerly known as AI". This is
such an apt description, and resolves my desire to rename AI in order to avoid
the confusion and fear that many people experience.</p>
<p>I understand something of the desire to anthropomorphise chatbots based on
LLMs. Doing so makes them less scary to people who are fearful about the
technology. I have committed many hours to personal and philosophical
development with several LLM chatbots, to my considerable advantage. Yet I have
no need to think of the software as though it is alive and has a self.</p>
<p>Complex information processing is an apt description for what is actually
required. Thank you for this article. I look forward to reading more of your
thoughts.</p>
</div></div>
<div class="comment"><div class="comment-body expanded">
<p>Agreed. The framing matters more than people admit, and the vocabulary we
choose ends up doing a lot of the argument's work for us before anyone has
started reasoning about the thing itself.</p>
</div></div>
</div></div></div>
<footer><p>Copyright</p></footer></body></html>`;

/** A post whose own body mentions comments — the strip must not eat it. */
const postAboutComments = `<html><head><title>On code comments</title></head><body>
<article><h1>On code comments</h1>
<div class="entry-content comment-guidance">
<p>A comment that restates the code is worse than no comment at all, because it
is one more thing to keep true. The comments worth writing are the ones that
say why the code is shaped the way it is, which the code itself cannot say.</p>
<p>Reviewers should ask for that kind of comment, and delete the other kind on
sight. A stale comment misleads for years after the line it described changed.</p>
</div></article></body></html>`;

export function startCommentSite(port = 8790) {
  return serve(
    {
      "/p/jagged-intelligence": [200, "text/html", shortPostWithComments],
      "/p/on-code-comments": [200, "text/html", postAboutComments],
    },
    port,
  );
}

function serve(routeTable, port) {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      const path = new URL(req.url, "http://x").pathname;
      const hit = routeTable[path];
      if (!hit) { res.writeHead(404); return res.end("nope"); }
      res.writeHead(hit[0], { "content-type": hit[1] });
      res.end(hit[2]);
    });
    server.listen(port, () => resolve(server));
  });
}

export function startNoFeedSite(port = 8783) {
  return serve(noFeedRoutes, port);
}

export function startFixtures(port = 8781) {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      const path = new URL(req.url, "http://x").pathname;
      const hit = routes[path];
      if (!hit) { res.writeHead(404); return res.end("nope"); }
      res.writeHead(hit[0], { "content-type": hit[1] });
      res.end(hit[2]);
    });
    server.listen(port, () => resolve(server));
  });
}

/**
 * Stands in for api.x.com so the X integration can be tested without a paid
 * key. Records the paths requested so the test can assert the calls made.
 */
export function startFakeX(port = 8785) {
  const calls = [];
  const server = http.createServer((req, res) => {
    calls.push(req.url);
    const auth = req.headers.authorization ?? "";
    const json = (status, body) => {
      res.writeHead(status, { "content-type": "application/json" });
      res.end(JSON.stringify(body));
    };
    if (auth !== "Bearer test-token") return json(401, { title: "Unauthorized" });

    const path = new URL(req.url, "http://x").pathname;
    if (path === "/users/by/username/OpenAI") {
      return json(200, {
        data: {
          id: "4398626122",
          name: "OpenAI",
          username: "OpenAI",
          description: "Our mission is to ensure AGI benefits all of humanity.",
          profile_image_url: "https://pbs.twimg.com/profile_images/openai.jpg",
        },
      });
    }
    if (path === "/users/by/username/nosuchaccount") {
      return json(200, { errors: [{ title: "Not Found Error" }] });
    }
    if (path === "/users/4398626122/tweets") {
      return json(200, {
        data: [
          {
            id: "1002",
            text: "Introducing something new today. Read more at https://openai.com/index/thing",
            created_at: "2026-09-03T13:15:00.000Z",
            attachments: { media_keys: ["3_media1"] },
          },
          {
            id: "1001",
            text: "A much longer post that runs well past the length we want to use as a headline, because a title has to stay short enough to scan in a list without wrapping three times.",
            created_at: "2026-09-01T10:00:00.000Z",
          },
        ],
        includes: {
          media: [{ media_key: "3_media1", url: "https://pbs.twimg.com/media/photo.jpg" }],
        },
      });
    }
    return json(404, { title: "Not Found" });
  });
  return new Promise((resolve) => {
    server.listen(port, () => resolve({ server, calls, close: () => server.close() }));
  });
}
