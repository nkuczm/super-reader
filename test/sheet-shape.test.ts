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
