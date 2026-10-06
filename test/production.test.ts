import test from "node:test";
import assert from "node:assert/strict";
import { prepHtml, productionOf, putProduction, shotlistGrid } from "../lib/production";
import { live, posId, type BoxItem } from "../lib/subjects";

const shot = { row: 2, type: "Close-up", description: "Hands <typing>", talent: ["Presenter"], props: ["Laptop", "Mug"], location: "Studio" };

test("the shot list is a header and one tickable row per shot, tied to its script line", () => {
  const grid = shotlistGrid([shot], [{ row: 2, text: "She opens the laptop and begins." }]);
  assert.equal(grid.length, 2);
  assert.equal(grid[0][0], "Shot");
  assert.equal(grid[1][0], '<ul data-check=""><li>1</li></ul>');
  assert.match(grid[1][1], /Row 2.*She opens the laptop/);
  assert.equal(grid[1][3], "Hands &lt;typing&gt;");
  assert.equal(grid[1][5], "Laptop, Mug");
});

test("prep groups needs under headings as checklists, in a fixed order", () => {
  const html = prepHtml([
    { category: "Props & items", item: "Laptop", detail: "Unbranded", rows: [2, 5] },
    { category: "Studio & locations", item: "Studio A", detail: "", rows: [] },
  ]);
  assert.ok(html.indexOf("Studio &amp; locations") < html.indexOf("Props &amp; items") || html.indexOf("Studio & locations") < html.indexOf("Props & items"));
  assert.match(html, /<ul data-check=""><li><b>Laptop<\/b> — Unbranded <i>\(rows 2, 5\)<\/i><\/li><\/ul>/);
  assert.match(prepHtml([]), /Nothing to prepare/);
});

test("both lists go beside the script, linked to it, and are replaced on a second run", () => {
  let n = 0;
  const id = () => `b${++n}`;
  const board = { s: { id: "s", kind: "box", html: "", table: [["a"]], at: 1 }, [posId("s")]: { id: posId("s"), kind: "pos", target: "s", x: 0, y: 0, w: 600, at: 1 } } as never;
  const once = putProduction(board, "s", [["Shot"]], "<p>one</p>", id);
  const made = live(once).filter((i): i is BoxItem => i.kind === "box" && !!(i as BoxItem).notesFor);
  assert.deepEqual(made.map(productionOf).sort(), ["prep", "shots"]);
  assert.ok(once["link:s|b1"] && once["link:s|b2"]);
  const twice = putProduction(once, "s", [["Shot"], ["x"]], "<p>two</p>", id);
  const again = live(twice).filter((i): i is BoxItem => i.kind === "box" && !!(i as BoxItem).notesFor);
  assert.equal(again.length, 2);
  assert.equal(again.find((b) => productionOf(b) === "prep")!.html, "<p>two</p>");
});
