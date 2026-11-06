import test from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { keyOpens } from "../lib/key-check";
import { seal } from "../lib/secure";

const saved = randomBytes(32);
const other = randomBytes(32);

test("the key the data was saved with opens it", () => {
  assert.equal(keyOpens([seal("subjects", saved)], saved), true);
});

test("a different key opens nothing, so accounts stay off", () => {
  assert.equal(keyOpens([seal("subjects", saved), seal("prefs", saved)], other), false);
  assert.equal(keyOpens([seal("subjects", saved)], null), false);
});

test("one value it opens is enough: a row from a later key rotation does not lock it out", () => {
  assert.equal(keyOpens([seal("old", other), seal("new", saved)], saved), true);
});

test("a database with nothing sealed in it yet passes", () => {
  assert.equal(keyOpens([], saved), true);
});
