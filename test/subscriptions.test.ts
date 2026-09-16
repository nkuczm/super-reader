import test from "node:test";
import assert from "node:assert/strict";
import { startPaperSite } from "./fixtures.mjs";
import { extractArticle } from "../lib/article";
import {
  credentialFor,
  isPaywalled,
  knownRefusal,
  normaliseHost,
  subscriptionsIn,
  tidyCookie,
} from "../lib/subscriptions";

const vault = {
  "openai-key": "sk-not-a-subscription",
  "sub:wsj.com": "session=paid; region=us",
  "sub:graphics.wsj.com": "session=graphics",
  "sub:ft.com": "ft=abc",
};

test("a credential goes to the site it was stored for, and no other", () => {
  assert.equal(credentialFor("https://www.wsj.com/articles/one", vault)?.cookie,
    "session=paid; region=us", "www is the same paper");
  assert.equal(credentialFor("https://wsj.com/articles/one", vault)?.host, "wsj.com");

  // The dot matters. Without it a WSJ cookie would be handed to a stranger.
  assert.equal(credentialFor("https://notwsj.com/articles/one", vault), null);
  assert.equal(credentialFor("https://wsj.com.evil.example/x", vault), null);
  assert.equal(credentialFor("https://nytimes.com/x", vault), null);
});

test("the most specific stored site wins", () => {
  const found = credentialFor("https://graphics.wsj.com/chart", vault);
  assert.equal(found?.host, "graphics.wsj.com");
  assert.equal(found?.cookie, "session=graphics");
});

test("api keys in the same vault are not mistaken for subscriptions", () => {
  assert.deepEqual(
    subscriptionsIn(vault).map((entry) => entry.host),
    ["ft.com", "graphics.wsj.com", "wsj.com"],
  );
});

test("a pasted cookie is tidied rather than refused", () => {
  assert.equal(tidyCookie("  Cookie: a=1; b=2  "), "a=1; b=2");
  assert.equal(tidyCookie('"a=1; b=2"'), "a=1; b=2");
  assert.equal(tidyCookie("a=1\nb=2\n"), "a=1; b=2");
  assert.equal(normaliseHost("https://www.WSJ.com/markets"), "wsj.com");
  assert.equal(normaliseHost(""), "");
});

test("reads the publisher's own statement that a copy is walled", () => {
  const walled = `<script type="application/ld+json">
    {"@type":"NewsArticle","isAccessibleForFree":"False"}</script>`;
  const free = `<script type="application/ld+json">
    {"@type":"NewsArticle","isAccessibleForFree":"True"}</script>`;
  const nested = `<script type="application/ld+json">
    {"@graph":[{"@type":"WebPage"},{"@type":"NewsArticle","isAccessibleForFree":false}]}</script>`;
  const partial = `<script type="application/ld+json">
    {"@type":"NewsArticle","isAccessibleForFree":true,
     "hasPart":{"@type":"WebPageElement","isAccessibleForFree":false}}</script>`;

  assert.equal(isPaywalled(walled), true);
  assert.equal(isPaywalled(free), false, "a free article is not a wall");
  assert.equal(isPaywalled(nested), true, "inside @graph");
  assert.equal(isPaywalled(partial), true, "a walled section is still a wall");
  assert.equal(isPaywalled("<html><body>No structured data here</body></html>"), false);
});

test("the subscription cookie reaches the publisher, and the wall lifts", async () => {
  const site = await startPaperSite(8793);
  try {
    const anonymous = await extractArticle("http://127.0.0.1:8793/story");
    assert.equal(anonymous.paywalled, true, "the stub is recognised as one");
    assert.ok(anonymous.wordCount < 60, "and it is short");

    const subscriber = await extractArticle("http://127.0.0.1:8793/story", {
      cookie: "session=paid",
    });
    assert.equal(subscriber.paywalled, undefined, "the full copy is not walled");
    assert.ok(subscriber.wordCount > 150, "and it is the whole story");

    assert.deepEqual(site.seen, [null, "session=paid"], "sent only when stored");
  } finally {
    site.close();
  }
});

test("a site measured as refusing a server fetch says so up front", () => {
  // Measured 16 Sep 2026 from the deployment: nytimes.com serves its homepage
  // to us and 403s every article, under five different header shapes. The
  // refusal lands before a cookie is read, so "your sign-in expired" would be
  // the wrong thing to tell someone — hence a named refusal.
  assert.match(knownRefusal("nytimes.com") ?? "", /refuses article requests/);
  assert.match(knownRefusal("www.nytimes.com") ?? "", /403/);
  assert.equal(knownRefusal("cooking.nytimes.com") !== null, true, "and its subdomains");

  // Not a guess about publishers in general: only what has been measured.
  assert.equal(knownRefusal("ft.com"), null);
  assert.equal(knownRefusal("wsj.com"), null);
  assert.equal(knownRefusal("notnytimes.com"), null, "matched on a dot boundary");
});
