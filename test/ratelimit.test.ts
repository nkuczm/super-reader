import test from "node:test";
import assert from "node:assert/strict";
import { startRateLimitedSite } from "./fixtures.mjs";
import { fetchText, retryAfterMs, userAgentFor } from "../lib/feed";

/**
 * Reddit answering a preview with 429.
 *
 * Two halves to it. Reddit asks callers to identify themselves and pools
 * everything that looks like a browser into one heavily throttled bucket, so
 * a deployed reader sending a Chrome string from a datacenter is asking for
 * exactly the answer it got. And a rate limit is a "not yet" that was being
 * treated as a permanent failure, then shown to whoever pasted the URL as
 * "429 Too Many Requests" — which reads as the reader being broken.
 */

// A port each: undici keeps connections alive, so a closed server can still
// hold the port when the next test tries to bind it.
let site: Awaited<ReturnType<typeof startRateLimitedSite>>;

test.afterEach(() => site?.close());

test("a transient rate limit is waited out rather than surfaced", async () => {
  site = await startRateLimitedSite(8793, { failures: 1, retryAfter: "0" });
  const { body } = await fetchText("http://127.0.0.1:8793/limited", 8000);

  assert.match(body, /<rss/, "the retry got the feed");
  assert.equal(site.seen.length, 2, "asked twice: the 429, then the answer");
});

test("a server that will not relent is given up on, not hammered", async () => {
  // Asking a third time is how a throttle becomes a block.
  site = await startRateLimitedSite(8794, { retryAfter: "0" });
  await assert.rejects(() => fetchText("http://127.0.0.1:8794/always", 8000), /429/);
  assert.equal(site.seen.length, 2, "one retry, then it stops");
});

test("the 429 says who is refusing, not just a number", async () => {
  site = await startRateLimitedSite(8795, { retryAfter: "0" });
  await assert.rejects(
    () => fetchText("http://127.0.0.1:8795/always", 8000),
    // Whoever pasted the URL needs to know it is the other end declining.
    /127\.0\.0\.1 is rate-limiting this server \(429\)/,
  );
});

test("a wait longer than the caller allowed is not taken", async () => {
  // A refresh cannot sit out the minute some servers name. Failing at once
  // beats hanging until the timeout and failing anyway.
  site = await startRateLimitedSite(8796, { retryAfter: "60" });
  const started = Date.now();
  await assert.rejects(() => fetchText("http://127.0.0.1:8796/limited", 2000), /429/);

  assert.ok(Date.now() - started < 1000, "gave up immediately");
  assert.equal(site.seen.length, 1, "and did not wait to ask again");
});

test("retries come out of the caller's budget, not on top of it", async () => {
  site = await startRateLimitedSite(8797, { failures: 5, retryAfter: "0" });
  const started = Date.now();
  await assert.rejects(() => fetchText("http://127.0.0.1:8797/limited", 3000), /429/);
  assert.ok(Date.now() - started < 3000, "stayed inside the timeout it was given");
});

test("Reddit is told what this is, rather than posing as a browser", async () => {
  // Its own guidance: a unique descriptive User-Agent gets its own budget,
  // while common and browser-shaped ones are pooled and throttled hard.
  site = await startRateLimitedSite(8798, { failures: 0 });
  await fetchText("http://127.0.0.1:8798/limited", 8000);
  assert.match(site.seen[0].userAgent, /Mozilla/, "ordinary sites still see a browser");

  // The host decides, so this holds for every path that reaches Reddit —
  // the preview, the refresh, reading a post, and gap-filling a self post.
  assert.equal(userAgentFor("https://www.reddit.com/r/news/.rss"), "web:super-reader:0.1 (by /u/super-reader)");
  assert.equal(userAgentFor("https://old.reddit.com/r/news/.rss"), "web:super-reader:0.1 (by /u/super-reader)");
  assert.match(userAgentFor("https://example.com/feed"), /Mozilla/);
  // Not a reddit domain, whatever it is called.
  assert.match(userAgentFor("https://notreddit.com/x"), /Mozilla/);
  assert.match(userAgentFor("https://reddit.com.evil.test/x"), /Mozilla/);
});

test("Retry-After is read in either of the forms servers send it", () => {
  const now = Date.parse("2026-09-14T12:00:00Z");
  assert.equal(retryAfterMs("2", now), 2000);
  assert.equal(retryAfterMs("0", now), 0);
  assert.equal(retryAfterMs("Mon, 14 Sep 2026 12:00:30 GMT", now), 30_000);
  // A date already past means "go ahead", not a negative wait.
  assert.equal(retryAfterMs("Mon, 14 Sep 2026 11:59:00 GMT", now), 0);
  // Absent or nonsense: a short pause, which is what these buckets usually are.
  assert.equal(retryAfterMs(null, now), 600);
  assert.equal(retryAfterMs("  ", now), 600);
  assert.equal(retryAfterMs("soon", now), 600);
});
