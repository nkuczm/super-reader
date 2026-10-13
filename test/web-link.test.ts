import test from "node:test";
import assert from "node:assert/strict";
import { webLink } from "../lib/subjects";

test("a pasted link is kept as itself, not escaped for HTML", () => {
  assert.equal(webLink("https://example.com/a?x=1&y=2"), "https://example.com/a?x=1&y=2");
  assert.equal(webLink("  https://example.com/a  "), "https://example.com/a");
  assert.equal(webLink("example.com/a-story"), "https://example.com/a-story");
  assert.equal(webLink("javascript:alert(1)"), null);
  assert.equal(webLink("not a link"), null);
  assert.equal(webLink("notes"), null);
  assert.equal(webLink(""), null);
});
