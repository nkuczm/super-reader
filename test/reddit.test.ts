import test from "node:test";
import assert from "node:assert/strict";
import { startRedditSite } from "./fixtures.mjs";
import { subredditFrom, subredditFeedUrl, isRedditFeed } from "../lib/reddit";
import { fetchText, parseFeed } from "../lib/feed";

test("recognises a subreddit however it is pasted", () => {
  for (const input of [
    "r/AskHistorians",
    "/r/AskHistorians",
    "R/AskHistorians/",
    "reddit.com/r/AskHistorians",
    "https://www.reddit.com/r/AskHistorians/",
    "https://old.reddit.com/r/AskHistorians",
  ]) {
    assert.equal(subredditFrom(input)?.name, "AskHistorians", `should read ${input}`);
  }

  assert.deepEqual(subredditFrom("r/programming+rust"), { name: "programming+rust" });
  // Typed with a sort, which is what someone reaching for the week's best does.
  assert.deepEqual(subredditFrom("r/news/top"), { name: "news", sort: "top" });
  assert.deepEqual(subredditFrom("r/news/top?t=week"), {
    name: "news",
    sort: "top",
    window: "week",
  });
  assert.deepEqual(subredditFrom("/r/news/new/"), { name: "news", sort: "new" });
  assert.deepEqual(subredditFrom("reddit.com/r/news/new"), { name: "news", sort: "new" });
  assert.deepEqual(subredditFrom("https://www.reddit.com/r/news/top/?t=week"), {
    name: "news",
    sort: "top",
    window: "week",
  });
});

test("does not mistake other things for a subreddit", () => {
  for (const input of [
    "reddit.com",
    "https://www.reddit.com/user/someone",
    "https://www.reddit.com/r/news/comments/abc/story/",
    "r/news/comments",
    "programming",
    "https://example.com/r/news",
    "@OpenAI",
    "r/x",
  ]) {
    assert.equal(subredditFrom(input), null, `${input} is not a subreddit`);
  }
});

test("builds the feed URL, with the sort and window when given", () => {
  assert.equal(subredditFeedUrl({ name: "news" }), "https://www.reddit.com/r/news/.rss");
  assert.equal(
    subredditFeedUrl({ name: "news", sort: "new" }),
    "https://www.reddit.com/r/news/new/.rss",
  );
  assert.equal(
    subredditFeedUrl({ name: "news", sort: "top", window: "week" }),
    "https://www.reddit.com/r/news/top/.rss?t=week",
  );
  assert.ok(isRedditFeed("https://www.reddit.com/r/news/.rss"));
  assert.ok(!isRedditFeed("https://example.com/feed"));
});

test("a link post points at what it links to, keeping the discussion", async () => {
  const site = await startRedditSite(8792);
  try {
    const { body, finalUrl } = await fetchText("http://127.0.0.1:8792/r/testsub/.rss");
    // The feed declares its own reddit.com home, which is what marks it.
    const { articles } = parseFeed(body, finalUrl.replace("127.0.0.1:8792", "www.reddit.com"));
    const post = articles.find((a) => a.title.startsWith("How branch"))!;

    assert.equal(
      post.link,
      "https://example.test/branch-prediction",
      "reading it opens the article, not Reddit's comments page",
    );
    assert.equal(
      post.comments,
      "https://www.reddit.com/r/testsub/comments/aaa/how_branch_prediction/",
      "and the discussion is still one tap away",
    );
    assert.equal(post.summary, undefined, "no 'submitted by /u/...' boilerplate");
    assert.equal(post.image, undefined, "Reddit's thumbnail is not worth showing");
  } finally {
    site.close();
  }
});

test("a self post keeps its own text and stays on Reddit", async () => {
  const site = await startRedditSite(8793);
  try {
    const { body, finalUrl } = await fetchText("http://127.0.0.1:8793/r/testsub/.rss");
    const { articles } = parseFeed(body, finalUrl.replace("127.0.0.1:8793", "www.reddit.com"));
    const post = articles.find((a) => a.title.startsWith("What is the history"))!;

    assert.match(post.link, /reddit\.com\/r\/testsub\/comments\/bbb/, "the post is the page");
    assert.match(post.summary ?? "", /Despite its original meaning of donkey/);
    assert.ok(!/submitted by/i.test(post.summary ?? ""), "without Reddit's footer");
  } finally {
    site.close();
  }
});

test("a post URL is recognised, and other reddit pages are not", async () => {
  const { redditPostUrl } = await import("../lib/reddit");
  assert.equal(
    redditPostUrl("https://www.reddit.com/r/news/comments/abc123/some_slug/"),
    "https://www.reddit.com/r/news/comments/abc123/some_slug/.rss",
  );
  assert.equal(
    redditPostUrl("https://old.reddit.com/r/news/comments/abc123/some_slug"),
    "https://www.reddit.com/r/news/comments/abc123/some_slug/.rss",
    "old. is normalised to the host that answers",
  );
  assert.equal(redditPostUrl("https://www.reddit.com/r/news/"), null);
  assert.equal(redditPostUrl("https://example.com/r/news/comments/a/b/"), null);
});

test("a post is read from its own feed, with the replies", async () => {
  const { readRedditPost, redditPostHtml } = await import("../lib/reddit");
  const site = await startRedditSite(8794);
  try {
    // The reader normalises to www; the fixture stands in for it.
    const post = await readRedditPost("http://127.0.0.1:8794/r/testsub/comments/bbb/history/");
    assert.ok(post, "the post was read");
    assert.equal(post!.title, 'What is the history of using "ass" as an intensifier?');
    assert.equal(post!.author, "/u/asker");
    assert.match(post!.body, /Despite its original meaning of donkey/);
    assert.equal(post!.destination, undefined, "a self post links only to itself");

    assert.equal(post!.comments.length, 1, "AutoModerator is not the discussion");
    assert.equal(post!.comments[0].author, "/u/linguist");

    const html = redditPostHtml(post!);
    assert.match(html, /<h2>Comments<\/h2>/);
    assert.match(html, /<strong>\/u\/linguist<\/strong>/);
    assert.match(html, /attested from the 1940s/);
    assert.ok(!/submitted by/i.test(html), "Reddit's footer is not part of a comment");
  } finally {
    site.close();
  }
});
