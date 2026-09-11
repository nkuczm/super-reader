import test from "node:test";
import assert from "node:assert/strict";
import { startFakeInstagram } from "./fixtures.mjs";
import {
  redditSourceFrom,
  redditFeedUrl,
  redditSourceTitle,
  redditSourceUrl,
} from "../lib/reddit";
import { xSourceFrom, xSourceUrl } from "../lib/x";
import { instagramHandleFrom, instagramProfileUrl } from "../lib/instagram";

let fakeInstagram: { calls: string[]; close: () => void };

test.before(async () => {
  process.env.INSTAGRAM_API_BASE = "http://127.0.0.1:8795";
  process.env.INSTAGRAM_ACCESS_TOKEN = "ig-token";
  process.env.INSTAGRAM_USER_ID = "17841400000000000";
  fakeInstagram = await startFakeInstagram(8795);
});
test.after(() => fakeInstagram.close());

/**
 * Everything here used to fall through to the topic branch and quietly become
 * a Bing News search — "u/kn0thing" became a news search for the letter u.
 */

test("Reddit is more than subreddits", () => {
  assert.deepEqual(redditSourceFrom("u/kn0thing"), { kind: "user", name: "kn0thing" });
  assert.deepEqual(redditSourceFrom("/user/kn0thing"), { kind: "user", name: "kn0thing" });
  assert.deepEqual(redditSourceFrom("https://www.reddit.com/user/kn0thing/submitted/"), {
    kind: "user",
    name: "kn0thing",
  });
  assert.deepEqual(redditSourceFrom("u/someone/m/newsmix"), {
    kind: "multi",
    user: "someone",
    name: "newsmix",
  });
  assert.deepEqual(redditSourceFrom("https://www.reddit.com/domain/nature.com/"), {
    kind: "domain",
    host: "nature.com",
  });
  assert.deepEqual(
    redditSourceFrom("https://www.reddit.com/r/science/search?q=climate&restrict_sr=1"),
    { kind: "search", query: "climate", sub: "science" },
  );
  // restrict_sr=0 means the search was not restricted, whatever page it ran on.
  assert.deepEqual(
    redditSourceFrom("https://www.reddit.com/r/science/search?q=climate&restrict_sr=0"),
    { kind: "search", query: "climate" },
  );
  assert.deepEqual(redditSourceFrom("https://www.reddit.com/search/?q=fusion&sort=top"), {
    kind: "search",
    query: "fusion",
    sort: "top",
  });

  // Subreddits still resolve as they did.
  const sub = redditSourceFrom("r/news/top?t=week");
  assert.equal(sub?.kind, "subreddit");
  assert.equal(redditSourceTitle(sub!), "r/news · top");
});

test("what is not a Reddit source stays out", () => {
  for (const input of [
    "https://reddit.com/r/news/comments/abc123/a-thread",
    "https://example.com/u/someone",
    "semiconductors",
    "https://www.reddit.com/settings",
  ]) {
    assert.equal(redditSourceFrom(input), null, `${input} is not a Reddit source`);
  }
});

test("each Reddit source has a feed, and it is the canonical www one", () => {
  assert.equal(
    redditFeedUrl({ kind: "user", name: "kn0thing" }),
    "https://www.reddit.com/user/kn0thing/submitted/.rss",
  );
  assert.equal(
    redditFeedUrl({ kind: "multi", user: "someone", name: "newsmix" }),
    "https://www.reddit.com/user/someone/m/newsmix/.rss",
  );
  assert.equal(
    redditFeedUrl({ kind: "domain", host: "nature.com" }),
    "https://www.reddit.com/domain/nature.com/.rss",
  );

  const search = redditFeedUrl({ kind: "search", query: "fusion power", sub: "science" });
  assert.match(search, /^https:\/\/www\.reddit\.com\/r\/science\/search\/\.rss\?/);
  assert.match(search, /q=fusion\+power/);
  assert.match(search, /restrict_sr=1/);
  // A standing query sorted by relevance looks frozen; newest is the default.
  assert.match(search, /sort=new/);

  assert.equal(
    redditSourceUrl({ kind: "domain", host: "nature.com" }),
    "https://www.reddit.com/domain/nature.com/",
  );
  assert.equal(
    redditSourceTitle({ kind: "search", query: "fusion", sub: "science" }),
    "Reddit · “fusion” in r/science",
  );
});

