import test from "node:test";
import assert from "node:assert/strict";
import { dragGroup, type BlockKind } from "../lib/drag-group";

// A hub (300), two satellites (170, 170), a tiny node (100) off one satellite,
// stories hanging from each node, and a section label with a story.
const kinds: Record<string, BlockKind> = {
  hub: "node", satA: "node", satB: "node", tiny: "node", twin: "node",
  hubStory: "block", satAStory: "block", tinyStory: "block",
  section: "label", sectionStory: "block",
};
const sizes: Record<string, number> = { hub: 300, satA: 170, satB: 170, tiny: 100, twin: 170 };
const links = [
  ["hub", "satA"], ["hub", "satB"], ["satA", "tiny"], ["satA", "twin"],
  ["hub", "hubStory"], ["satA", "satAStory"], ["tiny", "tinyStory"],
  ["section", "sectionStory"],
].map(([from, to]) => ({ from, to }));
const group = (...ids: string[]) => [...dragGroup(ids, links, (id) => kinds[id], (id) => sizes[id] ?? 0)].sort();

test("a big node carries the smaller nodes linked to it, and what hangs from them", () => {
  assert.deepEqual(group("hub"), ["hub", "hubStory", "satA", "satAStory", "satB", "tiny", "tinyStory"]);
});

test("a node smaller than its connections moves no node, only its own stories", () => {
  assert.deepEqual(group("tiny"), ["tiny", "tinyStory"]);
});

test("a node carries smaller nodes but not one its own size, nor a bigger one", () => {
  // satA: bigger than tiny (carried), the same as twin (left), smaller than hub (left).
  assert.deepEqual(group("satA"), ["satA", "satAStory", "tiny", "tinyStory"]);
});

test("a section label still carries what is linked to it", () => {
  assert.deepEqual(group("section"), ["section", "sectionStory"]);
});

test("a story dragged on its own moves alone", () => {
  assert.deepEqual(group("hubStory"), ["hubStory"]);
});
