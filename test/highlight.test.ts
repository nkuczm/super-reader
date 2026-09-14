import test from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { findQuoteRange } from "../lib/highlight";
import { cleanQuoteText } from "../lib/notes";

function bodyOf(html: string) {
  const dom = new JSDOM(`<body><div class="prose">${html}</div></body>`);
  // The DOM APIs the finder uses are the document's own, not a global.
  return dom.window.document.querySelector(".prose")!;
}

test("finds a quote that sits inside one paragraph", () => {
  const root = bodyOf("<p>Before it.</p><p>The court held that the rule stands.</p>");
  const range = findQuoteRange(root, "The court held that the rule stands.");
  assert.ok(range);
  assert.equal(range.toString(), "The court held that the rule stands.");
});

test("finds a quote whose whitespace the page breaks differently", () => {
  // What a publisher's HTML really looks like once indented and wrapped.
  const root = bodyOf(`<p>
      The court held
      that the rule stands.
   </p>`);
  const range = findQuoteRange(root, "The court held that the rule stands.");
  assert.ok(range);
  assert.equal(range.toString().replace(/\s+/g, " "), "The court held that the rule stands.");
});

test("finds a quote that runs through a link and an italic", () => {
  const root = bodyOf(
    "<p>The court <a href='/x'>held</a> that the <em>rule</em> stands.</p>",
  );
  const range = findQuoteRange(root, "court held that the rule stands");
  assert.ok(range);
  assert.equal(range.toString().replace(/\s+/g, " "), "court held that the rule stands");
});

test("finds a quote spanning two paragraphs, as the note stored it", () => {
  const root = bodyOf("<p>First paragraph here.</p><p>Second paragraph here.</p>");
  // Stored with the blank line between paragraphs that cleanQuoteText keeps.
  const stored = cleanQuoteText("First paragraph here.\n\nSecond paragraph here.");
  const range = findQuoteRange(root, stored);
  assert.ok(range);
  // The DOM itself has no whitespace between the two <p>s, so the range's
  // own text has none either — the point is that it covers both of them.
  assert.equal(
    range.toString().replace(/\s+/g, " ").trim(),
    "First paragraph here.Second paragraph here.",
  );
});

test("an article edited since still jumps to the opening of the quote", () => {
  const root = bodyOf(
    "<p>The court held that the rule stands, subject to a correction added later.</p>",
  );
  const range = findQuoteRange(
    root,
    "The court held that the rule stands, and said so in terms that left little room for argument.",
  );
  assert.ok(range);
  assert.ok(range.toString().startsWith("The court held that the rule stands"));
});

test("a quote that is not in this copy at all finds nothing", () => {
  const root = bodyOf("<p>Something else entirely, about another matter.</p>");
  assert.equal(
    findQuoteRange(root, "The court held that the rule stands, at some length."),
    null,
  );
});

test("too short a quote is not guessed at", () => {
  const root = bodyOf("<p>Something else entirely.</p>");
  assert.equal(findQuoteRange(root, "the rule"), null);
  assert.equal(findQuoteRange(root, ""), null);
  assert.equal(findQuoteRange(null, "anything"), null);
});
