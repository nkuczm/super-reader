import test from "node:test";
import assert from "node:assert/strict";
import { cardsOf, retitleCards, type Board } from "../lib/subjects";

const note = {
  id: "n1", name: "S", at: 1, updatedAt: 1,
  entries: [{ id: "q1", kind: "quote" as const, text: "A line", link: "https://n.example/story?utm_source=x", articleTitle: "n.example/story", at: 1 }],
};
const board: Board = {
  s2: { id: "s2", kind: "story", link: "https://other.example/b", title: "Other story", at: 2 },
} as Board;

test("a card filed under a placeholder headline takes the article's own, by canonical link", () => {
  const next = retitleCards(note, board, ["https://n.example/story"], { title: "  City council approves   rezoning plan ", author: "Jane Doe", source: "Example News" });
  const cards = cardsOf(note, next);
  assert.equal(cards.find((c) => c.link.startsWith("https://n.example"))?.title, "City council approves rezoning plan");
  assert.equal(cards.find((c) => c.link.startsWith("https://n.example"))?.author, "Jane Doe");
  assert.equal(cards.find((c) => c.link.startsWith("https://other"))?.title, "Other story");
});

test("nothing to change leaves the board as it was", () => {
  const once = retitleCards(note, board, ["https://n.example/story"], { title: "City council approves rezoning plan" });
  assert.equal(retitleCards(note, once, ["https://n.example/story"], { title: "City council approves rezoning plan" }), once);
  assert.equal(retitleCards(note, board, ["https://elsewhere.example/x"], { title: "Anything" }), board);
  assert.equal(retitleCards(note, board, ["https://n.example/story"], { title: "   " }), board);
});

test("details learned earlier are kept; only what was missing is filled", () => {
  const withInfo = { ...board, "cardinfo:https://n.example/story": { id: "cardinfo:https://n.example/story", kind: "cardinfo", card: "https://n.example/story", author: "Earlier Author", at: 1 } } as Board;
  const next = retitleCards(note, withInfo, ["https://n.example/story"], { title: "New title", author: "Someone Else", source: "Example" });
  const card = cardsOf(note, next).find((c) => c.link.startsWith("https://n.example"))!;
  assert.equal(card.title, "New title");
  assert.equal(card.author, "Earlier Author");
  assert.equal(card.source, "Example");
});
