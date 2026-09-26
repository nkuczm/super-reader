import test from "node:test";
import assert from "node:assert/strict";
import {
  prune,
  positionFor,
  rememberPosition,
  forgetPosition,
  MIN_FRACTION,
  DONE_FRACTION,
} from "../lib/position";

// localStorage for the parts that read and write it — read at call time,
// so defining it after the import is enough.
const memory = new Map<string, string>();
(globalThis as any).window = {
  localStorage: {
    getItem: (k: string) => memory.get(k) ?? null,
    setItem: (k: string, v: string) => void memory.set(k, v),
  },
};

test("a place part-way through comes back", () => {
  rememberPosition("https://a.example/story", 0.42);
  assert.equal(positionFor("https://a.example/story"), 0.42);
});

test("the opening lines and the end are not places worth returning to", () => {
  rememberPosition("https://a.example/start", MIN_FRACTION / 2);
  assert.equal(positionFor("https://a.example/start"), null);

  // Reading to the end clears a place saved earlier: a finished story reopens
  // at its headline, not at its last paragraph.
  rememberPosition("https://a.example/done", 0.5);
  rememberPosition("https://a.example/done", DONE_FRACTION + 0.01);
  assert.equal(positionFor("https://a.example/done"), null);
});

test("starting from the top forgets the place", () => {
  rememberPosition("https://a.example/again", 0.6);
  forgetPosition("https://a.example/again");
  assert.equal(positionFor("https://a.example/again"), null);
});

test("a place two months old is let go", () => {
  const now = Date.UTC(2026, 8, 26);
  rememberPosition("https://a.example/old", 0.5, now - 61 * 24 * 3_600_000);
  assert.equal(positionFor("https://a.example/old", now), null);
});

test("the store stays bounded, newest kept", () => {
  const now = Date.UTC(2026, 8, 26);
  const many = Object.fromEntries(
    Array.from({ length: 450 }, (_, i) => [`u${i}`, { fraction: 0.5, at: now - i }]),
  );
  const kept = prune(many, now);
  assert.equal(Object.keys(kept).length, 400);
  assert.ok("u0" in kept && !("u449" in kept));
});
