import test from "node:test";
import assert from "node:assert/strict";
import { isPrivateHost, refuseUrl, fetchPublic, BlockedUrlError } from "../lib/net-guard";
import { GET as download } from "../app/api/download/route";
import { GET as article } from "../app/api/article/route";
import { GET as discover } from "../app/api/discover/route";
import { GET as feed } from "../app/api/feed/route";
import { createServer } from "node:http";

test("names on the private network are refused", () => {
  for (const host of [
    "localhost", "app.localhost", "printer.local", "db.internal", "router.home.arpa",
    "127.0.0.1", "10.1.2.3", "172.16.0.1", "192.168.1.1", "169.254.169.254", "100.100.100.200",
    "0.0.0.0", "[::1]", "::", "[fd00::1]", "fe80::1", "::ffff:7f00:1", "::ffff:a9fe:a9fe", "::ffff:127.0.0.1",
  ]) {
    assert.ok(isPrivateHost(host), `${host} is private`);
  }
  for (const host of ["example.com", "8.8.8.8", "172.32.0.1", "100.128.0.1", "2606:4700::1111", "fcbarcelona.com"]) {
    assert.ok(!isPrivateHost(host), `${host} is public`);
  }
});

test("the URL parser's own spellings of loopback are caught", () => {
  // new URL turns all of these into a private address before we see it.
  for (const raw of ["http://2130706433/", "http://0x7f.1/", "http://[::ffff:127.0.0.1]/", "http://LOCALHOST./"]) {
    assert.equal(refuseUrl(raw), "That host is not reachable", raw);
  }
  assert.equal(refuseUrl("file:///etc/passwd"), "Unsupported URL scheme");
  assert.equal(refuseUrl("https://example.com/feed"), null);
});

test("routes refuse private addresses", async () => {
  delete process.env.ALLOW_PRIVATE_HOSTS;
  const at = (path: string) => new Request(`http://app.test${path}`);
  const metadata = encodeURIComponent("http://169.254.169.254/latest/meta-data/");
  assert.equal((await download(at(`/api/download?url=${metadata}`))).status, 400);
  assert.equal((await article(at(`/api/article?url=${metadata}`))).status, 400);
  assert.equal((await discover(at(`/api/discover?q=${metadata}`))).status, 400);
  assert.equal((await discover(at(`/api/discover?q=${encodeURIComponent("localhost:3000/feed")}`))).status, 400);
  const res = await feed(at(`/api/feed?url=${metadata}`));
  const body = await res.json();
  assert.match(JSON.stringify(body), /not reachable/);
});

test("a redirect onto the private network is not followed", async () => {
  delete process.env.ALLOW_PRIVATE_HOSTS;
  const server = createServer((_, res) => {
    res.writeHead(302, { location: "http://169.254.169.254/latest/meta-data/" });
    res.end();
  });
  await new Promise<void>((resolve) => server.listen(8797, "127.0.0.1", resolve));
  try {
    // The fixture itself is on loopback; let that one address through and
    // judge every other hop as the app would.
    const fixtureOnly = (url: URL) => (url.host === "127.0.0.1:8797" ? null : refuseUrl(url));
    await assert.rejects(fetchPublic("http://127.0.0.1:8797/", {}, fixtureOnly), BlockedUrlError);
  } finally {
    server.close();
  }
});
