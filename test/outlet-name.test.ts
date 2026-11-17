import test from "node:test";
import assert from "node:assert/strict";
import { outletByName } from "../lib/outlets";

test("a publication typed by its name is the publication, not a search for its words", () => {
  assert.equal(outletByName("The New Atlantis")?.feedUrl, "https://www.thenewatlantis.com/feed");
  assert.equal(outletByName("new atlantis")?.id, "newatlantis");
  assert.equal(outletByName("  the new atlantis ")?.id, "newatlantis");
});

test("one word stays a topic unless typed as a title, and unknown names are left alone", () => {
  assert.equal(outletByName("science"), null);
  assert.equal(outletByName("deadline"), null);
  assert.equal(outletByName("artificial intelligence"), null);
  assert.equal(outletByName("ai"), null);
});
