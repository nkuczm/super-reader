import http from "node:http";

const rss = `<?xml version="1.0"?><rss version="2.0" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:content="http://purl.org/rss/1.0/modules/content/">
<channel><title>Example Blog</title><link>http://127.0.0.1:8781</link><description>A test blog</description>
<item><title>Hello &amp; welcome</title><link>/posts/1</link><guid>p1</guid><dc:creator>Ada</dc:creator>
<pubDate>Tue, 02 Sep 2025 10:00:00 GMT</pubDate>
<content:encoded><![CDATA[<p>First <b>post</b> body.</p><img src="/img/a.png">]]></content:encoded></item>
<item><title>Second post</title><link>http://127.0.0.1:8781/posts/2</link><guid>p2</guid>
<pubDate>Mon, 01 Sep 2025 10:00:00 GMT</pubDate><description>Short summary here.</description>
<enclosure url="http://cdn/x.jpg" type="image/jpeg"/></item>
</channel></rss>`;

const atom = `<?xml version="1.0" encoding="utf-8"?>
<feed xmlns="http://www.w3.org/2005/Atom"><title>Atom Site</title><subtitle>Sub</subtitle>
<link rel="alternate" href="http://127.0.0.1:8781/atomsite"/>
<entry><title>Atom entry one</title><link rel="alternate" href="/a/1"/><id>tag:a1</id>
<author><name>Grace</name></author><published>2025-09-03T12:00:00Z</published>
<summary>Atom summary text.</summary></entry></feed>`;

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
