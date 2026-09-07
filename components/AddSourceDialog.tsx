"use client";

import { useEffect, useRef, useState } from "react";
import type { DiscoverResult } from "@/lib/types";
import type { Feed } from "@/lib/store";
import { Icon } from "./icons";
import ApiCatalog from "./ApiCatalog";
import SourceIcon from "./SourceIcon";
import { timeAgo, hostOf } from "./format";

type Props = {
  feeds: Feed[];
  /** Sent with the lookup so an API source can use the reader's own key. */
  keyHeaders?: HeadersInit;
  defaultFeedId?: string;
  onCancel: () => void;
  onAdd: (result: DiscoverResult, target: string) => void;
};

const NEW_FEED = "__new__";

/** True when the pasted URL points at a section rather than a whole site. */
function pastedASection(input: string) {
  const value = input.trim();
  if (!/^(https?:\/\/)?[^\s]+\.[^\s]+\//.test(value)) return false;
  try {
    const url = new URL(/^https?:\/\//i.test(value) ? value : `https://${value}`);
    return url.pathname.replace(/\/$/, "") !== "";
  } catch {
    return false;
  }
}

export default function AddSourceDialog({
  feeds,
  keyHeaders,
  defaultFeedId,
  onCancel,
  onAdd,
}: Props) {
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<DiscoverResult | null>(null);
  const [scope, setScope] = useState<"auto" | "site">("auto");
  const [tab, setTab] = useState<"paste" | "apis">("paste");
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

  async function runPreview(
    nextScope: "auto" | "site" = scope,
    override?: string,
  ) {
    const value = (override ?? query).trim();
    if (!value) return;
    if (override) setQuery(override);
    setLoading(true);
    setError(null);
    setPreview(null);
    setScope(nextScope);
    try {
      const res = await fetch(
        `/api/discover?q=${encodeURIComponent(value)}` +
          (nextScope === "site" ? "&scope=site" : ""),
        { headers: keyHeaders },
      );
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
          <button
            className="dialog-close"
            aria-label="Close"
            onClick={onCancel}
          >
            {Icon.close}
          </button>
          <h2>Add a source</h2>
          <p>
            {tab === "paste"
              ? "Paste a website, a Substack, an RSS URL, an X account like @OpenAI — or just type a topic. Sites without a feed are read straight from the page."
              : "Follow a data API — court opinions, federal rules, filings, papers. Fill in what you want and it becomes a source like any other."}
          </p>
          <div className="scope-switch dialog-tabs">
            <button
              className={tab === "paste" ? "on" : ""}
              onClick={() => setTab("paste")}
            >
              Paste a link
            </button>
            <button
              className={tab === "apis" ? "on" : ""}
              onClick={() => setTab("apis")}
            >
              API directory
            </button>
          </div>
        </div>

        <div className="dialog-body">
          {tab === "apis" && (
            <ApiCatalog
              busy={loading}
              onPreview={(sourceUrl) => runPreview("auto", sourceUrl)}
            />
          )}

          {tab === "paste" && (
          <div className="row">
            <input
              ref={inputRef}
              className="input"
              placeholder="stratechery.com, @OpenAI, or a topic"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") runPreview("auto");
              }}
            />
            <button
              className="btn small"
              onClick={() => runPreview("auto")}
              disabled={loading || !query.trim()}
            >
              {loading ? <span className="spinner" /> : "Preview"}
            </button>
          </div>
          )}

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
                      : preview.kind === "x"
                        ? "X account"
                        : preview.kind === "api"
                          ? "API source"
                          : hostOf(preview.siteUrl)}{" "}
                    · {preview.articles.length} recent articles
                    {preview.kind === "page" && (
                      <em className="badge">built from the page — no RSS</em>
                    )}
                  </span>
                </div>
              </div>
              {tab === "paste" && pastedASection(query) && (
                <div className="scope-row">
                  <span>Covering</span>
                  <div className="scope-switch">
                    <button
                      className={preview.scope === "section" ? "on" : ""}
                      onClick={() => runPreview("auto")}
                      disabled={loading}
                    >
                      This section
                    </button>
                    <button
                      className={preview.scope === "site" ? "on" : ""}
                      onClick={() => runPreview("site")}
                      disabled={loading}
                    >
                      Whole site
                    </button>
                  </div>
                </div>
              )}

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