test("X lists and searches are sources, not site chrome", () => {
  assert.deepEqual(xSourceFrom("@OpenAI"), { kind: "account", handle: "OpenAI" });
  assert.deepEqual(xSourceFrom("https://x.com/i/lists/1234567890"), {
    kind: "list",
    id: "1234567890",
  });
  assert.deepEqual(xSourceFrom("https://x.com/search?q=chip%20export%20controls"), {
    kind: "search",
    query: "chip export controls",
  });
  assert.deepEqual(xSourceFrom("https://x.com/hashtag/AIsafety"), {
    kind: "search",
    query: "#AIsafety",
  });
  assert.equal(xSourceFrom("https://x.com/home"), null);
  assert.equal(xSourceFrom("https://example.com/i/lists/1"), null);

  assert.equal(
    xSourceUrl({ kind: "list", id: "1234567890" }),
    "https://x.com/i/lists/1234567890",
  );
});

test("an Instagram account is recognised, but a bare @handle is still X", () => {
  for (const input of [
    "https://www.instagram.com/nasa",
    "https://instagram.com/nasa/",
    "instagram.com/nasa",
    "ig:nasa",
    "ig:@nasa",
  ]) {
    assert.equal(instagramHandleFrom(input), "nasa", `should read a handle from ${input}`);
  }

  assert.equal(
    instagramHandleFrom("@nasa"),
    null,
    "a bare @handle already means X; changing that silently would be worse",
  );
  for (const input of [
    "https://www.instagram.com/p/ABC123/",
    "https://www.instagram.com/explore/",
    "https://example.com/nasa",
  ]) {
    assert.equal(instagramHandleFrom(input), null, `${input} is not an account`);
  }
});

test("Instagram posts become articles through Business Discovery", async () => {
  const { fetchInstagramFeed } = await import("../lib/instagram");
  const { meta, articles } = await fetchInstagramFeed("nasa", 20);

  assert.equal(meta.title, "NASA (@nasa)");
  assert.equal(meta.feedUrl, instagramProfileUrl("nasa"));
  assert.equal(meta.favicon, "https://cdn.instagram.com/nasa.jpg");

  assert.equal(articles.length, 2);
  const [newest, older] = articles;
  assert.ok(Date.parse(newest.publishedAt!) > Date.parse(older.publishedAt!));
  assert.equal(newest.link, "https://www.instagram.com/p/ABC123/");
  assert.match(newest.title, /Carina Nebula/);
  assert.equal(newest.image, "https://cdn.instagram.com/carina.jpg");
  assert.equal(newest.commentCount, 412);
  // A video's media_url is the video file; the thumbnail is the picture.
  assert.equal(older.image, "https://cdn.instagram.com/launch-thumb.jpg");

  // An account Meta will not describe says so, rather than returning empty.
  await assert.rejects(
    () => fetchInstagramFeed("nosuchaccount"),
    /business or creator account/,
  );
});

test("without credentials, Instagram explains itself instead of failing obscurely", async () => {
  const token = process.env.INSTAGRAM_ACCESS_TOKEN;
  delete process.env.INSTAGRAM_ACCESS_TOKEN;
  try {
    const { fetchInstagramFeed } = await import("../lib/instagram");
    await assert.rejects(() => fetchInstagramFeed("nasa"), /INSTAGRAM_ACCESS_TOKEN/);
  } finally {
    if (token) process.env.INSTAGRAM_ACCESS_TOKEN = token;
  }
});
