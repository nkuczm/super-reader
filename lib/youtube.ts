/**
 * A YouTube video's transcript — the captions YouTube itself shows under
 * "Show transcript" on the watch page.
 *
 * The watch page carries the video's player response, and in it the list of
 * caption tracks with the address of each. We read that list from the page as
 * any visitor gets it, pick the best track (the uploader's own captions in
 * English before automatic ones, then whatever there is), and fetch it as
 * timed text. If YouTube answers with a bot check, or the video has no
 * captions, there is no transcript — we do not try to get round a refusal
 * (docs/COLLECTION.md §8).
 */

import { fetchText } from "./feed";

export type TranscriptLine = { start: number; text: string };
export type VideoTranscript = { language: string; auto: boolean; lines: TranscriptLine[] };

/** The video id from any YouTube link shape, or null. */
export function youtubeId(link: string): string | null {
  let url: URL;
  try {
    url = new URL(link);
  } catch {
    return null;
  }
  const host = url.hostname.replace(/^(www\.|m\.|music\.)/, "");
  let id: string | null = null;
  if (host === "youtu.be") id = url.pathname.slice(1).split("/")[0];
  else if (host === "youtube.com" || host === "youtube-nocookie.com") {
    id = url.searchParams.get("v") ?? url.pathname.match(/^\/(?:shorts|live|embed|v)\/([^/?#]+)/)?.[1] ?? null;
  }
  return id && /^[A-Za-z0-9_-]{6,20}$/.test(id) ? id : null;
}

type Track = { baseUrl: string; languageCode: string; kind?: string; name?: { simpleText?: string } };

/** The caption tracks listed in a watch page's player response. */
export function captionTracks(page: string): Track[] {
  const start = page.indexOf('"captionTracks":');
  if (start < 0) return [];
  // The array closes at its matching bracket; read just that much.
  const open = page.indexOf("[", start);
  let depth = 0;
  for (let i = open; i < page.length && i < open + 200_000; i++) {
    const ch = page[i];
    if (ch === "[") depth++;
    else if (ch === "]" && --depth === 0) {
      try {
        const tracks = JSON.parse(page.slice(open, i + 1)) as Track[];
        return tracks.filter((t) => typeof t?.baseUrl === "string");
      } catch {
        return [];
      }
    }
  }
  return [];
}

/** The uploader's English captions first, then automatic English, then anything. */
export function pickTrack(tracks: Track[]): Track | null {
  const en = (t: Track) => /^en\b/i.test(t.languageCode);
  const auto = (t: Track) => t.kind === "asr";
  return tracks.find((t) => en(t) && !auto(t)) ?? tracks.find(en) ?? tracks.find((t) => !auto(t)) ?? tracks[0] ?? null;
}

const decode = (s: string) =>
  s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&#x27;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)));

/** Timed text in YouTube's json3 or XML shape, as lines. */
export function parseTimedText(body: string): TranscriptLine[] {
  const text = body.trim();
  if (text.startsWith("{")) {
    try {
      const data = JSON.parse(text) as { events?: { tStartMs?: number; segs?: { utf8?: string }[] }[] };
      return (data.events ?? [])
        .filter((e) => e.segs)
        .map((e) => ({ start: (e.tStartMs ?? 0) / 1000, text: e.segs!.map((s) => s.utf8 ?? "").join("").replace(/\s+/g, " ").trim() }))
        .filter((l) => l.text);
    } catch {
      return [];
    }
  }
  return [...text.matchAll(/<text start="([\d.]+)"[^>]*>([\s\S]*?)<\/text>/g)]
    .map((m) => ({ start: Number(m[1]), text: decode(decode(m[2])).replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim() }))
    .filter((l) => l.text);
}

/**
 * Lines grouped into readable paragraphs: a new one after a pause of a few
 * seconds or every forty-odd seconds, so the text reads as prose with a
 * time to jump to at each paragraph.
 */
export function paragraphs(lines: TranscriptLine[]): TranscriptLine[] {
  const out: TranscriptLine[] = [];
  let current: TranscriptLine | null = null;
  let last = 0;
  for (const line of lines) {
    const pause = line.start - last > 4;
    if (!current || pause || line.start - current.start > 45) {
      current = { start: line.start, text: line.text };
      out.push(current);
    } else current.text += ` ${line.text}`;
    last = line.start;
  }
  return out;
}

export async function fetchYoutubeTranscript(link: string, timeoutMs = 9000): Promise<VideoTranscript | null> {
  const id = youtubeId(link);
  if (!id) return null;
  const deadline = Date.now() + timeoutMs;
  const { body } = await fetchText(`https://www.youtube.com/watch?v=${id}&hl=en`, timeoutMs, { "accept-language": "en-US,en;q=0.9" });
  const track = pickTrack(captionTracks(body));
  if (!track) return null;
  const left = Math.max(2000, deadline - Date.now());
  const url = new URL(decode(track.baseUrl).replace(/\\u0026/g, "&"));
  url.searchParams.set("fmt", "json3");
  let lines: TranscriptLine[] = [];
  try {
    const { body: timed } = await fetchText(url.toString(), left);
    lines = parseTimedText(timed);
  } catch {
    /* fall through to the XML shape */
  }
  if (lines.length === 0) {
    url.searchParams.delete("fmt");
    const { body: timed } = await fetchText(url.toString(), Math.max(2000, deadline - Date.now()));
    lines = parseTimedText(timed);
  }
  if (lines.length === 0) return null;
  return { language: track.languageCode, auto: track.kind === "asr", lines };
}
