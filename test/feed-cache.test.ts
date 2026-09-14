import test from "node:test";
import assert from "node:assert/strict";
import { startFixtures } from "./fixtures.mjs";
import { GET } from "../app/api/feed/route";
import { KEYS_HEADER, encodeKeysHeader } from "../lib/vault";

/**
 * Which answers the edge may keep.
 *
 * Splitting the batch into one request per source is what makes caching
 * possible at all: `?url=<one feed>` is the same request every reader
 * following that feed makes, while a batch's URL is one reader's own set.
 * This is the part of that worth testing, because getting it wrong either
 * loses the speed-up silently or serves one reader's data to another.
 */

const FEED = "http://127.0.0.1:8801/rss";
let site: { close: () => void };

test.before(async () => {
  site = await startFixtures(8801);
});
test.after(() => site.close());

const ask = (query: string, headers: Record<string, string> = {}) =>
  GET(new Request(`http://localhost/api/feed?${query}`, { headers }));

/** The lifetime the edge is told, which is the one that matters. */
const edgeCache = (res: Response) => res.headers.get("vercel-cdn-cache-control");

test("one source is cacheable at the edge", async () => {
  const res = await ask(`url=${encodeURIComponent(FEED)}`);
  const body = await res.json();

  assert.equal(body.results[0].ok, true, "it read the feed");
  assert.match(edgeCache(res) ?? "", /s-maxage=120/, "fresh for two minutes");
  assert.match(edgeCache(res) ?? "", /stale-while-revalidate=600/);
  assert.match(res.headers.get("cache-control") ?? "", /public/);
});

test("a batch is nobody else's to be served", async () => {
  // Its URL is one reader's own set of feeds, so an edge keyed on the URL
  // would be keeping something no second reader will ever ask for.
  const res = await ask(
    `url=${encodeURIComponent(FEED)}&url=${encodeURIComponent(FEED)}`,
  );
  assert.equal(edgeCache(res), null);
  assert.match(res.headers.get("cache-control") ?? "", /no-store/);
});

test("a request carrying the reader's keys is never cached", async () => {
  // The keys are in a header. An edge keyed on the URL cannot see them, so
  // the answer to a request made with one reader's credentials would be
  // handed to the next caller.
  const res = await ask(`url=${encodeURIComponent(FEED)}`, {
    [KEYS_HEADER]: encodeKeysHeader({ COURTLISTENER_TOKEN: "secret" }),
  });
  assert.equal(edgeCache(res), null);
  assert.match(res.headers.get("cache-control") ?? "", /no-store/);
});

test("a source that failed is not remembered as broken", async () => {
  // Otherwise a publisher having a bad minute is a dead feed for the next ten.
  const res = await ask(`url=${encodeURIComponent("http://127.0.0.1:8801/nope")}`);
  const body = await res.json();

  assert.equal(body.results[0].ok, false);
  assert.equal(edgeCache(res), null, "failures are never cached");
});

test("asking for nothing is still an error", async () => {
  const res = await ask("");
  assert.equal(res.status, 400);
});
