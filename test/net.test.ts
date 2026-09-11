import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { isPrivateAddress, assertPublicUrl, safeFetchText, BlockedHostError } from "../lib/net";

/**
 * This app fetches URLs on behalf of whoever is using it, and the deployment
 * is public. So every one of these is the difference between a feed reader
 * and an open proxy into the network the deployment sits in.
 *
 * The suite as a whole runs with ALLOW_PRIVATE_HOSTS=1, because the fixtures
 * live on 127.0.0.1 — which is exactly what this blocks. These tests clear it
 * so the guard is actually exercised, and put it back afterwards.
 */
const hatch = process.env.ALLOW_PRIVATE_HOSTS;
test.before(() => {
  delete process.env.ALLOW_PRIVATE_HOSTS;
});
test.after(() => {
  if (hatch !== undefined) process.env.ALLOW_PRIVATE_HOSTS = hatch;
});

test("the addresses that must never be reached are recognised", () => {
  const blocked = [
    "127.0.0.1",
    "0.0.0.0",
    "10.1.2.3",
    "172.16.0.1",
    "172.31.255.255",
    "192.168.1.1",
    "169.254.169.254", // cloud metadata — the one that hands out credentials
    "100.64.0.1", // carrier-grade NAT
    "::1",
    "fd00::1", // unique local
    "fe80::1", // link-local
    "::ffff:127.0.0.1", // IPv4-mapped: the same loopback, spelled differently
    "::ffff:a9fe:a9fe", // and the metadata address, as new URL() rewrites it
    "2002:a9fe:a9fe::1", // 6to4, which embeds the same v4 address
    "64:ff9b::a9fe:a9fe", // NAT64, likewise
  ];
  for (const address of blocked) {
    assert.equal(isPrivateAddress(address), true, `${address} must be blocked`);
  }

  const allowed = ["1.1.1.1", "93.184.216.34", "172.32.0.1", "2606:4700::1111"];
  for (const address of allowed) {
    assert.equal(isPrivateAddress(address), false, `${address} is the public internet`);
  }
});

test("a URL naming an internal address is refused, however it is spelled", async () => {
  const refused = [
    "http://127.0.0.1/",
    "http://localhost:9000/",
    "http://2130706433/", // 127.0.0.1 in decimal
    "http://0x7f000001/", // and in hex
    "http://[::1]/",
    "http://[::ffff:a9fe:a9fe]/", // metadata, as IPv4-mapped IPv6
    "http://169.254.169.254/latest/meta-data/",
    "http://build.internal/status",
    "http://printer.local/",
    "file:///etc/passwd",
    "gopher://example.com/",
  ];

  for (const url of refused) {
    await assert.rejects(
      () => assertPublicUrl(url),
      BlockedHostError,
      `${url} must be refused`,
    );
  }
});

test("a hostname is resolved, not merely read", async () => {
  // A name an attacker controls can point at an internal address as easily as
  // it can be typed; checking the spelling would never see it. localtest.me
  // and its kin resolve to 127.0.0.1 in public DNS, which is the shape of the
  // attack without needing a domain of our own.
  //
  // Asserted on the message, not just the type: an unresolvable name is also
  // refused, and a test that accepted either would pass without the
  // resolution ever happening. This one only passes if the lookup came back
  // with 127.0.0.1 and that address was judged.
  await assert.rejects(
    () => assertPublicUrl("http://127.0.0.1.nip.io/"),
    (error: unknown) =>
      error instanceof BlockedHostError && /not reachable/.test(error.message),
  );
});

test("a redirect into the network is refused at the hop that makes it", async () => {
  // The old check ran once, on the URL that was asked for, and fetch followed
  // redirects on its own — so a public URL that 302s inward was never asked
  // about again. This is that exact path.
  const internal = http.createServer((_req, res) => {
    res.writeHead(200, { "content-type": "text/plain" });
    res.end("INTERNAL-SECRET");
  });
  await new Promise<void>((resolve) => internal.listen(9101, resolve));

  const redirector = http.createServer((_req, res) => {
    res.writeHead(302, { location: "http://127.0.0.1:9101/" });
    res.end();
  });
  await new Promise<void>((resolve) => redirector.listen(9102, resolve));

  try {
    // The first hop has to be allowed for the test to be about the second, so
    // the hatch is on for the entry point and the redirect is what must fail.
    process.env.ALLOW_PRIVATE_HOSTS = "1";
    const direct = await safeFetchText("http://127.0.0.1:9102/");
    assert.equal(direct.body, "INTERNAL-SECRET", "with the hatch on, it follows");

    delete process.env.ALLOW_PRIVATE_HOSTS;
    await assert.rejects(
      () => safeFetchText("http://127.0.0.1:9102/"),
      /not reachable|not a valid|could not be looked up/,
      "with the hatch off, the hop inward is refused",
    );
  } finally {
    delete process.env.ALLOW_PRIVATE_HOSTS;
    internal.close();
    redirector.close();
  }
});

test("a response larger than the cap is cut rather than buffered whole", async () => {
  process.env.ALLOW_PRIVATE_HOSTS = "1";
  // Never ends: the point is that the reader stops, not that the server does.
  const firehose = http.createServer((_req, res) => {
    res.writeHead(200, { "content-type": "text/plain" });
    const chunk = "x".repeat(64 * 1024);
    const pump = () => {
      while (res.write(chunk)) {
        /* until the socket pushes back */
      }
    };
    res.on("drain", pump);
    pump();
  });
  await new Promise<void>((resolve) => firehose.listen(9103, resolve));

  try {
    const result = await safeFetchText("http://127.0.0.1:9103/", {
      maxBytes: 256 * 1024,
      timeoutMs: 20000,
    });
    assert.equal(result.truncated, true);
    assert.ok(
      result.body.length <= 256 * 1024,
      `read ${result.body.length} bytes, cap was ${256 * 1024}`,
    );
  } finally {
    delete process.env.ALLOW_PRIVATE_HOSTS;
    firehose.close();
  }
});

test("a redirect loop ends rather than running forever", async () => {
  process.env.ALLOW_PRIVATE_HOSTS = "1";
  const loop = http.createServer((_req, res) => {
    res.writeHead(302, { location: "http://127.0.0.1:9104/" });
    res.end();
  });
  await new Promise<void>((resolve) => loop.listen(9104, resolve));

  try {
    await assert.rejects(() => safeFetchText("http://127.0.0.1:9104/"), /Too many redirects/);
  } finally {
    delete process.env.ALLOW_PRIVATE_HOSTS;
    loop.close();
  }
});
