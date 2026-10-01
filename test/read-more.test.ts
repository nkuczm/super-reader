import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { extractArticle } from "../lib/article";

const para = (text: string) =>
  `<p class="text text-block paragraph yf-18d6y07" style="text-decoration: none;"><!-- HTML_TAG_START -->${text}<!-- HTML_TAG_END --></p>`;
const filler = "The tech billionaire's dealmaking on the island has drawn support and backlash from locals, and the story explains why. ";

// The shape Yahoo Finance served on 1 Oct 2026: the end of the story inside a
// read-more wrapper with display:none, behind a "Story Continues" button.
const PAGE = `<!doctype html><html><head><title>Zuckerberg expands Hawaii compound</title></head><body>
<header><nav><a href="/">Home</a></nav></header>
<article><h1>Mark Zuckerberg expands his Hawaii compound</h1>
<div class="body yf-1">
${para(filler.repeat(3))}
${para(filler.repeat(3))}
<h2>Lessons for investors</h2>
${para("The backlash to Zuckerberg's landbanking should raise red flags for regular investors. " + filler)}
</div>
<div class="readmore yf-11souuj"><button class="secondary-btn readmore-button" aria-label="Story Continues"><span>Story Continues</span></button></div>
<div class="read-more-wrapper" style="display: none" data-testid="read-more">
<div class="wrapper" data-testid="inarticle-ad"><div class="sdaContainer"></div></div>
${para("Before buying property, consider the long-term outlook for the location you're targeting, not just the current economics. " + filler)}
${para("Hawaii State Senator Brenton Awa has proposed a potential ban on foreign buyers and corporations. " + filler)}
${para("This is why gauging local sentiment is an important part of the real estate investment process. " + filler)}
</div>
</article>
<div class="modal" style="display: none">${para("Sign up for our newsletter to get the best stories in your inbox every single morning. " + filler)}</div>
</body></html>`;

test("an article folded behind Read more is read whole", async () => {
  const server = createServer((_req, res) => {
    res.writeHead(200, { "content-type": "text/html" });
    res.end(PAGE);
  });
  await new Promise<void>((resolve) => server.listen(8797, resolve));
  try {
    const article = await extractArticle("http://127.0.0.1:8797/news/story.html");
    assert.match(article.html, /Before buying property/);
    assert.match(article.html, /Brenton Awa/);
    assert.match(article.html, /gauging local sentiment/);
    assert.doesNotMatch(article.html, /Story Continues/, "the button that opened it is gone");
    assert.doesNotMatch(article.html, /Sign up for our newsletter/, "other hidden content stays hidden");
  } finally {
    server.close();
  }
});
