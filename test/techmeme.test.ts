import test from "node:test";
import assert from "node:assert/strict";
import { fromNewYork, isTechmemeFeed, riverArticles } from "../lib/techmeme";

/** Rows as the River serves them (measured 15 Oct 2026), across a day's heading. */
const RIVER = `
<DIV ID="countercol">
<H2>October 15, 2026</H2>
<TABLE>
<tr class="ritem"><td>2:10 PM &nbsp;&bull;</td><td><div class="rshr" id="s0" pml="261015p44" twid="1"></div><cite><A HREF="https://www.calcalistech.com/">CTech</A>:</cite>&nbsp; <a href="https://www.calcalistech.com/ctechnews/article/ay5slvopq">Two workers have been killed at Intel's Kiryat Gat fab</a></td></tr>
<tr class="ritem"><td>1:55 PM &nbsp;&bull;</td><td><div class="rshr" id="s1" pml="261015p43"></div><cite>Andrew J. Hawkins / <A HREF="https://www.theverge.com/">The Verge</A>:</cite>&nbsp; <a href="https://www.theverge.com/transportation/1011653/volvo-nvidia">Volvo says it will use Nvidia&#39;s Hyperion platform &amp; more</a></td></tr>
</TABLE>
<H2>October 13, 2026</H2>
<TABLE>
<tr class="ritem"><td>12:05 AM &nbsp;&bull;</td><td><div class="rshr" id="s111" pml="261013p1"></div><cite>Dustin Volz / <A HREF="https://www.nytimes.com/">New York Times</A>:</cite>&nbsp; <a href="https://www.nytimes.com/2026/10/13/us/politics/x.html">The FBI says it worked with CrowdStrike to dismantle laptop farms</a></td></tr>
</TABLE>
</DIV>`;

test("the River's rows, under the links and titles Techmeme's feed gives the same stories", () => {
  const articles = riverArticles(RIVER);
  assert.deepEqual(articles.map((a) => a.link), [
    "https://www.techmeme.com/261015/p44#a261015p44",
    "https://www.techmeme.com/261015/p43#a261015p43",
    "https://www.techmeme.com/261013/p1#a261013p1",
  ]);
  assert.equal(articles[0].id, articles[0].link, "the feed's guid is the permalink too");
  assert.deepEqual(articles.map((a) => a.title), [
    "Two workers have been killed at Intel's Kiryat Gat fab (CTech)",
    "Volvo says it will use Nvidia's Hyperion platform & more (Andrew J. Hawkins/The Verge)",
    "The FBI says it worked with CrowdStrike to dismantle laptop farms (Dustin Volz/New York Times)",
  ]);
  // Techmeme's clock is New York's: 2:10 PM in October is 18:10 UTC; 12:05 AM is just after midnight there.
  assert.equal(articles[0].publishedAt, "2026-10-15T18:10:00.000Z");
  assert.equal(articles[2].publishedAt, "2026-10-13T04:05:00.000Z");
});

test("New York time through the change of clocks", () => {
  assert.equal(fromNewYork(2026, 9, 15, 14, 10).toISOString(), "2026-10-15T18:10:00.000Z", "summer: UTC-4");
  assert.equal(fromNewYork(2026, 11, 15, 14, 10).toISOString(), "2026-12-15T19:10:00.000Z", "winter: UTC-5");
});

test("only Techmeme's own feed reads the River", () => {
  assert.ok(isTechmemeFeed("https://www.techmeme.com/feed.xml"));
  assert.ok(isTechmemeFeed("https://techmeme.com/feed.xml"));
  assert.ok(!isTechmemeFeed("https://www.mediagazer.com/feed.xml"));
  assert.ok(!isTechmemeFeed("https://www.techmeme.com/river"));
  assert.ok(!isTechmemeFeed("not a url"));
});

test("a page that is not the River gives nothing, not a guess", () => {
  assert.deepEqual(riverArticles("<html><body><h2>October 15, 2026</h2><p>Nothing here</p></body></html>"), []);
});
