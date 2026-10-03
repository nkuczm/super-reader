import { test } from "node:test";
import assert from "node:assert/strict";
import { captionTracks, paragraphs, parseTimedText, pickTrack, youtubeId } from "../lib/youtube";

test("youtubeId reads every link shape", () => {
  assert.equal(youtubeId("https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=3"), "dQw4w9WgXcQ");
  assert.equal(youtubeId("https://youtu.be/dQw4w9WgXcQ"), "dQw4w9WgXcQ");
  assert.equal(youtubeId("https://www.youtube.com/shorts/dQw4w9WgXcQ"), "dQw4w9WgXcQ");
  assert.equal(youtubeId("https://example.com/watch?v=dQw4w9WgXcQ"), null);
});

test("caption tracks are read from a watch page and the best is picked", () => {
  const page = `var x = {"captions":{"playerCaptionsTracklistRenderer":{"captionTracks":[{"baseUrl":"https://www.youtube.com/api/timedtext?v=a\\u0026lang=en\\u0026kind=asr","languageCode":"en","kind":"asr"},{"baseUrl":"https://www.youtube.com/api/timedtext?v=a\\u0026lang=en","languageCode":"en"},{"baseUrl":"https://x/fr","languageCode":"fr"}],"audioTracks":[]}}};`;
  const tracks = captionTracks(page);
  assert.equal(tracks.length, 3);
  assert.equal(pickTrack(tracks)?.kind, undefined);
  assert.equal(pickTrack(tracks)?.languageCode, "en");
  assert.equal(pickTrack(tracks.filter((t) => t.kind === "asr" || t.languageCode === "fr"))?.kind, "asr");
  assert.deepEqual(captionTracks("<html>no captions</html>"), []);
});

test("timed text parses from json3 and XML", () => {
  const json = JSON.stringify({ events: [{ tStartMs: 0, segs: [{ utf8: "hello " }, { utf8: "there" }] }, { tStartMs: 1500 }, { tStartMs: 2000, segs: [{ utf8: "\n" }] }, { tStartMs: 3000, segs: [{ utf8: "world" }] }] });
  assert.deepEqual(parseTimedText(json), [{ start: 0, text: "hello there" }, { start: 3, text: "world" }]);
  const xml = `<transcript><text start="1.5" dur="2">it&amp;#39;s here</text><text start="4" dur="1">&lt;b&gt;bold&lt;/b&gt;</text></transcript>`;
  assert.deepEqual(parseTimedText(xml), [{ start: 1.5, text: "it's here" }, { start: 4, text: "bold" }]);
});

test("lines group into paragraphs at pauses", () => {
  const lines = [0, 2, 4, 20, 22].map((start, i) => ({ start, text: `l${i}` }));
  assert.deepEqual(paragraphs(lines), [{ start: 0, text: "l0 l1 l2" }, { start: 20, text: "l3 l4" }]);
});

test("a transcript pasted from YouTube's panel keeps its times", async () => {
  const { parsePastedTranscript, transcriptArticleHtml } = await import("../lib/youtube");
  const panel = "0:00\nwelcome to the show\n0:03\ntoday we talk budgets\n1:02:05 and that is all";
  assert.deepEqual(parsePastedTranscript(panel), [
    { start: 0, text: "welcome to the show" },
    { start: 3, text: "today we talk budgets" },
    { start: 3725, text: "and that is all" },
  ]);
  assert.deepEqual(parsePastedTranscript("no times here\nat all"), [{ start: -1, text: "no times here" }, { start: -1, text: "at all" }]);
  const html = transcriptArticleHtml("abc123def45", parsePastedTranscript(panel));
  assert.match(html, /<a href="https:\/\/www\.youtube\.com\/watch\?v=abc123def45&amp;t=0s">0:00<\/a> welcome to the show today we talk budgets/);
  assert.match(html, />1:02:05<\/a> and that is all/);
});
