"use client";

import { useEffect, useState } from "react";
import type { ReadableArticle } from "@/lib/article";
import { Icon } from "./icons";
import { timeAgo, hostOf } from "./format";

type Props = { url: string; fallbackTitle: string; onClose: () => void };

export default function ArticleReader({ url, fallbackTitle, onClose }: Props) {
  const [article, setArticle] = useState<ReadableArticle | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setArticle(null);
    setError(null);

    fetch(`/api/article?url=${encodeURIComponent(url)}`)
      .then(async (res) => {
        const data = await res.json();
        if (!res.ok) throw new Error(data.error ?? "Could not load article");
        if (!cancelled) setArticle(data as ReadableArticle);
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : "Failed");
      });

    return () => {
      cancelled = true;
    };
  }, [url]);

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
          ]
            .filter(Boolean)
            .join("  ·  ")}
        </p>

        {error && (
          <div className="reader-error">
            <p>{error}</p>
            <a
              className="btn small"
              href={url}
              target="_blank"
              rel="noreferrer noopener"
            >
              Read it on the site
            </a>
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
