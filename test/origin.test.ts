import test from "node:test";
import assert from "node:assert/strict";
import { publicOrigin, sitePath } from "../lib/origin";
import { sameOrigin } from "../lib/secure";
import { redirectUri } from "../lib/google";

// What a self-hosted Next server hands a route behind Cloud Run: its own
// listening address in request.url, the browser's host in the headers.
const cloudRun = (path: string, headers: Record<string, string> = {}) =>
  new Request(`https://0.0.0.0:8080${path}`, {
    headers: { host: "super-reader-123.us-east4.run.app", "x-forwarded-proto": "https", ...headers },
  });

test("behind Cloud Run, the address is the browser's, not the server's", () => {
  assert.equal(publicOrigin(cloudRun("/api/auth/google")), "https://super-reader-123.us-east4.run.app");
  assert.equal(redirectUri(cloudRun("/api/auth/google")), "https://super-reader-123.us-east4.run.app/api/auth/callback");
  assert.equal(sitePath(cloudRun("/api/auth/callback"), "/?signedin=1").href, "https://super-reader-123.us-east4.run.app/?signedin=1");
});

test("on Vercel, its forwarded host still wins", () => {
  const vercel = new Request("https://super-reader-wine.vercel.app/api/auth/google", {
    headers: { host: "internal.vercel", "x-forwarded-host": "super-reader-wine.vercel.app", "x-forwarded-proto": "https" },
  });
  assert.equal(redirectUri(vercel), "https://super-reader-wine.vercel.app/api/auth/callback");
});

test("on a plain next start, the request's own address", () => {
  assert.equal(publicOrigin(new Request("http://localhost:3100/x", { headers: { host: "localhost:3100" } })), "http://localhost:3100");
});

test("a save from the site's own page is same-site behind Cloud Run; one from elsewhere is not", () => {
  assert.equal(sameOrigin(cloudRun("/api/subjects", { origin: "https://super-reader-123.us-east4.run.app" })), true);
  assert.equal(sameOrigin(cloudRun("/api/subjects", { origin: "https://evil.example" })), false);
});
