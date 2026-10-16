import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { canonicalOf, canonicalUrl, plainCanonical } from "../lib/url";

/** Every link the tests already carry: real publishers' addresses, in their real shapes. */
function linksInTests(): string[] {
  const dir = new URL(".", import.meta.url);
  const found = new Set<string>();
  for (const name of readdirSync(dir)) {
    if (!/\.(ts|mjs|json)$/.test(name)) continue;
    const text = readFileSync(new URL(name, dir), "utf8");
    for (const match of text.matchAll(/https?:\/\/[^\s"'`<>)\]]+/g)) found.add(match[0]);
  }
  return [...found];
}

const EDGES = [
  "https://www.example.com",
  "https://example.com/",
  "http://www.example.com/a/b/",
  "https://example.com/story/amp",
  "https://example.com/story/amp/",
  "https://example.com/story.amp",
  "https://example.com/amp",
  "https://example.com/.amp",
  "https://example.com/a/./b",
  "https://example.com/a/../b",
  "https://example.com/a/..",
  "https://example.com/.well-known/x",
  "https://example.com//double//slash",
  "https://example.com/~user/post",
  "https://example.com/Mixed-Case_Path.html",
  "https://127.0.0.1/a",
  "https://127.1/a",
  "https://0x7f.1/a",
  "https://xn--bcher-kva.example/a",
  "https://EXAMPLE.com/a",
  "https://example.com:443/a",
  "https://example.com/a?utm_source=x",
  "https://example.com/a#top",
  "https://example.com/a%20b",
  " https://example.com/a ",
  "https://a-b.co.uk/2026/10/16/a-long-headline-slug",
  "https://www.www.example.com/a",
  "https://www.com/a",
];

test("a plain link's canonical form is the parser's, character for character", () => {
  const links = [...EDGES, ...linksInTests()];
  let fast = 0;
  for (const link of links) {
    const plain = plainCanonical(link);
    if (plain === null) continue;
    fast += 1;
    assert.equal(plain, canonicalOf(link), link);
  }
  // The fast path is the common case, not a corner of it.
  assert.ok(fast > links.length / 3, `${fast} of ${links.length} took the fast path`);
});

test("random plain links agree with the parser", () => {
  let seed = 7;
  const next = (n: number) => ((seed = (seed * 1103515245 + 12345) % 2 ** 31), seed % n);
  const pick = (chars: string, length: number) => Array.from({ length }, () => chars[next(chars.length)]).join("");
  for (let i = 0; i < 5000; i++) {
    const host = `${next(2) ? "www." : ""}${pick("abc-1", 1 + next(6))}.${pick("comuk", 2 + next(2))}`;
    const path = Array.from({ length: next(5) }, () => pick("aZ0-._~", next(6))).join("/");
    const link = `http${next(2) ? "s" : ""}://${host}${next(3) ? `/${path}` : ""}${next(4) ? "" : "/"}`;
    const plain = plainCanonical(link);
    if (plain !== null) assert.equal(plain, canonicalOf(link), link);
  }
});

test("canonicalUrl answers the same either way", () => {
  assert.equal(canonicalUrl("http://www.example.com/a/b/"), "https://example.com/a/b");
  assert.equal(canonicalUrl("https://example.com/a?utm_source=x&id=2#top"), "https://example.com/a?id=2");
  assert.equal(canonicalUrl("https://example.com/story/amp"), "https://example.com/story");
});
