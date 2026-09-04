"use client";

import { useEffect, useRef, useState } from "react";
import type { DiscoverResult } from "@/lib/types";
import type { Feed } from "@/lib/store";
import { Icon } from "./icons";
import SourceIcon from "./SourceIcon";
import { timeAgo, hostOf } from "./format";

type Props = {
  feeds: Feed[];
  defaultFeedId?: string;
  onCancel: () => void;
  onAdd: (result: DiscoverResult, target: string) => void;
};

const NEW_FEED = "__new__";

export default function AddSourceDialog({
  feeds,
  defaultFeedId,
  onCancel,
  onAdd,
}: Props) {
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<DiscoverResult | null>(null);
  const [target, setTarget] = useState(defaultFeedId ?? feeds[0]?.id ?? NEW_FEED);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => inputRef.current?.focus(), []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onCancel();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onCancel]);

  async function runPreview() {
    const value = query.trim();
    if (!value) return;
    setLoading(true);
    setError(null);
    setPreview(null);
    try {
      const res = await fetch(`/api/discover?q=${encodeURIComponent(value)}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Could not read that source");
      setPreview(data as DiscoverResult);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="overlay" onMouseDown={onCancel}>
      <div
        className="dialog"
        role="dialog"
        aria-modal="true"
        aria-label="Add a source"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="dialog-head">
          <h2>Add a source</h2>
          <p>
            Paste a website, a Substack, an RSS URL — or just type a topic like
            “semiconductors”.
          </p>
        </div>

        <div className="dialog-body">
          <div className="row">
            <input
              ref={inputRef}
              className="input"
              placeholder="stratechery.com, a topic, or an RSS link"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") runPreview();
              }}
            />
            <button
              className="btn small"
              onClick={runPreview}
              disabled={loading || !query.trim()}
            >
              {loading ? <span className="spinner" /> : "Preview"}
            </button>
          </div>

          {error && <p className="error">{error}</p>}

          {preview && (
            <>
              <div className="preview-head">
                <SourceIcon src={preview.favicon} title={preview.title} size={26} />
                <div>
                  <strong>{preview.title}</strong>
                  <span>
                    {preview.kind === "topic"
                      ? "Topic feed"
                      : hostOf(preview.siteUrl)}{" "}
                    · {preview.articles.length} recent articles
                  </span>
                </div>
              </div>
              <ul className="preview-list">
                {preview.articles.slice(0, 6).map((article) => (
                  <li key={article.id}>
                    <div>{article.title}</div>
                    <div className="when">
                      {[article.author, timeAgo(article.publishedAt)]
                        .filter(Boolean)
                        .join(" · ")}
                    </div>
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>

        <div className="dialog-foot">
          {preview && (
            <select
              className="select"
              value={target}
              onChange={(event) => setTarget(event.target.value)}
            >
              {feeds.map((feed) => (
                <option key={feed.id} value={feed.id}>
                  Add to “{feed.name}”
                </option>
              ))}
              <option value={NEW_FEED}>+ New feed…</option>
            </select>
          )}
          <button className="btn ghost small" onClick={onCancel}>
            Cancel
          </button>
          <button
            className="btn small"
            disabled={!preview}
            onClick={() => preview && onAdd(preview, target)}
          >
            {Icon.plus}
            Add source
          </button>
        </div>
      </div>
    </div>
  );
}
