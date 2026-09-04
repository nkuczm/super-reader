import test from "node:test";
import assert from "node:assert/strict";
import { startFakeX } from "./fixtures.mjs";
import { xHandleFrom, xProfileUrl } from "../lib/x";

let fake: { calls: string[]; close: () => void };

test.before(async () => {
  process.env.X_API_BASE = "http://127.0.0.1:8785";
  process.env.X_BEARER_TOKEN = "test-token";
  fake = await startFakeX(8785);
});
test.after(() => fake.close());

test("recognises the ways an X account gets pasted", () => {
  for (const input of [
    "@OpenAI",
    "x.com/OpenAI",
    "https://x.com/OpenAI",
    "https://www.x.com/OpenAI",
    "https://twitter.com/OpenAI",
    "https://mobile.twitter.com/OpenAI/",
    "https://x.com/OpenAI?s=20",
  ]) {
    assert.equal(xHandleFrom(input), "OpenAI", `should read a handle from ${input}`);
  }
});

test("does not mistake site chrome or other sites for an account", () => {
  for (const input of [
    "https://x.com/home",
    "https://x.com/i/flow/login",
    "https://x.com/search?q=ai",
    "https://example.com/OpenAI",
    "openai.com",
    "semiconductors",
  ]) {
    assert.equal(xHandleFrom(input), null, `${input} is not an account`);
  }
});

test("turns an account's posts into feed articles", async () => {
  const { fetchXFeed } = await import("../lib/x");
  const { meta, articles } = await fetchXFeed("OpenAI", 20);

  assert.equal(meta.title, "OpenAI (@OpenAI)");
  assert.equal(meta.feedUrl, xProfileUrl("OpenAI"));
  assert.equal(meta.favicon, "https://pbs.twimg.com/profile_images/openai.jpg");

  assert.equal(articles.length, 2);
  const [newest, older] = articles;

  // Newest first, like every other source.
  assert.ok(Date.parse(newest.publishedAt!) > Date.parse(older.publishedAt!));

  assert.equal(newest.link, "https://x.com/OpenAI/status/1002");
  assert.equal(newest.author, "@OpenAI");
  assert.equal(newest.image, "https://pbs.twimg.com/media/photo.jpg");
  assert.ok(newest.summary?.includes("Introducing something new"));

  // A post has no title, so the opening of the text becomes one.
  assert.ok(older.title.length <= 112, `title too long: ${older.title.length}`);
  assert.ok(older.title.endsWith("…"), "long posts are elided");
  assert.ok(
    older.summary!.length > older.title.length,
    "the full text is kept as the summary",
  );
});

test("asks X only for what it needs", () => {
  const timeline = fake.calls.find((c) => c.includes("/tweets"));
  assert.ok(timeline, "fetched the timeline");
  assert.ok(timeline.includes("exclude=replies"), "skips replies");
  assert.ok(timeline.includes("expansions=attachments.media_keys"), "asks for media");
});

test("explains a missing key instead of failing obscurely", async () => {
  const previous = process.env.X_BEARER_TOKEN;
  delete process.env.X_BEARER_TOKEN;
  const { fetchXFeed } = await import("../lib/x");
  await assert.rejects(() => fetchXFeed("OpenAI"), /needs an X API key/);
  process.env.X_BEARER_TOKEN = previous;
});

test("reports an account that does not exist", async () => {
  const { fetchXFeed } = await import("../lib/x");
  await assert.rejects(() => fetchXFeed("nosuchaccount"), /No X account/);
});
