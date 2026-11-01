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

const source = (id: string, feedUrl = `https://${id}.example/feed`) => ({ id, feedUrl, title: id }) as never;

test("a source moved to another folder is not put back where it was", () => {
  // The account: "aeon" was moved out of Philosophy into Essays on another device.
  const theirs: Feed[] = [
    { id: "phil", name: "Philosophy", sources: [source("nous")] },
    { id: "essays", name: "Essays", sources: [source("aeon")] },
  ];
  // A device that was closed meanwhile still has it in Philosophy.
  const mine: Feed[] = [
    { id: "phil", name: "Philosophy", sources: [source("nous"), source("aeon")] },
    { id: "essays", name: "Essays", sources: [] },
  ];
  const out = unionFeeds(theirs, mine);
  assert.deepEqual(out.map((f) => f.sources.map((s) => s.id)), [["nous"], ["aeon"]]);
});

test("one source in two folders keeps the folder it was moved to", async () => {
  const { cleanFeeds } = await import("../lib/store");
  // What the merge on every opening left behind: everything sorted out of
  // Philosophy was put back at its end.
  const tangled = [
    { id: "phil", name: "Philosophy", sources: [source("nous"), source("mind"), source("nyt"), source("wired"), source("lancet")] },
    { id: "news", name: "News", sources: [source("nyt"), source("bbc")] },
    { id: "tech", name: "Tech", sources: [source("wired")] },
    { id: "med", name: "Medicine", sources: [source("lancet")] },
  ];
  assert.deepEqual(
    cleanFeeds(tangled).map((f) => [f.name, f.sources.map((s) => s.id)]),
    [["Philosophy", ["nous", "mind"]], ["News", ["nyt", "bbc"]], ["Tech", ["wired"]], ["Medicine", ["lancet"]]],
  );
  // Between two folders holding as many, the copy the merge appended goes.
  const pair = [
    { id: "phil", name: "Philosophy", sources: [source("nous"), source("nyt")] },
    { id: "news", name: "News", sources: [source("nyt"), source("bbc")] },
  ];
  assert.deepEqual(cleanFeeds(pair).map((f) => f.sources.map((s) => s.id)), [["nous"], ["nyt", "bbc"]]);
  // The same outlet added to two folders on purpose is two sources, and stays in both.
  const twice = [
    { id: "phil", name: "Philosophy", sources: [source("aeon-1", "https://aeon.co/feed.rss")] },
    { id: "essays", name: "Essays", sources: [source("aeon-2", "https://aeon.co/feed.rss")] },
  ];
  assert.deepEqual(cleanFeeds(twice).map((f) => f.sources.map((s) => s.id)), [["aeon-1"], ["aeon-2"]]);
});
