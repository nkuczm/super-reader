import test from "node:test";
import assert from "node:assert/strict";
import { sanitizeRichText } from "../lib/subjects";
import { hexColor } from "../lib/colors";

test("a highlight keeps its colour; the default yellow, and a pasted coloured span, stay a plain mark", () => {
  assert.equal(sanitizeRichText(`<p><mark data-hl="#bbf7d0" style="background-color:#bbf7d0">green</mark></p>`), `<p><mark data-hl="#bbf7d0" style="background-color:#bbf7d0">green</mark></p>`);
  assert.equal(sanitizeRichText(`<p><mark data-hl="#fde68a">yellow</mark></p>`), `<p><mark>yellow</mark></p>`);
  assert.equal(sanitizeRichText(`<p><span style="background-color: rgb(187, 247, 208);">pasted</span></p>`), `<p><mark>pasted</mark></p>`);
  // Saved and read back, it stays the same.
  const saved = sanitizeRichText(`<p><mark data-hl="#ff00aa" style="background-color:#ff00aa">pink</mark></p>`);
  assert.equal(sanitizeRichText(saved), saved);
});

test("nothing but a checked colour gets into a highlight's style", () => {
  assert.equal(sanitizeRichText(`<mark data-hl="red;position:fixed" style="position:fixed">x</mark>`), `<mark>x</mark>`);
  assert.equal(hexColor("url(javascript:1)"), null);
});
