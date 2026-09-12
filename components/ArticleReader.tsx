"use client";

import { useEffect, useRef, useState } from "react";
import type { ReadableArticle } from "@/lib/article";
import { Icon } from "./icons";
import { downloadUrlFor } from "@/lib/download";
import { readCached, writeCached } from "@/lib/offline";
import { published, hostOf } from "./format";
import QuoteToNote from "./QuoteToNote";
import { findQuoteRange } from "@/lib/highlight";
import type { Note } from "@/lib/notes";

type Props = {
  url: string;
  fallbackTitle: string;
  /** Lets the server fall back to the feed's own copy if the site blocks us. */
  feedUrl?: string;
  /** Stop trying to read this host in-app and go to the site from now on. */
  onAlwaysOpenOnSite?: (link: string) => void;
  /** The list's own summary, shown when the full text cannot be fetched. */
  summary?: string;
  /**
   * The reader's API keys. Some sources — CourtListener — serve their text
   * only through an API that needs one, so this request needs them too.
   */
  keyHeaders?: HeadersInit;
  /** Opens the feed drawer, which on a phone the reader otherwise hides. */
  onOpenMenu?: () => void;
  /** Whether this article is bookmarked, and how to change that. */
  saved?: boolean;
  onToggleSave?: () => void;
  /**
   * Highlighting to quote, when it is switched on. The notes are passed in
   * rather than read here: they belong to the app, not to one article.
   */
  notes?: Note[];
  onQuote?: (noteId: string, text: string) => void;
  onCreateNote?: (name: string) => string;
  /**
   * A passage to go to on arrival — how a note's quote returns to where it
   * came from. It is found in the text, scrolled to and flashed.
   */
  highlight?: string;
  onClose: () => void;
};

