import test from "node:test";
import assert from "node:assert/strict";
import { omissionsHtml, putFactNotes, researchOf, safeFactCheck, scriptColumns, scriptRows } from "../lib/factcheck";
import { live } from "../lib/subjects";

test("the words column is found by its header, or by its place", () => {
  assert.deepEqual(scriptColumns([["Visuals", "Words", "Notes"], ["a", "b", "c"]]), { words: 1, visuals: 0, notes: 2, header: true });
  assert.deepEqual(scriptColumns([["SCRIPT", "B-roll"], ["x", "y"]]).words, 0);
  assert.equal(scriptColumns([["shot of a city", "In 2019 the firm…"]]).words, 1);
});

test("script rows skip the header and empty lines, keeping what is on screen", () => {
  const rows = scriptRows([["Visuals", "Words"], ["<p>Drone shot</p>", "<p>The company was <b>founded</b> in 2004.</p>"], ["", ""]]);
  assert.deepEqual(rows, [{ row: 1, text: "The company was founded in 2004.", visual: "Drone shot" }]);
});

test("research leaves out the script itself and gives every source an id", () => {
  const cards = [{ id: "c1", link: "https://x.test/a", title: "Firm founded", source: "Wire", quotes: [{ id: "q", text: "founded in 2004" }], note: "", at: 1 }];
  const boxes = [
    { id: "script", kind: "box", html: "", table: [["Words"], ["x"]], at: 1 },
    { id: "t", kind: "box", html: "", transcript: { title: "CEO interview", turns: [{ s: "Ann", x: "We started in 2004." }] }, at: 2 },
    { id: "n", kind: "box", html: "<p>Moved HQ in 2010</p>", at: 3 },
  ] as never;
  const { sources, targets } = researchOf(cards, boxes, "script");
  assert.deepEqual(sources.map((s) => s.id), ["S1", "T1", "N1"]);
  assert.match(sources[1].text, /\[T1#0\] Ann: We started in 2004\./);
  assert.equal(targets.T1.id, "t");
});

test("the omissions card is made once beside the script, then rewritten", () => {
  const start = { "pos:script": { id: "pos:script", kind: "pos", target: "script", x: 0, y: 0, w: 500, at: 1 } } as never;
  const html = omissionsHtml({ omissions: [{ text: "It moved HQ in 2010.", refs: ["N1"] }], web: [{ text: "A rival sued.", url: "https://news.test/x" }] },
    { N1: { kind: "note", id: "n", title: "Moved HQ" } });
  assert.match(html, /Moved HQ/);
  assert.match(html, /news\.test/);
  const one = putFactNotes(start, "script", html, "f1", 2);
  const two = putFactNotes(one, "script", "<p>new</p>", "f2", 3);
  const notes = live(two).filter((i) => i.kind === "box");
  assert.equal(notes.length, 1);
  assert.equal((notes[0] as { html: string }).html, "<p>new</p>");
  assert.equal((two as Record<string, { x: number }>)["pos:f1"].x, 560);
});

test("a stored check is read back safely", () => {
  const check = safeFactCheck({ at: 5, claims: [{ row: 1, text: "x", status: "weird", why: 3, sources: [{ ref: "S1", quote: "q" }, null] }], targets: { S1: { kind: "card", id: "c", title: "t", link: "l" }, X: { kind: "bad", id: "y" } } });
  assert.deepEqual(check, { at: 5, claims: [{ row: 1, text: "x", status: "verify", why: "", sources: [{ ref: "S1", quote: "q" }] }], targets: { S1: { kind: "card", id: "c", title: "t", link: "l" } } });
});

test("quotes are found for transcript speakers by first name, and nobody else", async () => {
  const { scriptQuotes } = await import("../lib/factcheck");
  const sources = [{ id: "T1", title: "Interview", text: [
    "[T1#0] Nathan: So when did it start?",
    "[T1#1] Devon Smith: We started in 2004, honestly with no money at all.",
    "[T1#2] Devon Smith: We sometimes cut corners, sure.",
  ].join("\n") }];
  const rows = [
    { row: 1, text: "The firm began small." },
    { row: 2, text: "DEVON: “We started in 2004.”\nNATHAN: That was brave.\nME: I asked again." },
    { row: 3, text: "Devon: \"We never cut corners.\"" },
    { row: 4, text: "MARIA: \"Hello\"" },
  ];
  const qs = scriptQuotes(rows, sources);
  // Nathan only asks questions: he is the interviewer, so "NATHAN:" is not a quote to check.
  assert.ok(!qs.some((q) => q.speaker === "Nathan"));
  const devon = qs.filter((q) => q.speaker === "Devon Smith");
  assert.equal(devon.length, 2);
  assert.equal(devon[0].text, "“We started in 2004.”");
  assert.equal(devon[0].match?.ref, "T1#1");
  assert.equal(devon[0].match?.exact, true);
  assert.equal(devon[1].match?.ref, "T1#2");
  assert.equal(devon[1].match?.exact, false);
  assert.match(devon[0].context, /began small/);
  assert.ok(!qs.some((q) => /Hello|asked again/.test(q.text)), "ME and a name no transcript has are not checked");
});
