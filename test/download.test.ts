import test from "node:test";
import assert from "node:assert/strict";
import { startFileSite } from "./fixtures.mjs";
import { GET } from "../app/api/download/route";
import { downloadUrlFor } from "../lib/download";

let site: { close: () => void };
const BASE = "http://localhost:8796";

test.before(async () => {
  site = await startFileSite(8796);
});
test.after(() => site.close());

const call = (query: string) => GET(new Request(`http://app.test/api/download?${query}`));

test("hands a PDF over as a download rather than a page", async () => {
  const res = await call(`url=${encodeURIComponent(`${BASE}/notice.pdf`)}`);
  assert.equal(res.status, 200);
  assert.equal(res.headers.get("content-type"), "application/pdf");
  // The disposition is what makes "Download" mean download: a cross-origin
  // <a download> is ignored by browsers, so the app routes the bytes through
  // here instead.
  const disposition = res.headers.get("content-disposition") ?? "";
  assert.match(disposition, /^attachment;/);
  assert.match(disposition, /filename="notice\.pdf"/);
  assert.equal(res.headers.get("x-content-type-options"), "nosniff");
  const bytes = new Uint8Array(await res.arrayBuffer());
  assert.ok(bytes.byteLength > 0, "the file has content");
  assert.equal(new TextDecoder().decode(bytes.slice(0, 4)), "%PDF");
});

test("names the file the reader sees, not the one the URL happens to have", async () => {
  const res = await call(
    `url=${encodeURIComponent(`${BASE}/notice.pdf`)}&name=${encodeURIComponent("EPA notice “final”.pdf")}`,
  );
  const disposition = res.headers.get("content-disposition") ?? "";
  // A quote or a newline in a header would break it, or worse; curly quotes
  // survive only in the RFC 5987 form.
  assert.ok(!disposition.includes("“"), "the ASCII form is sanitised");
  assert.match(disposition, /filename\*=UTF-8''EPA%20notice/);
});

test("carries the other text formats too", async () => {
  for (const [path, type] of [
    ["/rows.csv", "text/csv; charset=utf-8"],
    ["/readme.txt", "text/plain; charset=utf-8"],
  ] as const) {
    const res = await call(`url=${encodeURIComponent(`${BASE}${path}`)}`);
    assert.equal(res.status, 200, path);
    assert.equal(res.headers.get("content-type"), type, path);
  }
});

test("refuses to be a general-purpose proxy", async () => {
  // Echoing a publisher's content type would let this endpoint serve HTML —
  // and so script — from the app's own origin.
  const page = await call(`url=${encodeURIComponent("http://localhost:8796/rss")}`);
  assert.equal(page.status, 415);

  // Nothing but the public web: no file://, no data:, nothing internal.
  for (const bad of ["file:///etc/passwd", "data:text/html,<script>alert(1)</script>"]) {
    const res = await call(`url=${encodeURIComponent(bad)}`);
    assert.equal(res.status, 400, bad);
  }

  assert.equal((await call("")).status, 400);
  assert.equal((await call("url=not-a-url")).status, 400);
});

test("reports a file it cannot fetch instead of an empty download", async () => {
  const res = await call(`url=${encodeURIComponent(`${BASE}/missing.pdf`)}`);
  assert.equal(res.status, 502);
  assert.match((await res.json()).error, /could not be fetched/i);
});

test("builds the link the app uses", () => {
  assert.equal(
    downloadUrlFor("https://example.com/a b.pdf", "A notice.pdf"),
    "/api/download?url=https%3A%2F%2Fexample.com%2Fa+b.pdf&name=A+notice.pdf",
  );
  assert.equal(downloadUrlFor("https://example.com/x.pdf"), "/api/download?url=https%3A%2F%2Fexample.com%2Fx.pdf");
});
