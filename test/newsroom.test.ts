import test from "node:test";
import assert from "node:assert/strict";
import { startBlockedHomepageSite, startAnchorFeedSite } from "./fixtures.mjs";
import { discover } from "../lib/discover";

let blocked: { close: () => void };
let anchored: { close: () => void };

test.before(async () => {
  blocked = await startBlockedHomepageSite(8787);
  anchored = await startAnchorFeedSite(8788);
});
test.after(() => {
  blocked.close();
  anchored.close();
});

test("finds a feed through the index page when the homepage is blocked", async () => {
  const r = await discover("http://127.0.0.1:8787");
  assert.equal(r.title, "National Press Releases");
  assert.equal(r.feedUrl, "http://127.0.0.1:8787/feeds/national-press-releases/rss.xml");
});

test("prefers the newsroom feed over regional and podcast ones", async () => {
  const r = await discover("http://127.0.0.1:8787");
  assert.ok(
    !r.title.includes("Seattle"),
    "a regional feed should not outrank press releases",
  );
});

test("finds a feed linked by a plain anchor", async () => {
  const r = await discover("http://127.0.0.1:8788");
  assert.equal(r.feedUrl, "http://127.0.0.1:8788/news/rss.xml");
  assert.equal(r.title, "National Press Releases");
});

test("keeps navigation out of the summary", async () => {
  const r = await discover("http://127.0.0.1:8788");
  const [article] = r.articles;
  assert.ok(
    article.summary?.startsWith("The Department announced today"),
    `summary should be the prose, got: ${article.summary}`,
  );
  for (const junk of ["Search", "All News", "Briefings", "Home"]) {
    assert.ok(!article.summary?.includes(junk), `"${junk}" leaked into the summary`);
  }
});
