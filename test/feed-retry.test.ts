import test from "node:test";
import assert from "node:assert/strict";
import { fetchFeedText, isFeedAddress } from "../lib/feed";

const realFetch = globalThis.fetch;
test.after(() => {
  globalThis.fetch = realFetch;
});

const RSS = `<?xml version="1.0"?><rss version="2.0"><channel><title>Nature Microbiology</title><item><title>A paper</title><link>https://www.nature.com/articles/x</link></item></channel></rss>`;
const PAGE = `<!DOCTYPE html><html><head><title>Cookies</title></head><body>Please enable cookies</body></html>`;

// What nature.com did on 12 Oct 2026: the feed, without a cookie, by way of its sign-in host to an error page.
function natureLike(calls: string[]) {
  return (async (input: any, init?: RequestInit) => {
    const url = String(input);
    const cookie = new Headers(init?.headers).get("cookie") ?? "";
    calls.push(`${url} ${cookie ? `[${cookie}]` : ""}`.trim());
    const manual = init?.redirect === "manual";
    if (url === "https://www.nature.com/nmicrobiol.rss" && cookie.includes("idp_marker=1")) {
      return new Response(RSS, { status: 200 });
    }
    if (url === "https://www.nature.com/nmicrobiol.rss" && manual) {
      return { status: 303, ok: false, statusText: "See Other", headers: new Headers([["location", "https://idp.nature.com/authorize?redirect_uri=https://www.nature.com/nmicrobiol.rss"]]), text: async () => "" } as unknown as Response;
    }
    if (url.startsWith("https://idp.nature.com/authorize")) {
      return { status: 303, ok: false, statusText: "See Other", headers: new Headers([["location", "https://www.nature.com/nmicrobiol.rss"], ["set-cookie", "idp_marker=1; Domain=.nature.com; Path=/"]]), text: async () => "" } as unknown as Response;
    }
    // A client that keeps no cookies, following redirects itself, ends on the error page.
    return new Response(PAGE, { status: 200 });
  }) as typeof fetch;
}

test("a feed answered with a cookie check is asked again carrying the cookie the site set", async () => {
  const calls: string[] = [];
  globalThis.fetch = natureLike(calls);
  const { body } = await fetchFeedText("https://www.nature.com/nmicrobiol.rss");
  assert.match(body, /<rss/);
  assert.deepEqual(calls, [
    "https://www.nature.com/nmicrobiol.rss",
    "https://www.nature.com/nmicrobiol.rss",
    "https://idp.nature.com/authorize?redirect_uri=https://www.nature.com/nmicrobiol.rss",
    "https://www.nature.com/nmicrobiol.rss [idp_marker=1]",
  ]);
});

test("a feed that answers is asked once; a page address is never retried as a feed", async () => {
  const calls: string[] = [];
  globalThis.fetch = (async (input: any) => {
    calls.push(String(input));
    return new Response(String(input).endsWith(".rss") ? RSS : PAGE, { status: 200 });
  }) as typeof fetch;
  await fetchFeedText("https://www.nature.com/ng.rss");
  await fetchFeedText("https://example.com/news/");
  assert.deepEqual(calls, ["https://www.nature.com/ng.rss", "https://example.com/news/"]);
  assert.ok(isFeedAddress("https://journals.sagepub.com/action/showFeed?ui=0&jc=pss&type=etoc&feed=rss"));
  assert.ok(isFeedAddress("https://news.google.com/rss/search?q=site%3Acnn.com"));
  assert.ok(!isFeedAddress("https://example.com/news/"));
});

test("a cookie goes only to the site that set it", async () => {
  const sent: string[] = [];
  globalThis.fetch = (async (input: any, init?: RequestInit) => {
    const url = String(input);
    sent.push(`${new URL(url).hostname}:${new Headers(init?.headers).get("cookie") ?? ""}`);
    if (init?.redirect !== "manual") return new Response(PAGE, { status: 200 });
    if (url.includes("example.org")) return new Response(RSS, { status: 200 });
    return { status: 302, ok: false, statusText: "Found", headers: new Headers([["location", "https://cdn.example.org/feed.xml"], ["set-cookie", "s=1; Path=/"]]), text: async () => "" } as unknown as Response;
  }) as typeof fetch;
  await fetchFeedText("https://www.example.com/feed.xml");
  assert.deepEqual(sent, ["www.example.com:", "www.example.com:", "cdn.example.org:"]);
});

test("enrichment leaves an article alone when its page is a bot or cookie check", async () => {
  const { isChallengeHtml } = await import("../lib/challenge");
  assert.ok(isChallengeHtml("<html><body>x</body></html>", "https://www.nature.com/articles/x?error=cookies_not_supported&code=1"));
  assert.ok(isChallengeHtml('<html><img src="https://www.nature.com/_fs-ch-1T1wmsGaOgGaSxcX/assets/errorIcon.svg"></html>', "https://www.nature.com/articles/x"));
  assert.ok(isChallengeHtml("<html><head><title>Just a moment...</title></head><body>Checking your browser</body></html>", "https://example.com/a"));
  assert.ok(!isChallengeHtml("<html><head><title>A real story</title></head><body><p>" + "Words. ".repeat(500) + "</p></body></html>", "https://example.com/a"));
});

// Measured from the live server, 17 Nov 2026: NPR 403, Newsweek 406, phys.org 429.
test("a refused feed is asked once more as a feed reader that names itself", async () => {
  const agents: string[] = [];
  globalThis.fetch = (async (_input: any, init?: RequestInit) => {
    const agent = new Headers(init?.headers).get("user-agent") ?? "";
    agents.push(agent);
    if (/Chrome/.test(agent)) return new Response("no", { status: 403, statusText: "Forbidden" });
    return new Response(RSS, { status: 200 });
  }) as typeof fetch;
  const { body, agent } = await fetchFeedText("https://feeds.example.org/1001/rss.xml");
  assert.match(body, /<rss/);
  assert.equal(agent, "reader");
  assert.equal(agents.length, 2);
  assert.match(agents[1], /SuperReader/);
  assert.doesNotMatch(agents[1], /Chrome|Safari/);
});

test("a feed refused both ways reports the first refusal, and other failures are not retried", async () => {
  let calls = 0;
  globalThis.fetch = (async () => {
    calls++;
    return new Response("no", { status: calls === 1 ? 406 : 403, statusText: calls === 1 ? "Not Acceptable" : "Forbidden" });
  }) as typeof fetch;
  await assert.rejects(fetchFeedText("https://www.example.org/rss.xml"), /^Error: 406 Not Acceptable/);
  assert.equal(calls, 2);

  calls = 0;
  globalThis.fetch = (async () => {
    calls++;
    return new Response("gone", { status: 404, statusText: "Not Found" });
  }) as typeof fetch;
  await assert.rejects(fetchFeedText("https://www.example.org/rss.xml"), /404/);
  assert.equal(calls, 1);
});

test("a feed answered with a page even after the cookie retry is asked as a feed reader", async () => {
  globalThis.fetch = (async (_input: any, init?: RequestInit) => {
    const agent = new Headers(init?.headers).get("user-agent") ?? "";
    return new Response(/SuperReader/.test(agent) ? RSS : PAGE, { status: 200 });
  }) as typeof fetch;
  const { body } = await fetchFeedText("https://www.example.org/feed/");
  assert.match(body, /<rss/);
});
