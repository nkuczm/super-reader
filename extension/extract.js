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
