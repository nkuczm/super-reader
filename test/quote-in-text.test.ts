import test from "node:test";
import assert from "node:assert/strict";
import { addQuoteNote, boxesLinking, cardsOf, placeQuoteInText, put, quoteNotesFor, quoteUnderLink, removeQuoteFromText, type Board } from "../lib/subjects";
import type { Note } from "../lib/notes";

const LINK = "https://www.example.com/news/story?utm_source=feed";
const HREF = "https://example.com/news/story";
const quote = { id: "q1", text: "The council voted 7-2 to close the plant." };
const bullet = (id = "q1", text = quote.text) => `<li><a data-quote="${id}">“${text}”</a></li>`;

test("a quote goes under a linked line, after the bullets already under it", () => {
  const html = `<p>See <a href="${HREF}">the vote</a> today.</p><ul><li>First point</li><li>Second point</li></ul><p>Next</p>`;
  assert.equal(
    quoteUnderLink(html, LINK, quote),
    `<p>See <a href="${HREF}">the vote</a> today.</p><ul><li>First point</li><li>Second point</li>${bullet()}</ul><p>Next</p>`,
  );
});

test("a linked line with nothing under it gets a list of its own, before what follows", () => {
  const html = `<p>See <a data-link="chip" href="${HREF}">the vote</a></p><p>Next</p>`;
  assert.equal(quoteUnderLink(html, LINK, quote), `<p>See <a data-link="chip" href="${HREF}">the vote</a></p><ul>${bullet()}</ul><p>Next</p>`);
});

test("a link in a bullet: the quote is one level under that bullet, after its own sub-bullets", () => {
  const html = `<ul><li>Vote: <a href="${HREF}">story</a><ul><li>Earlier note</li></ul></li><li>Other</li></ul>`;
  assert.equal(
    quoteUnderLink(html, LINK, quote),
    `<ul><li>Vote: <a href="${HREF}">story</a><ul><li>Earlier note</li>${bullet()}</ul></li><li>Other</li></ul>`,
  );
  const bare = `<ul><li>Vote: <a href="${HREF}">story</a></li><li>Other</li></ul>`;
  assert.equal(quoteUnderLink(bare, LINK, quote), `<ul><li>Vote: <a href="${HREF}">story</a><ul>${bullet()}</ul></li><li>Other</li></ul>`);
});

test("a link in a plain line of text: the list goes at that line's end, not the writing's", () => {
  const html = `Intro <a href="${HREF}">the vote</a><br>Another line`;
  assert.equal(quoteUnderLink(html, LINK, quote), `Intro <a href="${HREF}">the vote</a><br><ul>${bullet()}</ul>Another line`);
  assert.equal(quoteUnderLink(`<a href="${HREF}">the vote</a>`, LINK, quote), `<a href="${HREF}">the vote</a><ul>${bullet()}</ul>`);
});

test("only a link to the story counts — not a quote, and not another story", () => {
  assert.equal(quoteUnderLink(`<p><a href="https://example.com/other">x</a></p>`, LINK, quote), null);
  assert.equal(quoteUnderLink(`<ul>${bullet("q0")}</ul>`, LINK, quote), null);
});

const note = (quotes: { id: string; inText?: boolean }[]): Note =>
  ({
    id: "n",
    name: "Subject",
    at: 1,
    entries: quotes.map((q) => ({ id: q.id, kind: "quote", text: quote.text, link: LINK, articleTitle: "The vote", at: 2, ...(q.inText ? { inText: true } : {}) })),
  }) as unknown as Note;

test("filed in the writing: no card, and a note typed after it nests under it", () => {
  let board: Board = put({}, { id: "box:old", kind: "box", html: `<p><a href="${HREF}">vote</a></p>`, at: 10 }, 10);
  board = put(board, { id: "box:new", kind: "box", html: `<p>Notes on <a href="${HREF}">the vote</a></p><ul><li>Mine</li></ul>`, at: 20 }, 20);
  board = put(board, { id: "box:label", kind: "box", label: true, html: `<a href="${HREF}">vote</a>`, at: 30 }, 30);
  assert.deepEqual(boxesLinking(board, LINK).map((b) => b.id), ["box:new", "box:old"]);

  const placed = placeQuoteInText(board, LINK, quote, 40)!;
  assert.equal(placed.boxId, "box:new");
  const box = placed.board["box:new"] as { html: string };
  assert.equal(box.html, `<p>Notes on <a href="${HREF}" target="_blank" rel="noopener noreferrer">the vote</a></p><ul><li>Mine</li>${bullet()}</ul>`);

  const subject = note([{ id: "q1", inText: true }]);
  assert.deepEqual(cardsOf(subject, placed.board), [], "the story does not become a card");

  const noted = addQuoteNote(subject, placed.board, "q1", "<p>Check the minutes</p><p>Ask the union</p>", 50);
  assert.match((noted["box:new"] as { html: string }).html, new RegExp(`${bullet().slice(0, -5)}<ul><li>Check the minutes</li><li>Ask the union</li></ul></li></ul>$`));
  assert.deepEqual(quoteNotesFor(subject, noted, "q1"), ["Check the minutes", "Ask the union"]);
  assert.equal(placeQuoteInText({}, LINK, quote), null, "nothing links to it: it goes on a card as before");
});

test("a quote moved to another subject leaves the writing it was filed in as it was", () => {
  const before = `<p>Notes on <a href="${HREF}" target="_blank" rel="noopener noreferrer">the vote</a></p>`;
  const board: Board = put({}, { id: "box", kind: "box", html: before, at: 1 }, 1);
  const placed = placeQuoteInText(board, LINK, quote, 2)!.board;
  assert.notEqual((placed.box as { html: string }).html, before);
  assert.equal((removeQuoteFromText(placed, "q1", 3).box as { html: string }).html, before);
  // Other bullets under the link stay.
  const kept: Board = put({}, { id: "box", kind: "box", html: `<p><a href="${HREF}">v</a></p><ul><li>Mine</li></ul>`, at: 1 }, 1);
  const withQuote = placeQuoteInText(kept, LINK, quote, 2)!.board;
  assert.match((removeQuoteFromText(withQuote, "q1", 3).box as { html: string }).html, /<ul><li>Mine<\/li><\/ul>$/);
});
