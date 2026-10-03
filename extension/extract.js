/*
 * Reads the article on the current page with Readability (vendor/Readability.js,
 * injected just before this). Shared by the popup's Save and by the automatic
 * "scan it in yourself" capture in background.js. Defines one global and
 * reads only what the page already shows.
 */
window.__superReaderExtract = function extractArticle() {
  const meta = (names) => {
    for (const name of names) {
      const el = document.querySelector(`meta[property="${name}"], meta[name="${name}"], meta[itemprop="${name}"]`);
      const value = el && el.getAttribute("content");
      if (value) return value.trim();
    }
    return undefined;
  };
  const selection = String(window.getSelection() || "").replace(/\s+/g, " ").trim();
  let parsed = null;
  try {
    // A copy: Readability rearranges the document it is given.
    parsed = new Readability(document.cloneNode(true), { charThreshold: 250 }).parse();
  } catch (error) {
    parsed = null;
  }
  const time = document.querySelector("time[datetime]");
  return {
    url: location.href,
    title: (parsed && parsed.title) || meta(["og:title", "twitter:title"]) || document.title,
    byline: (parsed && parsed.byline) || meta(["author", "article:author"]),
    siteName: (parsed && parsed.siteName) || meta(["og:site_name"]),
    publishedAt:
      (parsed && parsed.publishedTime) ||
      meta(["article:published_time", "datePublished", "date"]) ||
      (time && time.getAttribute("datetime")) ||
      undefined,
    html: parsed && parsed.content ? parsed.content : "",
    excerpt: (parsed && parsed.excerpt) || meta(["og:description", "description"]),
    selection: selection.slice(0, 4000),
  };
};

/*
 * A YouTube video's transcript, read in the reader's own browser — where
 * YouTube shows it under "Show transcript" — since YouTube answers the app's
 * server with a bot check. First the caption track the page itself lists;
 * failing that, the transcript panel the page draws when asked. Resolves to
 * an article whose text is the transcript, or null.
 */
window.__superReaderYoutube = async function youtubeTranscript() {
  const id = new URL(location.href).searchParams.get("v") ||
    (location.pathname.match(/^\/(?:shorts|live)\/([^/?#]+)/) || [])[1];
  if (!id) return null;
  const esc = (t) => t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const stamp = (t) => {
    const s = Math.floor(t), h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), ss = String(s % 60).padStart(2, "0");
    return h ? `${h}:${String(m).padStart(2, "0")}:${ss}` : `${m}:${ss}`;
  };
  let lines = [];
  let auto = false;

  // 1. The caption track the page lists, fetched as this browser.
  try {
    const script = [...document.scripts].map((s) => s.textContent || "").find((t) => t.includes('"captionTracks"'));
    const at = script ? script.indexOf('"captionTracks":') : -1;
    if (at >= 0) {
      const open = script.indexOf("[", at);
      let depth = 0, end = -1;
      for (let i = open; i < script.length; i++) {
        if (script[i] === "[") depth++;
        else if (script[i] === "]" && --depth === 0) { end = i + 1; break; }
      }
      const tracks = JSON.parse(script.slice(open, end));
      const en = (t) => /^en\b/i.test(t.languageCode);
      const track = tracks.find((t) => en(t) && t.kind !== "asr") || tracks.find(en) || tracks[0];
      if (track) {
        auto = track.kind === "asr";
        const url = new URL(track.baseUrl);
        url.searchParams.set("fmt", "json3");
        const data = await (await fetch(url, { credentials: "include" })).json();
        lines = (data.events || [])
          .filter((e) => e.segs)
          .map((e) => ({ start: (e.tStartMs || 0) / 1000, text: e.segs.map((s) => s.utf8 || "").join("").replace(/\s+/g, " ").trim() }))
          .filter((l) => l.text);
      }
    }
  } catch (error) {
    lines = [];
  }

  // 2. The transcript panel, opened as a reader would open it.
  if (lines.length === 0) {
    try {
      const expand = document.querySelector("tp-yt-paper-button#expand, #description-inline-expander #expand");
      if (expand) expand.click();
      await new Promise((r) => setTimeout(r, 400));
      const button = document.querySelector("ytd-video-description-transcript-section-renderer button") ||
        [...document.querySelectorAll("button")].find((b) => /show transcript/i.test(b.textContent || ""));
      if (button) {
        button.click();
        for (let i = 0; i < 30 && !document.querySelector("ytd-transcript-segment-renderer"); i++) await new Promise((r) => setTimeout(r, 300));
        lines = [...document.querySelectorAll("ytd-transcript-segment-renderer")].map((seg) => {
          const time = ((seg.querySelector(".segment-timestamp") || {}).textContent || "").trim();
          const parts = time.split(":").map(Number);
          const start = parts.reduce((n, p) => n * 60 + p, 0);
          return { start, text: ((seg.querySelector(".segment-text") || {}).textContent || "").replace(/\s+/g, " ").trim() };
        }).filter((l) => l.text);
      }
    } catch (error) {
      lines = [];
    }
  }
  if (lines.length === 0) return null;

  // Paragraphs at pauses, each opening with its time linked into the video.
  const paras = [];
  let cur = null, last = 0;
  for (const l of lines) {
    if (!cur || l.start - last > 4 || l.start - cur.start > 45) { cur = { start: l.start, text: l.text }; paras.push(cur); }
    else cur.text += " " + l.text;
    last = l.start;
  }
  const meta = (p) => (document.querySelector(`meta[property="${p}"], meta[name="${p}"]`) || {}).content;
  const title = meta("og:title") || document.title.replace(/ - YouTube$/, "");
  const channel = (document.querySelector("ytd-channel-name a, #owner #channel-name a") || {}).textContent;
  return {
    url: `https://www.youtube.com/watch?v=${id}`,
    title,
    byline: channel ? channel.trim() : undefined,
    siteName: "YouTube",
    transcript: true,
    html:
      `<figure><img src="https://i.ytimg.com/vi/${id}/hqdefault.jpg" alt=""></figure>` +
      `<h2>Transcript${auto ? " (auto-generated)" : ""}</h2>` +
      paras.map((p) => `<p><a href="https://www.youtube.com/watch?v=${id}&amp;t=${Math.floor(p.start)}s">${stamp(p.start)}</a> ${esc(p.text)}</p>`).join(""),
    selection: "",
  };
};