export default function ArticleReader({
  url,
  fallbackTitle,
  feedUrl,
  onAlwaysOpenOnSite,
  summary,
  keyHeaders,
  onOpenMenu,
  saved,
  onToggleSave,
  notes,
  onQuote,
  onCreateNote,
  highlight,
  onClose,
}: Props) {
  const [article, setArticle] = useState<ReadableArticle | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [fromCache, setFromCache] = useState(false);
  /** Set when a fetch is taking long enough that silence looks like a bug. */
  const [slow, setSlow] = useState(false);
  /** The article's own text — the only place a highlight becomes a quote. */
  const prose = useRef<HTMLDivElement | null>(null);
  /** Where the quote being returned to sits, in boxes to paint over it. */
  const [flash, setFlash] = useState<
    { top: number; left: number; width: number; height: number }[]
  >([]);
  /** Set when the quote is not in this copy of the article, and said so. */
  const [lost, setLost] = useState(false);

  /**
   * Go to the quoted passage and light it up for a moment.
   *
   * Waits a frame: the text has only just been written into the page, and a
   * measurement taken before layout has settled scrolls to the wrong place.
   * The boxes are drawn over the words rather than wrapped around them,
   * because a quote can start mid-sentence and end inside a link, and the
   * article's HTML is not ours to restructure.
   */
  useEffect(() => {
    setFlash([]);
    setLost(false);
    if (!highlight || !article) return;

    let cancelled = false;
    const timer = setTimeout(() => {
      if (cancelled) return;
      const host = prose.current;
      const range = findQuoteRange(host, highlight);
      if (!host || !range) {
        setLost(true);
        return;
      }

      const body = host.closest(".reader-body") as HTMLElement | null;
      const scroller = host.closest(".main") as HTMLElement | null;
      const base = body?.getBoundingClientRect();
      if (base) {
        setFlash(
          [...range.getClientRects()].map((rect) => ({
            top: rect.top - base.top,
            left: rect.left - base.left,
            width: rect.width,
            height: rect.height,
          })),
        );
      }

      if (scroller) {
        const rect = range.getBoundingClientRect();
        const top =
          scroller.scrollTop + rect.top - scroller.getBoundingClientRect().top - 90;
        scroller.scrollTo({ top: Math.max(0, top), behavior: "smooth" });
      }
      // Long enough to catch the eye after the scroll, short enough that it
      // does not sit there colouring the article while it is being read.
      setTimeout(() => !cancelled && setFlash([]), 2600);
    }, 120);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [highlight, article]);

  useEffect(() => {
    let cancelled = false;
    setArticle(null);
    setError(null);
    setFromCache(false);
    setSlow(false);
    const slowTimer = setTimeout(() => !cancelled && setSlow(true), 8000);

    (async () => {
      // A downloaded article renders immediately, and is the only copy
      // available with no connection.
      const cached = await readCached(url);
      if (cached && !cancelled) {
        setArticle(cached);
        setFromCache(true);
        return;
      }

      try {
        const res = await fetch(
          `/api/article?url=${encodeURIComponent(url)}` +
            (feedUrl ? `&feed=${encodeURIComponent(feedUrl)}` : "") +
            `&title=${encodeURIComponent(fallbackTitle)}`,
          {
            headers: keyHeaders,
            // A request that never answers used to leave the loading skeleton
            // up for good. Better to fail and say so than to sit there.
            // Above the route's own 30s ceiling, so a server-side failure
            // arrives with its own message rather than as a timeout here.
            signal: AbortSignal.timeout(35000),
          },
        );
        const data = await res.json();
        if (!res.ok) throw new Error(data.error ?? "Could not load article");
        if (cancelled) return;
        setArticle(data as ReadableArticle);
        // Keep it, so reopening is instant and works offline. The link asked
        // for is recorded alongside, which is not always the URL it came back
        // under.
        void writeCached(data as ReadableArticle, url);
      } catch (err) {
        if (cancelled) return;
        const timedOut =
          err instanceof DOMException &&
          (err.name === "TimeoutError" || err.name === "AbortError");
        setError(
          !navigator.onLine
            ? "You're offline, and this article hasn't been downloaded yet."
            : timedOut
              ? "This took too long to load. The site may be slow or refusing to answer."
              : err instanceof Error
                ? err.message
                : "Failed",
        );
      }
    })();

    return () => {
      cancelled = true;
      clearTimeout(slowTimer);
    };
  }, [url, feedUrl, fallbackTitle, keyHeaders]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="reader">
      <div className="reader-bar">
        {onOpenMenu && (
          <button className="menu-btn" onClick={onOpenMenu} aria-label="Open feeds">
            {Icon.menu}
          </button>
        )}
        <button className="btn ghost small" onClick={onClose}>
          {Icon.back} Back
        </button>
        {onToggleSave && (
          <button
            className={`btn ghost small${saved ? " on" : ""}`}
            aria-pressed={saved}
            onClick={onToggleSave}
          >
            {saved ? Icon.bookmarkOn : Icon.bookmark}
            <span className="btn-label">{saved ? "Saved" : "Save"}</span>
          </button>
        )}
        {/* What is open here is a file, not a page — so offer to keep it.
            The bytes come back through this origin with an attachment
            disposition; `download` on a cross-origin link is ignored, and the
            browser would navigate to the publisher's PDF instead of saving
            it. */}
        {article?.via === "file" && (
          <a
            className="btn ghost small"
            href={downloadUrlFor(article.url, article.title)}
            download={article.title}
            title="Download this file"
            aria-label="Download this file"
          >
            {Icon.download}
            <span className="btn-label">Download</span>
          </a>
        )}
        <a
          className="btn ghost small"
          href={url}
          target="_blank"
          rel="noreferrer noopener"
          title="Open the original"
        >
          Open<span className="btn-label"> original</span>
        </a>
      </div>

      <article className="reader-body">
        <h1>{article?.title ?? fallbackTitle}</h1>
        <p className="reader-meta">
          {[
            article?.siteName ?? hostOf(url),
            article?.byline,
            article?.publishedAt ? published(article) : null,
            article?.wordCount
              ? `${Math.max(1, Math.round(article.wordCount / 220))} min read`
              : null,
            fromCache ? "Saved for offline" : null,
            article?.via === "feed" ? "From the publisher's feed" : null,
            article?.via === "preview" ? "Preview" : null,
          ]
            .filter(Boolean)
            .join("  ·  ")}
        </p>

        {error && (
          <div className="reader-error">
            <p>{error}</p>
            {/* Whatever the feed gave is better than an empty screen, and for
                an API source the summary is often the opening of the text. */}
            {summary && (
              <div className="reader-fallback">
                <p className="prose">{summary}</p>
                <span>From the feed — the full text could not be fetched.</span>
              </div>
            )}
            <div className="reader-error-actions">
              <a
                className="btn small"
                href={url}
                target="_blank"
                rel="noreferrer noopener"
              >
                Read it on the site
              </a>
              {onAlwaysOpenOnSite && (
                <button
                  className="btn ghost small"
                  onClick={() => onAlwaysOpenOnSite(url)}
                >
                  Always open {hostOf(url)} on the site
                </button>
              )}
            </div>
          </div>
        )}

        {!article && !error && (
          <div className="reader-skeleton" aria-label="Loading article">
            {Array.from({ length: 7 }).map((_, i) => (
              <span key={i} style={{ width: `${92 - (i % 3) * 14}%` }} />
            ))}
            {slow && (
              <p className="reader-slow">
                Still fetching — this site is slow to answer.{" "}
                <a href={url} target="_blank" rel="noreferrer noopener">
                  Open it on the site
                </a>{" "}
                instead.
              </p>
            )}
          </div>
        )}

        {article?.attachments?.map((file) => (
          <div key={file.url} className="reader-file-row">
            {/* The document itself, for a phone's own viewer — which handles
                a court PDF better than any amount of reflowing here. */}
            <a
              className="reader-file"
              href={file.url}
              target="_blank"
              rel="noreferrer noopener"
            >
              <span className="file-kind">{file.kind.toUpperCase()}</span>
              {file.title ?? "Open the file"}
            </a>
            <a
              className="btn ghost small reader-file-save"
              href={downloadUrlFor(file.url, file.title)}
              download={file.title ?? undefined}
              title="Save this file"
            >
              {Icon.download} Download
            </a>
          </div>
        ))}

        {article && (
          <>
            {/* Sanitized server-side: scripts, styles, iframes and event
                handlers are stripped before this ever reaches the DOM. */}
            {flash.length > 0 && (
              <div className="quote-flash" aria-hidden="true">
                {flash.map((box, i) => (
                  <span key={i} style={box} />
                ))}
              </div>
            )}
            {lost && (
              <p className="reader-note">
                The quoted passage is not in this copy of the article — it may
                have been edited since.
              </p>
            )}
            <div
              className="prose"
              ref={prose}
              dangerouslySetInnerHTML={{ __html: article.html }}
            />
            {onQuote && onCreateNote && (
              <QuoteToNote
                container={prose}
                notes={notes ?? []}
                onQuote={onQuote}
                onCreateNote={onCreateNote}
              />
            )}
            {article.via === "preview" && (
              <p className="reader-note">
                This page has no article to extract — a video or a gallery,
                most likely — so this is what it says about itself.{" "}
                <a href={url} target="_blank" rel="noreferrer noopener">
                  Open it on the site
                </a>
                .
              </p>
            )}
            {article.truncated && (
              <p className="reader-note">
                This article was long and has been trimmed —{" "}
                <a href={url} target="_blank" rel="noreferrer noopener">
                  read the rest on the site
                </a>
                .
              </p>
            )}
          </>
        )}
      </article>
    </div>
  );
}
