import { test } from "node:test";
import assert from "node:assert/strict";
import { evaluate, display, safeGrid } from "../lib/sheet";

const at = (grid: string[][], r: number, c: number) => evaluate(grid)[r][c];

test("sum, average, median, min, max, count over ranges", () => {
  const g = [["1", "=SUM(A1:A4)"], ["2", "=AVG(A1:A4)"], ["3", "=MEDIAN(A1:A4)"], ["10", "=MAX(A:A)"], ["x", "=COUNT(A1:A5)"]];
  assert.equal(at(g, 0, 1), 16);
  assert.equal(at(g, 1, 1), 4);
  assert.equal(at(g, 2, 1), 2.5);
  assert.equal(at(g, 3, 1), 10);
  assert.equal(at(g, 4, 1), 4);
  assert.equal(at([["=average(1,2,6)"]], 0, 0), 3);
});

test("arithmetic, precedence, references and percentages", () => {
  const g = [["4", "=A1*2+1", "=(A1+B1)/2", "=2^3^2", "=-A1%", "=$A$1&\" items\""]];
  const row = evaluate(g)[0];
  assert.deepEqual(row.slice(0, 4), [4, 9, 6.5, 512]);
  assert.equal(row[4], -0.04);
  assert.equal(row[5], "4 items");
  assert.equal(at([["=IF(1>2,\"a\",\"b\")"]], 0, 0), "b");
  assert.equal(at([["=ROUND(2.345,2)"]], 0, 0), 2.35);
});

test("errors show instead of guesses", () => {
  assert.equal(at([["=A1"]], 0, 0), "#CYCLE!");
  assert.equal(at([["=1/0"]], 0, 0), "#DIV/0!");
  assert.equal(at([["=NOPE(1)"]], 0, 0), "#NAME?");
  assert.equal(at([["=Z9"]], 0, 0), "#REF!");
  assert.equal(at([["=1+"]], 0, 0), "#ERROR!");
  assert.equal(at([["=1/0", "=A1+1"]], 0, 1), "#DIV/0!");
  assert.equal(at([["hello", "=A1*2"]], 0, 1), "#VALUE!");
});

test("plain cells and display", () => {
  assert.equal(at([["1,200"]], 0, 0), 1200);
  assert.equal(at([["note"]], 0, 0), "note");
  assert.equal(display(1234.5), "1,234.5");
  assert.equal(display(0.1 + 0.2), "0.3");
  assert.deepEqual(safeGrid([["a"], ["b", "c", 5]]), [["a", "", ""], ["b", "c", ""]]);
});
