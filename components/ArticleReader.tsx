"use client";

import { useEffect, useState } from "react";
import type { ReadableArticle } from "@/lib/article";
import { Icon } from "./icons";
import { readCached, writeCached } from "@/lib/offline";
import { timeAgo, hostOf } from "./format";

type Props = {
  url: string;
  fallbackTitle: string;
  /** Lets the server fall back to the feed's own copy if the site blocks us. */
  feedUrl?: string;
  /** Stop trying to read this host in-app and go to the site from now on. */
  onAlwaysOpenOnSite?: (link: string) => void;
  /** Whether this article is bookmarked, and how to change that. */
  saved?: boolean;
  onToggleSave?: () => void;
  onClose: () => void;
};

export default function ArticleReader({
  url,
  fallbackTitle,
  feedUrl,
  onAlwaysOpenOnSite,
  saved,
  onToggleSave,
  onClose,
}: Props) {
  const [article, setArticle] = useState<ReadableArticle | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [fromCache, setFromCache] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setArticle(null);
    setError(null);
    setFromCache(false);

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
        );
        const data = await res.json();
        if (!res.ok) throw new Error(data.error ?? "Could not load article");
        if (cancelled) return;
        setArticle(data as ReadableArticle);
        // Keep it, so reopening is instant and works offline.
        void writeCached(data as ReadableArticle);
      } catch (err) {
        if (cancelled) return;
        setError(
          navigator.onLine
            ? err instanceof Error
              ? err.message
              : "Failed"
            : "You're offline, and this article hasn't been downloaded yet.",
        );
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [url, feedUrl, fallbackTitle]);

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
            {saved ? "Saved" : "Save"}
          </button>
        )}
        <a
          className="btn ghost small"
          href={url}
          target="_blank"
          rel="noreferrer noopener"
        >
          Open original
        </a>
      </div>

      <article className="reader-body">
        <h1>{article?.title ?? fallbackTitle}</h1>
        <p className="reader-meta">
          {[
            article?.siteName ?? hostOf(url),
            article?.byline,
            article?.publishedAt ? timeAgo(article.publishedAt) : null,
            article?.wordCount
              ? `${Math.max(1, Math.round(article.wordCount / 220))} min read`
              : null,
            fromCache ? "Saved for offline" : null,
            article?.via === "feed" ? "From the publisher's feed" : null,
          ]
            .filter(Boolean)
            .join("  ·  ")}
        </p>

        {error && (
          <div className="reader-error">
            <p>{error}</p>
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
          </div>
        )}

        {article && (
          <>
            {/* Sanitized server-side: scripts, styles, iframes and event
                handlers are stripped before this ever reaches the DOM. */}
            <div
              className="prose"
              dangerouslySetInnerHTML={{ __html: article.html }}
            />
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
