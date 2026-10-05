import test from "node:test";
import assert from "node:assert/strict";
import { deleteCol, fromTsv, insertCol, insertRow, pasteBlock, safeSizes, sortRows, toTsv } from "../lib/sheet";

test("rows and columns go in and come out where asked", () => {
  const g = [["a", "b"], ["c", "d"]];
  assert.deepEqual(insertRow(g, 1), [["a", "b"], ["", ""], ["c", "d"]]);
  assert.deepEqual(insertCol(g, 0), [["", "a", "b"], ["", "c", "d"]]);
  assert.deepEqual(deleteCol(g, 0), [["b"], ["d"]]);
});

test("sorting puts numbers first, blanks last, and can keep a header", () => {
  const g = [["Name"], ["pear"], [""], ["10"], ["apple"], ["2"]];
  assert.deepEqual(sortRows(g, 0, false, true).map((r) => r[0]), ["Name", "2", "10", "apple", "pear", ""]);
  assert.deepEqual(sortRows(g, 0, true, true).map((r) => r[0]), ["Name", "pear", "apple", "10", "2", ""]);
});

test("tab-separated text round-trips, quotes and newlines included", () => {
  const g = [["a", "two\nlines"], ['say "hi"', ""]];
  assert.deepEqual(fromTsv(toTsv(g, 0, 0, 1, 1)), g);
  assert.deepEqual(fromTsv("1\t2\r\n3\t4\n"), [["1", "2"], ["3", "4"]]);
});

test("pasting grows the table to fit", () => {
  assert.deepEqual(pasteBlock([["x"]], 0, 1, [["1", "2"], ["3", "4"]]), [["x", "1", "2"], ["", "3", "4"]]);
});

test("sizes are clamped and missing ones left to the default", () => {
  assert.deepEqual(safeSizes([10, 200, "x"], 4, 36, 800), [36, 200, null, null]);
});

test("merges move and stretch with inserted and deleted rows", async () => {
  const { shiftMetas, mergeRange, safeMetas, coveredCells } = await import("../lib/sheet");
  const m = mergeRange({}, 1, 0, 2, 1);
  assert.deepEqual(m, { "1,0": { rs: 2, cs: 2 } });
  assert.deepEqual(shiftMetas(m, "row", 0, 1), { "2,0": { rs: 2, cs: 2 } });
  assert.deepEqual(shiftMetas(m, "row", 2, 1), { "1,0": { rs: 3, cs: 2 } });
  assert.deepEqual(shiftMetas(m, "row", 1, -1), { "1,0": { cs: 2 } });
  assert.deepEqual(shiftMetas({ "0,0": { bg: "#ffeeaa" } }, "col", 0, -1), {});
  assert.deepEqual([...coveredCells(m).keys()].sort(), ["1,1", "2,0", "2,1"]);
  assert.deepEqual(safeMetas({ "0,0": { cs: 9, bg: "red" }, "0,1": { bg: "#AABBCC" } }, 2, 2), { "0,0": { rs: 1, cs: 2 } });
});

test("moving a row takes its cells, size and colour with it", async () => {
  const { moveLine } = await import("../lib/sheet");
  const out = moveLine([["a"], ["b"], ["c"]], [10, 20, 30], { "0,0": { bg: "#ffeeaa" } }, "row", 0, 2);
  assert.deepEqual(out.grid, [["b"], ["c"], ["a"]]);
  assert.deepEqual(out.sizes, [20, 30, 10]);
  assert.deepEqual(out.metas, { "2,0": { bg: "#ffeeaa" } });
  const torn = moveLine([["a", "b", "c"]], [1, 2, 3], { "0,0": { cs: 2 } }, "col", 1, 2);
  assert.deepEqual(torn.grid, [["a", "c", "b"]]);
  assert.deepEqual(torn.metas, {});
});
