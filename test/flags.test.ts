import test from "node:test";
import assert from "node:assert/strict";
import { flagsAsText } from "../lib/flags";

test("flags read back as text with their context, output, sources and note", () => {
  const text = flagsAsText([{
    id: "a", at: Date.UTC(2026, 9, 6, 12, 0), kind: "fact-check", subject: "Firm", model: "claude-opus-5-5",
    output: "Needs verification: no source.", context: [{ label: "Highlighted", text: "almost anything" }],
    links: [{ title: "Interview", url: "https://x.test" }], note: "This is supported.",
  }]);
  assert.match(text, /## fact-check — 2026-10-06 12:00 — Firm \(claude-opus-5-5\)/);
  assert.match(text, /\*\*Highlighted:\*\* almost anything/);
  assert.match(text, /\*\*AI output:\*\* Needs verification/);
  assert.match(text, /Interview <https:\/\/x\.test>/);
  assert.match(text, /\*\*My note:\*\* This is supported\./);
});
