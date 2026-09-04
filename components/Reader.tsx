"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Article, DiscoverResult } from "@/lib/types";
import {
  loadFeeds,
  saveFeeds,
  loadRead,
  saveRead,
  loadSyncCode,
  saveSyncCode,
  newId,
  type Feed,
  type Source,
} from "@/lib/store";
import AddSourceDialog from "./AddSourceDialog";
import SyncDialog from "./SyncDialog";
import InlineName from "./InlineName";
import ArticleReader from "./ArticleReader";
import SourceIcon from "./SourceIcon";
import { Icon } from "./icons";
import { timeAgo, hostOf } from "./format";
import { sortNewestFirst } from "@/lib/sort";
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
  const [reading, setReading] = useState<{ url: string; title: string } | null>(
    null,
  );
  const [syncCode, setSyncCode] = useState<string | null>(null);
  const [syncOpen, setSyncOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  // Naming and deleting happen inline in the sidebar rather than in
  // browser prompt()/confirm() dialogs.
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<string | null>(null);
  const [syncState, setSyncState] = useState<
    "idle" | "working" | "saved" | "error"
  >("idle");
  // Set while applying data pulled from the server, so the save effect below
  // does not immediately push it straight back.
  const applying = useRef(false);

  useEffect(() => {
    setFeeds(loadFeeds());
    setRead(loadRead());
    setSyncCode(loadSyncCode());
    setReady(true);
  }, []);

  const applyRemote = useCallback((payload: { feeds?: Feed[]; read?: string[] }) => {
    applying.current = true;
    if (Array.isArray(payload.feeds)) setFeeds(payload.feeds);
    if (Array.isArray(payload.read)) {
      const next = new Set(payload.read);
      setRead(next);
      saveRead(next);
    }
    // Release on the next tick, after the state updates have flushed.
    setTimeout(() => {
      applying.current = false;
    }, 0);
  }, []);

  const pull = useCallback(
    async (code: string) => {
      const res = await fetch(`/api/sync?code=${encodeURIComponent(code)}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Could not fetch synced feeds");
      applyRemote(data.payload ?? {});
    },
    [applyRemote],
  );

  useEffect(() => {
    if (ready) saveFeeds(feeds);
  }, [feeds, ready]);

  // Pull once the code is known, and again whenever the window regains focus,
  // so a device left open picks up changes made elsewhere.
  useEffect(() => {
    if (!ready || !syncCode) return;
    let cancelled = false;

    const sync = async () => {
      setSyncState("working");
      try {
        await pull(syncCode);
        if (!cancelled) setSyncState("saved");
      } catch {
        if (!cancelled) setSyncState("error");
      }
    };

    sync();
    window.addEventListener("focus", sync);
    return () => {
      cancelled = true;
      window.removeEventListener("focus", sync);
    };
  }, [ready, syncCode, pull]);

  // Push local changes, debounced so a burst of edits is one request.
  useEffect(() => {
    if (!ready || !syncCode || applying.current) return;
    const timer = setTimeout(async () => {
      setSyncState("working");
      try {
        const res = await fetch("/api/sync", {
          method: "PUT",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ code: syncCode, feeds, read: [...read] }),
        });
        if (!res.ok) throw new Error("save failed");
        setSyncState("saved");
      } catch {
        setSyncState("error");
      }
    }, 900);
    return () => clearTimeout(timer);
  }, [feeds, read, ready, syncCode]);

  const startSync = useCallback(async () => {
    setSyncState("working");
    const res = await fetch("/api/sync", { method: "POST" });
    const data = await res.json();
    if (!res.ok) {
      setSyncState("error");
      throw new Error(data.error ?? "Could not start syncing");
    }

    // Upload what this device already has *before* the code goes live,
    // otherwise the first pull would overwrite these feeds with the empty
    // record we just created.
    const saved = await fetch("/api/sync", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ code: data.code, feeds, read: [...read] }),
    });
    if (!saved.ok) {
      setSyncState("error");
      throw new Error("Could not upload this device's feeds");
    }

    saveSyncCode(data.code);
    setSyncCode(data.code);
    setSyncState("saved");
  }, [feeds, read]);

  const connectSync = useCallback(
    async (entered: string) => {
      setSyncState("working");
      try {
        await pull(entered);
      } catch (error) {
        setSyncState("error");
        throw error;
      }
      saveSyncCode(entered);
      setSyncCode(entered);
      setSyncState("saved");
    },
    [pull],
  );

  const stopSync = useCallback(() => {
    saveSyncCode(null);
    setSyncCode(null);
    setSyncState("idle");
    setSyncOpen(false);
  }, []);

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
      setArticles(sortNewestFirst(merged));
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

  function createFeed(name: string) {
    const trimmed = name.trim();
    if (!trimmed) return;
    const feed: Feed = { id: newId(), name: trimmed, sources: [] };
    setFeeds((current) => [...current, feed]);
    setSelection({ type: "feed", id: feed.id });
    setAdding(false);
  }

  function removeFeed(id: string) {
    setFeeds((current) => current.filter((f) => f.id !== id));
    setSelection({ type: "all" });
    setConfirming(null);
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

  function renameFeed(id: string, name: string) {
    const trimmed = name.trim();
    setEditing(null);
    if (!trimmed) return;
    setFeeds((current) =>
      current.map((f) => (f.id === id ? { ...f, name: trimmed } : f)),
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

  // On a phone the drawer covers the list, so any choice should close it.
  const choose = useCallback((next: Selection) => {
    setSelection(next);
    setMenuOpen(false);
  }, []);

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
      <aside className={`sidebar ${menuOpen ? "open" : ""}`}>
        <div className="brand">
          {Icon.logo} Super Reader
        </div>

        <div className="sidebar-scroll">
          <button
            className={`nav-item ${selection.type === "all" ? "active" : ""}`}
            onClick={() => choose({ type: "all" })}
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
                  {editing === feed.id ? (
                    <InlineName
                      initial={feed.name}
                      onSubmit={(value) => renameFeed(feed.id, value)}
                      onCancel={() => setEditing(null)}
                    />
                  ) : confirming === feed.id ? (
                    <div className="confirm-row">
                      <span>Delete “{feed.name}”?</span>
                      <button
                        className="link-btn danger"
                        onClick={() => removeFeed(feed.id)}
                      >
                        Delete
                      </button>
                      <button
                        className="link-btn"
                        onClick={() => setConfirming(null)}
                      >
                        Keep
                      </button>
                    </div>
                  ) : (
                    <>
                      <button
                        className={`nav-item ${
                          selection.type === "feed" && selection.id === feed.id
                            ? "active"
                            : ""
                        }`}
                        onClick={() => choose({ type: "feed", id: feed.id })}
                        onDoubleClick={() => setEditing(feed.id)}
                        title="Double-click to rename"
                      >
                        <span className="feed-name">{feed.name}</span>
                        <span className="count">{count || ""}</span>
                      </button>
                      <button
                        className="icon-btn"
                        onClick={() => setEditing(feed.id)}
                        aria-label={`Rename ${feed.name}`}
                      >
                        {Icon.pencil}
                      </button>
                      <button
                        className="icon-btn danger"
                        onClick={() => setConfirming(feed.id)}
                        aria-label={`Delete ${feed.name}`}
                      >
                        {Icon.trash}
                      </button>
                    </>
                  )}
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
                      onClick={() => choose({ type: "source", id: source.id })}
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
          {adding ? (
            <InlineName
              placeholder="Name this feed"
              onSubmit={createFeed}
              onCancel={() => setAdding(false)}
            />
          ) : (
            <button
              className="btn ghost small"
              onClick={() => setAdding(true)}
              style={{ width: "100%" }}
            >
              {Icon.plus} New feed
            </button>
          )}
          <button
            className="sync-btn"
            onClick={() => setSyncOpen(true)}
            title={syncCode ? "Syncing across devices" : "Sync across devices"}
          >
            <span className={`sync-dot ${syncCode ? syncState : "off"}`} />
            {syncCode
              ? syncState === "working"
                ? "Syncing…"
                : syncState === "error"
                  ? "Sync problem"
                  : "Synced"
              : "Sync across devices"}
          </button>
        </div>
      </aside>

      {menuOpen && (
        <button
          className="scrim"
          aria-label="Close feeds"
          onClick={() => setMenuOpen(false)}
        />
      )}

      <main className="main">
        {reading ? (
          <ArticleReader
            url={reading.url}
            fallbackTitle={reading.title}
            onClose={() => setReading(null)}
          />
        ) : (
          <>
        <div className="main-head">
          <button
            className="menu-btn"
            onClick={() => setMenuOpen(true)}
            aria-label="Open feeds"
          >
            {Icon.menu}
          </button>
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
                      onClick={(event) => {
                        // Plain click reads in-app; modified clicks still open
                        // the original in a new tab.
                        if (
                          event.metaKey ||
                          event.ctrlKey ||
                          event.shiftKey ||
                          event.button !== 0
                        ) {
                          return;
                        }
                        event.preventDefault();
                        markRead(article.id);
                        setReading({ url: article.link, title: article.title });
                      }}
                    >
                      {article.title}
                    </a>
                    {article.summary && (
                      <p className="article-summary">{article.summary}</p>
                    )}
                    <button
                      className="read-btn"
                      onClick={() => {
                        markRead(article.id);
                        setReading({ url: article.link, title: article.title });
                      }}
                    >
                      {Icon.book} Read here
                    </button>
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
          </>
        )}
      </main>

      {syncOpen && (
        <SyncDialog
          code={syncCode}
          busy={syncState === "working"}
          onCreate={startSync}
          onConnect={connectSync}
          onDisconnect={stopSync}
          onClose={() => setSyncOpen(false)}
        />
      )}

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
