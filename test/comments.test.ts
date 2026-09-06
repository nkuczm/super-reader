import test from "node:test";
import assert from "node:assert/strict";
import { startCommentSite } from "./fixtures.mjs";
import { extractArticle } from "../lib/article";

/**
 * Readability scores containers by how much text they hold, so a short post
 * with a busy comment thread under it used to come back as somebody's comment,
 * printed under the author's name and the post's title.
 */
const S = "http://127.0.0.1:8790";
let site: { close: () => void };

test.before(async () => {
  site = await startCommentSite(8790);
});
test.after(() => site.close());

test("a short post is the article, not the long comment thread below it", async () => {
  const article = await extractArticle(`${S}/p/jagged-intelligence`);

  assert.match(article.title, /Jagged Intelligence/);
  assert.match(
    article.html,
    /Yale Review/,
    "the author's own two sentences are the body",
  );
  assert.doesNotMatch(
    article.html,
    /complex information processing/i,
    "the top comment must not be presented as the article",
  );
  assert.doesNotMatch(
    article.html,
    /look forward to reading more of your thoughts/i,
    "nor any of the rest of the thread",
  );
  assert.doesNotMatch(article.html, /Agreed\. The framing matters/i);
});

test("a post that is itself about comments survives the strip", async () => {
  const article = await extractArticle(`${S}/p/on-code-comments`);

  assert.match(
    article.html,
    /restates the code is worse than no comment/,
    "the body is kept even though its container is named for comments",
  );
  assert.match(article.html, /stale comment misleads/);
});

test("a genuinely short post is still extracted, not discarded", async () => {
  // Readability's default charThreshold is 500; a two-sentence note is under
  // it, and falling back to scraping the whole page brings the nav with it.
  const article = await extractArticle(`${S}/p/jagged-intelligence`);
  assert.doesNotMatch(article.html, /Archive<\/a>|>Home</, "no navigation");
  assert.ok(article.wordCount > 20, "the note itself came through");
  assert.ok(article.wordCount < 120, `unexpectedly long: ${article.wordCount}`);
});
