import test from "node:test";
import assert from "node:assert/strict";
import { unionFeeds, type Feed } from "../lib/store";

const src = (id: string) => ({ id, url: `https://${id}.com/rss`, name: id }) as never;

test("a device joining a code keeps the code's feeds, adding only what it alone has", () => {
  const theirs: Feed[] = [{ id: "a", name: "News", sources: [src("x"), src("y")] }, { id: "b", name: "Tech", sources: [src("z")] }];
  const mine: Feed[] = [{ id: "a", name: "News", sources: [src("y"), src("new")] }, { id: "c", name: "Mine", sources: [src("m")] }];
  const out = unionFeeds(theirs, mine);
  assert.deepEqual(out.map((f) => f.id), ["a", "b", "c"]);
  assert.deepEqual(out[0].sources.map((s) => s.id), ["x", "y", "new"]);
  assert.deepEqual(unionFeeds(theirs, []), theirs, "an empty device changes nothing");
});
