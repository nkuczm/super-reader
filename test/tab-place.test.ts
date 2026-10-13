import test from "node:test";
import assert from "node:assert/strict";
import { addStory, addTab, cardsOf, live, metaOf, put, tabOf, MAIN_TAB, type Board, type BoxItem } from "../lib/subjects";
import { arriveOnTab } from "../lib/tab-place";
import { inlineCardLinks } from "../lib/cite";
import { canonicalUrl } from "../lib/url";
import type { Note } from "../lib/notes";

const story = { link: "https://example.com/a-story", title: "A story" };
const id = canonicalUrl(story.link);
const note: Note = { id: "n1", name: "Subject", at: 1, entries: [] } as unknown as Note;
const open = (board: Board, tab: string) => put(board, { ...metaOf(board), activeTab: tab });
const copiesOn = (board: Board, tab: string) =>
  live(board).filter((item): item is BoxItem => item.kind === "box" && tabOf(board, item.id) === tab && inlineCardLinks(item.html).includes(id)).length;

test("a new story goes on the tab that is open", () => {
  const { board: withTab, id: research } = addTab({}, "Research");
  const board = arriveOnTab(addStory(withTab, story), story, false);
  assert.equal(tabOf(board, id), research);
});

test("a story already on the open tab stays as it is", () => {
  const board = arriveOnTab(addStory({}, story), story, false);
  const again = arriveOnTab(board, story, true);
  assert.equal(again, board);
});

test("a story on another tab stays there; the open tab gets it as a card in writing, once", () => {
  let board = arriveOnTab(addStory({}, story), story, false);
  assert.equal(tabOf(board, id), MAIN_TAB);
  const made = addTab(board, "Script");
  board = arriveOnTab(made.board, story, true);
  assert.equal(tabOf(board, id), MAIN_TAB, "the original never moves");
  assert.equal(copiesOn(board, made.id), 1, "a card of it on the open tab");
  board = arriveOnTab(board, story, true);
  assert.equal(copiesOn(board, made.id), 1, "adding it again does not pile them up");
  // Back on the first tab, adding it again changes nothing there.
  const back = open(board, MAIN_TAB);
  assert.equal(arriveOnTab(back, story, true), back);
});

test("a story held only by a quote is not moved off its tab when added again elsewhere", () => {
  // Quoted on the first tab: a card from the quote, with no place of its own.
  const quoted: Note = { ...note, entries: [{ id: "q1", kind: "quote", text: "words", link: story.link, articleTitle: story.title, at: 5 }] } as unknown as Note;
  const made = addTab({}, "Script");
  assert.ok(cardsOf(quoted, made.board).some((card) => card.id === id));
  const board = arriveOnTab(made.board, story, true);
  assert.equal(tabOf(board, id), MAIN_TAB);
  assert.equal(copiesOn(board, made.id), 1);
});

test("a card in writing can read right below a block", () => {
  const made = addTab(addStory({}, story), "Script");
  const board = arriveOnTab(made.board, story, true, { after: "box1" });
  const copy = live(board).find((item): item is BoxItem => item.kind === "box" && inlineCardLinks(item.html).includes(id));
  assert.equal(copy?.after, "box1");
});
