import { test } from "node:test";
import assert from "node:assert/strict";
import { parseTranscript, speakersOf, safeTranscript, titleFromFile } from "../lib/transcript";

test("Riverside: a header line per turn, paragraphs kept", () => {
  const turns = parseTranscript(`Nathan Kuczmarski (00:01.512)
Alright, well welcome again.

Eric Jinho Jang (01:04.717)
My name is Jin Ho Jang.

last year June for honestly

Nathan Kuczmarski (01:01:06.729)
Okay. Is there anyone else?
`);
  assert.equal(turns.length, 3);
  assert.deepEqual(turns[0], { s: "Nathan Kuczmarski", t: "00:01", x: "Alright, well welcome again." });
  assert.equal(turns[1].x, "My name is Jin Ho Jang.\n\nlast year June for honestly");
  assert.equal(turns[2].t, "01:01:06");
  assert.deepEqual(speakersOf(turns), ["Nathan Kuczmarski", "Eric Jinho Jang"]);
});

test("Otter, plain and timestamped inline shapes", () => {
  assert.deepEqual(parseTranscript("Jane Doe  0:01\nHello there.\nJohn  0:05\nHi."), [
    { s: "Jane Doe", t: "0:01", x: "Hello there." },
    { s: "John", t: "0:05", x: "Hi." },
  ]);
  assert.deepEqual(parseTranscript("Interviewer: How did it start?\nMaria Lopez: By accident.\nIt grew."), [
    { s: "Interviewer", x: "How did it start?" },
    { s: "Maria Lopez", x: "By accident. It grew." },
  ]);
  assert.deepEqual(parseTranscript("[00:12] Sam: Yes."), [{ s: "Sam", t: "00:12", x: "Yes." }]);
});

test("VTT cues merge into one turn per speaker", () => {
  const vtt = `WEBVTT

1
00:00:01.000 --> 00:00:03.000
Ann: First part

2
00:00:03.000 --> 00:00:05.000
Ann: second part

3
00:00:05.000 --> 00:00:07.000
Bob: Reply`;
  assert.deepEqual(parseTranscript(vtt), [
    { s: "Ann", t: "00:00:01", x: "First part second part" },
    { s: "Bob", t: "00:00:05", x: "Reply" },
  ]);
});

test("prose is not mistaken for speakers, and nothing is lost", () => {
  const turns = parseTranscript("the plan was simple: go early.\nNote: bring water.");
  assert.equal(turns.length, 1);
  assert.equal(turns[0].s, undefined);
  assert.match(turns[0].x, /bring water/);
});

test("stored shape is bounded", () => {
  assert.deepEqual(safeTranscript({ title: 5, turns: [{ x: "a", s: "" }, { s: "b" }, null] }), { title: "", turns: [{ x: "a" }] });
  assert.equal(titleFromFile("eric-nathan.txt"), "eric nathan");
});

test("reads a Premiere caption export: timecode range, speaker on its own line, then the words", () => {
  const text = [
    "00;00;02;11 - 00;00;02;29", "Speaker 1", "And.", "",
    "00;00;03;02 - 00;00;05;28", "Speaker 2", "We roll all the cameras already.", "",
    "00;00;06;01 - 00;00;10;04", "Speaker 2", "Okay. I'm happy to start.", "",
    "01;42;17;26 - 01;42;30;19", "Speaker 1", "Like how much money can we make.", "",
  ].join("\r\n");
  const turns = parseTranscript(text);
  assert.deepEqual(turns, [
    { s: "Speaker 1", t: "00:02", x: "And." },
    { s: "Speaker 2", t: "00:03", x: "We roll all the cameras already. Okay. I'm happy to start." },
    { s: "Speaker 1", t: "01:42:17", x: "Like how much money can we make." },
  ]);
});

test("a cue with no speaker line keeps its words", () => {
  const turns = parseTranscript("00;00;01;00 - 00;00;02;00\nOkay.\n\n00;00;03;00 - 00;00;04;00\nSpeaker 1\nYes.");
  assert.deepEqual(turns.map((t) => [t.s, t.x]), [[undefined, "Okay."], ["Speaker 1", "Yes."]]);
});

test("a turn too long for one is carried on, never cut off", () => {
  const sentence = "This is one sentence of a long answer. ";
  const long = `Interviewer: question\nGuest: ${sentence.repeat(1500)}`;
  const turns = parseTranscript(long);
  const guest = turns.filter((t) => t.s === "Guest");
  assert.ok(guest.length >= 3);
  assert.ok(guest.every((t) => t.x.length <= 20_000));
  assert.equal(guest.map((t) => t.x).join(" ").split(/\s+/).length, sentence.trim().split(/\s+/).length * 1500);
  // Each piece ends at a sentence.
  assert.ok(guest.slice(0, -1).every((t) => t.x.endsWith(".")));
  // And survives being stored.
  assert.equal(safeTranscript({ title: "", turns }).turns.length, turns.length);
});
