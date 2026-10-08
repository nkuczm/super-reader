import test from "node:test";
import assert from "node:assert/strict";
import { contactRoster, initialsOf, sectionMembers, tagOrder, taggedWith, withTags, type Board, type ContactItem } from "../lib/subjects";

const person = (name: string, extra: Partial<ContactItem> = {}): ContactItem => ({
  id: `contact:${name.toLowerCase().replace(/\s+/g, "-")}`, kind: "contact", name, role: "", why: "", refs: [], origin: "you", state: "kept", at: 1, ...extra,
});

const board: Board = {
  l1: { id: "l1", kind: "box", label: true, html: "Housing", at: 1 },
  b1: { id: "b1", kind: "box", html: "<p>Notes</p>", at: 1 },
  b2: { id: "b2", kind: "box", html: "<p>More</p>", at: 1 },
  l2: { id: "l2", kind: "box", label: true, html: "Other", at: 1 },
  k1: { id: "k1", kind: "link", from: "l1", to: "b1", at: 1 },
  k2: { id: "k2", kind: "link", from: "https://n.example/c1", to: "l1", at: 1 },
  k3: { id: "k3", kind: "link", from: "l1", to: "l2", at: 1 },
} as Board;

test("a section's members are what is linked to its label, other labels aside", () => {
  assert.deepEqual(sectionMembers(board, "l1").sort(), ["b1", "https://n.example/c1"]);
});

test("a tagged label stands for everything filed under it; a tagged block for itself", () => {
  assert.deepEqual([...taggedWith(board, { tagged: ["l1"] })].sort(), ["b1", "https://n.example/c1", "l1"]);
  assert.deepEqual([...taggedWith(board, { tagged: ["b2"] })], ["b2"]);
  assert.equal(taggedWith(board, undefined).size, 0);
});

test("tagging adds and removes blocks, keeps a suggestion, and stamps when", () => {
  const suggested = person("Ana Ruiz", { origin: "suggested", state: "pending" });
  const tagged = withTags(suggested, ["b1", "b2"], true, 500);
  assert.deepEqual(tagged.tagged, ["b1", "b2"]);
  assert.equal(tagged.state, "kept");
  assert.equal(tagged.taggedAt, 500);
  const untagged = withTags(tagged, ["b1"], false, 600);
  assert.deepEqual(untagged.tagged, ["b2"]);
  assert.equal(untagged.taggedAt, 500, "untagging does not count as tagging lately");
});

test("the people tagged most recently are offered first", () => {
  const roster = [person("A One"), person("B Two", { taggedAt: 10 }), person("C Three"), person("D Four", { taggedAt: 30 })];
  assert.deepEqual(tagOrder(roster).map((c) => c.name), ["D Four", "B Two", "A One", "C Three"]);
});

test("the roster includes the stories' authors, and keeps an author's stored tags", () => {
  const cards = [{ id: "c1", author: "Jane Doe", source: "Example" }];
  const stored = person("Jane Doe", { origin: "story", tagged: ["b1"] });
  const roster = contactRoster([stored, person("Sam Lee")], cards, []);
  assert.deepEqual(roster.map((c) => c.name), ["Jane Doe", "Sam Lee"]);
  assert.deepEqual(roster[0].tagged, ["b1"]);
  assert.deepEqual(contactRoster([], cards, ["contact:jane-doe"]), []);
});

test("initials", () => {
  assert.equal(initialsOf("maria lopez garcia"), "ML");
  assert.equal(initialsOf("Cher"), "C");
  assert.equal(initialsOf("  "), "?");
});
