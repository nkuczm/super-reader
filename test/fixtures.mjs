import http from "node:http";

const rss = `<?xml version="1.0"?><rss version="2.0" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:content="http://purl.org/rss/1.0/modules/content/">
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

const noFeedRoutes = {
  "/news": [200, "text/html", newsIndex],
  "/about": [200, "text/html", aboutPage],
  "/news/claude-opus-5": [200, "text/html", article],
  "/news/interpretability-progress": [200, "text/html", boilerplatePage],
};

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
