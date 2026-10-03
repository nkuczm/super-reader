/**
 * YouTube transcripts — the captions YouTube itself shows under "Show
 * transcript" on the watch page.
 *
 * YouTube answers this app's server with a bot check (measured 3 Oct 2026,
 * docs/COLLECTION.md §8), so the server never fetches them. They come from
 * the reader's own browser instead: the extension reads them off the page
 * (extension/extract.js), or the reader pastes the panel's text in. This
 * module turns either into the article's text.
 */


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


const pad = (n: number) => String(n).padStart(2, "0");
/** Seconds as a transcript time: 75 → "1:15", 3725 → "1:02:05". */
export function stamp(t: number): string {
  const s = Math.floor(t);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return h ? `${h}:${pad(m)}:${pad(s % 60)}` : `${m}:${pad(s % 60)}`;
}

/** A transcript as article HTML: each paragraph opens with its time, linked to that moment in the video. */
export function transcriptArticleHtml(id: string | null, lines: TranscriptLine[], auto = false): string {
  const esc = (t: string) => t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  return (
    `<h2>Transcript${auto ? " (auto-generated)" : ""}</h2>` +
    paragraphs(lines)
      .map((p) => {
        const time = Number.isFinite(p.start) && p.start >= 0 ? stamp(p.start) : "";
        const link = id && time ? `<a href="https://www.youtube.com/watch?v=${id}&amp;t=${Math.floor(p.start)}s">${time}</a> ` : time ? `${time} ` : "";
        return `<p>${link}${esc(p.text)}</p>`;
      })
      .join("")
  );
}

/**
 * A transcript copied from YouTube's "Show transcript" panel (or anywhere
 * that puts a time before each line): "0:00\nText\n0:04\nMore", or
 * "0:00 Text" on one line. Text with no times at all is kept as one block
 * per line, timed at -1 so no time is shown.
 */
export function parsePastedTranscript(text: string): TranscriptLine[] {
  const TIME = /^(?:(\d{1,2}):)?(\d{1,2}):(\d{2})(?:\s+(.*))?$/;
  const out: TranscriptLine[] = [];
  let timed = false;
  for (const raw of text.replace(/\r/g, "").split("\n")) {
    const line = raw.trim();
    if (!line) continue;
    const m = line.match(TIME);
    if (m) {
      timed = true;
      const start = Number(m[1] ?? 0) * 3600 + Number(m[2]) * 60 + Number(m[3]);
      out.push({ start, text: (m[4] ?? "").trim() });
    } else if (timed && out.length && !out[out.length - 1].text) out[out.length - 1].text = line;
    else if (timed && out.length) out[out.length - 1].text += ` ${line}`;
    else out.push({ start: -1, text: line });
  }
  return out.filter((l) => l.text);
}
