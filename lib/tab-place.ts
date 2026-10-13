/**
 * Which tab of a subject something goes on: the one it was put on, by being
 * pasted, written or added there. There is no control for it, and nothing
 * moves between tabs by itself.
 *
 * A subject holds one card per story, so a story already on another tab is
 * not moved here when it is added again: it stays where it is, and the tab
 * that is open gets it as a card set into writing — what pasting a copy of
 * it has always done. Once per tab; adding it again does not pile them up.
 */
import { citeCardHtml, inlineCardLinks } from "./cite";
import { activeTabOf, live, newItemId, placeNew, placeOn, put, tabOf, type Board } from "./subjects";
import { canonicalUrl } from "./url";

/**
 * The board once a story has arrived on the open tab. `wasIn`: whether the
 * subject already held the story before this (a card from a quote counts);
 * for a new story, add it to the board first, then call this.
 */
export function arriveOnTab(
  board: Board | undefined,
  story: { link: string; title: string },
  wasIn: boolean,
  { now = Date.now(), after }: { now?: number; after?: string } = {},
): Board {
  const id = canonicalUrl(story.link);
  if (!wasIn) return placeNew(board, id, now);
  const tab = activeTabOf(board);
  if (tabOf(board, id) === tab) return board ?? {};
  const copied = live(board).some(
    (item) => item.kind === "box" && tabOf(board, item.id) === tab && inlineCardLinks(item.html ?? "").includes(id),
  );
  if (copied) return board ?? {};
  const box = newItemId("box");
  const next = put(board, { id: box, kind: "box", html: `<p>${citeCardHtml(story)}</p>`, ...(after ? { after } : {}), at: now }, now);
  return placeOn(next, box, tab, now);
}
