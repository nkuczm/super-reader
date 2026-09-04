"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { Article, DiscoverResult } from "@/lib/types";
import {
  loadFeeds,
  saveFeeds,
  loadRead,
  saveRead,
  newId,
  type Feed,
  type Source,
} from "@/lib/store";
import AddSourceDialog from "./AddSourceDialog";
import SourceIcon from "./SourceIcon";
import { Icon } from "./icons";
import { timeAgo, hostOf } from "./format";
import "./reader.css";

type Loaded = Article & { sourceId: string };
type Selection = { type: "all" } | { type: "feed" | "source"; id: string };

export default function Reader() {
  const [feeds, setFeeds] = useState<Feed[]>([]);
  const [ready, setReady] = useState(false);
  const [articles, setArticles] = useState<Loaded[]>([]);
  const [read, setRead] = useState<Set<string>>(new Set());
  const [selection, setSelection] = useState<Selection>({ type: "all" });
  const [dialogOpen, setDialogOpen] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  useEffect(() => {
    setFeeds(loadFeeds());
    setRead(loadRead());
    setReady(true);
  }, []);

  useEffect(() => {
    if (ready) saveFeeds(feeds);
  }, [feeds, ready]);

  const allSources = useMemo(
    () => feeds.flatMap((feed) => feed.sources),
    [feeds],
  );

  /** Fetch every known feed and merge the results newest-first. */
  const refresh = useCallback(async (sources: Source[]) => {
    if (sources.length === 0) {
      setArticles([]);
      return;
    }
    setRefreshing(true);
    try {
      const params = new URLSearchParams();
      for (const source of sources) params.append("url", source.feedUrl);
      const res = await fetch(`/api/feed?${params}`);
      const data = await res.json();

      const byUrl = new Map(sources.map((s) => [s.feedUrl, s.id]));
      const merged: Loaded[] = [];
      for (const result of data.results ?? []) {
        const sourceId = byUrl.get(result.feedUrl);
        if (!sourceId) continue;
        for (const article of result.articles as Article[]) {
          merged.push({ ...article, sourceId, id: `${sourceId}:${article.id}` });
        }
      }
      merged.sort(
        (a, b) =>
          Date.parse(b.publishedAt ?? "0") - Date.parse(a.publishedAt ?? "0"),
      );
      setArticles(merged);
    } finally {
      setRefreshing(false);
    }
  }, []);

  // Reload whenever the set of sources changes.
  const sourceKey = allSources.map((s) => s.feedUrl).join("|");
  useEffect(() => {
    if (ready) refresh(allSources);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sourceKey, ready]);

  function addSource(result: DiscoverResult, target: string) {
    const source: Source = {
      id: newId(),
      kind: result.kind,
      feedUrl: result.feedUrl,
      siteUrl: result.siteUrl,
      title: result.title,
      description: result.description,
      favicon: result.favicon,
    };

    setFeeds((current) => {
      const exists = current.some((feed) => feed.id === target);
      if (!exists) {
        const feed: Feed = {
          id: newId(),
          name: result.title,
          sources: [source],
        };
        setSelection({ type: "feed", id: feed.id });
        return [...current, feed];
      }
      return current.map((feed) =>
        feed.id === target
          ? // Adding the same feed twice is a no-op rather than a duplicate.
            feed.sources.some((s) => s.feedUrl === source.feedUrl)
            ? feed
            : { ...feed, sources: [...feed.sources, source] }
          : feed,
      );
    });
    setDialogOpen(false);
  }

  function addFeed() {
    const name = window.prompt("Name this feed", "New feed")?.trim();
    if (!name) return;
    const feed: Feed = { id: newId(), name, sources: [] };
    setFeeds((current) => [...current, feed]);
    setSelection({ type: "feed", id: feed.id });
  }

  function removeFeed(id: string) {
    const feed = feeds.find((f) => f.id === id);
    if (!feed) return;
    if (!window.confirm(`Delete “${feed.name}” and its sources?`)) return;
    setFeeds((current) => current.filter((f) => f.id !== id));
    setSelection({ type: "all" });
  }

  function removeSource(feedId: string, sourceId: string) {
    setFeeds((current) =>
      current.map((feed) =>
        feed.id === feedId
          ? { ...feed, sources: feed.sources.filter((s) => s.id !== sourceId) }
          : feed,
      ),
    );
    setSelection({ type: "all" });
  }

  function renameFeed(feed: Feed) {
    const name = window.prompt("Rename feed", feed.name)?.trim();
    if (!name) return;
    setFeeds((current) =>
      current.map((f) => (f.id === feed.id ? { ...f, name } : f)),
    );
  }

  function markRead(id: string) {
    setRead((current) => {
      const next = new Set(current).add(id);
      saveRead(next);
      return next;
    });
  }

  const visible = useMemo(() => {
    if (selection.type === "all") return articles;
    if (selection.type === "source") {
      return articles.filter((a) => a.sourceId === selection.id);
    }
    const feed = feeds.find((f) => f.id === selection.id);
    const ids = new Set(feed?.sources.map((s) => s.id));
    return articles.filter((a) => ids.has(a.sourceId));
  }, [articles, feeds, selection]);

  const sourceById = useMemo(
    () => new Map(allSources.map((s) => [s.id, s])),
    [allSources],
  );

  const heading =
    selection.type === "all"
      ? "All articles"
      : selection.type === "feed"
        ? (feeds.find((f) => f.id === selection.id)?.name ?? "Feed")
        : (sourceById.get(selection.id)?.title ?? "Source");

  const unread = (items: Loaded[]) =>
    items.filter((a) => !read.has(a.id)).length;

  return (
    <div className="app">
      <aside className="sidebar">
        <div className="brand">
          {Icon.logo} Super Reader
        </div>

        <div className="sidebar-scroll">
          <button
            className={`nav-item ${selection.type === "all" ? "active" : ""}`}
            onClick={() => setSelection({ type: "all" })}
          >
            {Icon.inbox}
            <span className="feed-name">All articles</span>
            <span className="count">{unread(articles) || ""}</span>
          </button>

          {feeds.map((feed) => {
            const ids = new Set(feed.sources.map((s) => s.id));
            const count = unread(articles.filter((a) => ids.has(a.sourceId)));
            return (
              <div className="feed-group" key={feed.id}>
                <div className="feed-head">
                  <button
                    className={`nav-item ${
                      selection.type === "feed" && selection.id === feed.id
                        ? "active"
                        : ""
                    }`}
                    onClick={() => setSelection({ type: "feed", id: feed.id })}
                    onDoubleClick={() => renameFeed(feed)}
                    title="Double-click to rename"
                  >
                    <span className="feed-name">{feed.name}</span>
                    <span className="count">{count || ""}</span>
                  </button>
                  <button
                    className="icon-btn danger"
                    onClick={() => removeFeed(feed.id)}
                    aria-label={`Delete ${feed.name}`}
                  >
                    {Icon.trash}
                  </button>
                </div>

                {feed.sources.length === 0 && (
                  <div className="empty-hint">No sources yet</div>
                )}

                {feed.sources.map((source) => (
                  <div className="source-row" key={source.id}>
                    <button
                      className={`nav-item ${
                        selection.type === "source" && selection.id === source.id
                          ? "active"
                          : ""
                      }`}
                      onClick={() =>
                        setSelection({ type: "source", id: source.id })
                      }
                    >
                      <SourceIcon src={source.favicon} title={source.title} />
                      <span className="feed-name">{source.title}</span>
                    </button>
                    <button
                      className="icon-btn danger"
                      onClick={() => removeSource(feed.id, source.id)}
                      aria-label={`Remove ${source.title}`}
                    >
                      {Icon.trash}
                    </button>
                  </div>
                ))}
              </div>
            );
          })}
        </div>

        <div className="sidebar-foot">
          <button className="btn ghost small" onClick={addFeed} style={{ width: "100%" }}>
            {Icon.plus} New feed
          </button>
        </div>
      </aside>

      <main className="main">
        <div className="main-head">
          <div>
            <h1>{heading}</h1>
            <p className="sub">
              {visible.length} article{visible.length === 1 ? "" : "s"}
              {allSources.length > 0 &&
                ` · ${allSources.length} source${allSources.length === 1 ? "" : "s"}`}
            </p>
          </div>
          <div className="head-actions">
            <button
              className="btn ghost small"
              onClick={() => refresh(allSources)}
              disabled={refreshing || allSources.length === 0}
            >
              {refreshing ? <span className="spinner" /> : Icon.refresh}
              Refresh
            </button>
            <button className="btn small" onClick={() => setDialogOpen(true)}>
              {Icon.plus} Add source
            </button>
          </div>
        </div>

        {!ready ? null : allSources.length === 0 ? (
          <div className="state">
            <h2>Start with one link.</h2>
            <p>
              Paste a website, a Substack, or an RSS URL — or just type a topic.
              You’ll see a preview of what lands in your feed before you keep it.
            </p>
            <button className="btn small" onClick={() => setDialogOpen(true)}>
              {Icon.plus} Add your first source
            </button>
          </div>
        ) : visible.length === 0 ? (
          <div className="state">
            <h2>{refreshing ? "Loading articles…" : "Nothing here yet."}</h2>
            {!refreshing && <p>This selection has no articles right now.</p>}
          </div>
        ) : (
          <div className="articles">
            {visible.map((article) => {
              const source = sourceById.get(article.sourceId);
              return (
                <article
                  className={`article ${read.has(article.id) ? "read" : ""}`}
                  key={article.id}
                >
                  <div className="article-body">
                    <div className="article-meta">
                      {source && (
                        <SourceIcon
                          src={source.favicon}
                          title={source.title}
                          size={15}
                        />
                      )}
                      <span>{source?.title ?? hostOf(article.link)}</span>
                      {article.author && (
                        <>
                          <span className="dot">·</span>
                          <span>{article.author}</span>
                        </>
                      )}
                      {article.publishedAt && (
                        <>
                          <span className="dot">·</span>
                          <span>{timeAgo(article.publishedAt)}</span>
                        </>
                      )}
                    </div>
                    <a
                      className="article-title"
                      href={article.link}
                      target="_blank"
                      rel="noreferrer noopener"
                      onClick={() => markRead(article.id)}
                    >
                      {article.title}
                    </a>
                    {article.summary && (
                      <p className="article-summary">{article.summary}</p>
                    )}
                  </div>
                  {article.image && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      className="thumb"
                      src={article.image}
                      alt=""
                      loading="lazy"
                      // Drop the slot entirely if the image 404s.
                      onError={(event) => {
                        event.currentTarget.style.display = "none";
                      }}
                    />
                  )}
                </article>
              );
            })}
          </div>
        )}
      </main>

      {dialogOpen && (
        <AddSourceDialog
          feeds={feeds}
          defaultFeedId={
            selection.type === "feed" ? selection.id : feeds[0]?.id
          }
          onCancel={() => setDialogOpen(false)}
          onAdd={addSource}
        />
      )}
    </div>
  );
}
