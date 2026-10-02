/**
 * Interview transcripts: text as an app exports it, read into who said what.
 *
 * Understands the common shapes —
 *   Riverside   "Name (00:01.512)" on its own line, then what they said
 *   Otter       "Name  0:01" on its own line, then what they said
 *   Zoom / VTT  cue lines and timings, then "Name: what they said"
 *   plain       "Name: what they said", optionally "[00:01] Name: …"
 * — and anything else becomes one block of text, so nothing pasted is lost.
 */

export type Turn = {
  /** Who spoke, if the transcript says. */
  s?: string;
  /** When, as written in the transcript ("00:01", "01:02:03"). */
  t?: string;
  /** What they said; paragraphs separated by blank lines. */
  x: string;
};

export type Transcript = { title: string; turns: Turn[] };

export const MAX_TRANSCRIPT_CHARS = 200_000;
const MAX_TURNS = 5000;

const TIME = String.raw`(?:\d{1,2}:)?\d{1,2}:\d{2}(?:[.,]\d+)?`;
const NAME = String.raw`[\p{L}][\p{L}\p{M}'’.\- ]{0,58}?`;

/** "Name (00:01.512)" — Riverside. */
const PAREN_HEADER = new RegExp(String.raw`^(${NAME})\s*\((${TIME})\)\s*$`, "u");
/** "Name  0:01" or "Name 00:01:02" — Otter and similar. */
const TRAILING_TIME_HEADER = new RegExp(String.raw`^(${NAME})\s+(${TIME})\s*$`, "u");
/** "[00:01] Name: text", "00:01 Name: text", "Name: text" */
const INLINE = new RegExp(String.raw`^(?:\[?(${TIME})\]?\s*[-–—]?\s*)?(${NAME}):\s+(.*)$`, "u");
/** "00:00:01.000 --> 00:00:04.000" — a VTT/SRT cue timing. */
const CUE = new RegExp(String.raw`^(${TIME})\s*-->\s*${TIME}`);

/** A time as written, without its fraction: "00:01.512" → "00:01". */
const shortTime = (t: string) => t.replace(/[.,]\d+$/, "");

/** Words that start a sentence with a colon but are not a speaker. */
const NOT_SPEAKERS = new Set(["note", "edit", "update", "source", "http", "https", "warning", "example", "q", "a"]);

function speakerLike(name: string) {
  const n = name.trim();
  if (!n || n.length > 50) return false;
  if (NOT_SPEAKERS.has(n.toLowerCase())) return false;
  const words = n.split(/\s+/);
  if (words.length > 5) return false;
  // A name: each word capitalised (or an initial), not a sentence.
  return words.every((w) => /^[\p{Lu}\d]/u.test(w) || /^(de|da|van|von|al|bin|le|la|del|di)$/i.test(w));
}

export function parseTranscript(input: string): Turn[] {
  const text = input.replace(/^﻿/, "").replace(/\r\n?/g, "\n").slice(0, MAX_TRANSCRIPT_CHARS);
  const lines = text.split("\n");
  const turns: Turn[] = [];
  let current: Turn | null = null;
  let pendingTime: string | undefined;
  let blank = false;
  let sawCue = false;

  const start = (s: string | undefined, t: string | undefined, x = "") => {
    current = { ...(s ? { s: s.trim() } : {}), ...(t ? { t: shortTime(t) } : {}), x };
    turns.push(current);
    blank = false;
  };
  const add = (line: string) => {
    if (!current) start(undefined, pendingTime);
    const turn = current!;
    turn.x = turn.x ? `${turn.x}${blank ? "\n\n" : " "}${line}` : line;
    blank = false;
  };

  for (const raw of lines) {
    const line = raw.trim();
    if (!line) {
      blank = true;
      continue;
    }
    if (line === "WEBVTT" || /^\d+$/.test(line)) continue;
    const cue = line.match(CUE);
    if (cue) {
      pendingTime = cue[1];
      sawCue = true;
      continue;
    }
    const header = line.match(PAREN_HEADER) ?? line.match(TRAILING_TIME_HEADER);
    if (header && speakerLike(header[1])) {
      start(header[1], header[2]);
      pendingTime = undefined;
      continue;
    }
    const inline = line.match(INLINE);
    if (inline && speakerLike(inline[2])) {
      start(inline[2], inline[1] ?? pendingTime, inline[3].trim());
      pendingTime = undefined;
      continue;
    }
    add(line);
  }

  // VTT and SRT split a speaker into many cues: one turn per change of speaker.
  const merged: Turn[] = [];
  for (const turn of turns) {
    if (!turn.x.trim()) continue;
    const last = merged.at(-1);
    if (sawCue && last?.s && last.s === turn.s) {
      last.x = `${last.x} ${turn.x}`;
      continue;
    }
    merged.push(turn);
  }
  return merged.slice(0, MAX_TURNS);
}

/** Everyone who speaks, in order of first appearance. */
export function speakersOf(turns: Turn[]): string[] {
  return [...new Set(turns.flatMap((t) => (t.s ? [t.s] : [])))];
}

/** A transcript as stored: bounded, strings only. */
export function safeTranscript(input: unknown): Transcript {
  const value = (input && typeof input === "object" ? input : {}) as Partial<Transcript>;
  const turns = (Array.isArray(value.turns) ? value.turns : []).slice(0, MAX_TURNS).flatMap((t): Turn[] => {
    if (!t || typeof t !== "object" || typeof t.x !== "string") return [];
    return [{
      ...(typeof t.s === "string" && t.s ? { s: t.s.slice(0, 80) } : {}),
      ...(typeof t.t === "string" && t.t ? { t: t.t.slice(0, 16) } : {}),
      x: t.x.slice(0, 20_000),
    }];
  });
  return { title: typeof value.title === "string" ? value.title.slice(0, 200) : "", turns };
}

/** A title from a file name: "eric-nathan.txt" → "eric nathan". */
export function titleFromFile(name: string) {
  return name.replace(/\.[a-z0-9]{1,5}$/i, "").replace(/[-_]+/g, " ").trim().slice(0, 200);
}
