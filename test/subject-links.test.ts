import test from "node:test";
import assert from "node:assert/strict";
import { sanitizeRichText } from "../lib/subjects";
import { setSubjectDirectory, subjectChipHtml, subjectsMatching } from "../lib/subject-links";

test("a subject chip survives saving as the subject's id alone, never an address or a handler", () => {
  const html = sanitizeRichText('<p>See <a data-subject="abc123" href="javascript:alert(1)" onclick="x()" style="color:red">Water rates</a>.</p>');
  assert.equal(html, '<p>See <a data-subject="abc123" contenteditable="false">Water rates</a>.</p>');
  assert.equal(sanitizeRichText(subjectChipHtml({ id: "n_1", name: "A & B" })), '<a data-subject="n_1" contenteditable="false">A &amp; B</a>');
});

test("a malformed subject id is not a chip", () => {
  assert.doesNotMatch(sanitizeRichText('<a data-subject="bad id!">x</a>'), /data-subject/);
  assert.doesNotMatch(sanitizeRichText('<a data-subject="a&quot;onmouseover=x">x</a>'), /data-subject|onmouseover/);
});

test("the subjects offered are the others, matching what was typed, most recently used first", () => {
  setSubjectDirectory([{ id: "a", name: "Water rates" }, { id: "b", name: "Housing" }, { id: "c", name: "School water tests" }], "b");
  assert.deepEqual(subjectsMatching("").map((s) => s.id), ["a", "c"]);
  assert.deepEqual(subjectsMatching("WATER").map((s) => s.id), ["a", "c"]);
  assert.deepEqual(subjectsMatching("hous").map((s) => s.id), []);
});
