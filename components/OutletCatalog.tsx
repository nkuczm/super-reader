"use client";

import { useEffect, useMemo, useState } from "react";
import type { Outlet, OutletCategory, SubredditEntry } from "@/lib/outlets";
import { Icon } from "./icons";

export type PickedSource = {
  feedUrl: string;
  siteUrl: string;
  title: string;
  favicon: string;
};

type Directory = {
  outlets: Outlet[];
  subreddits: SubredditEntry[];
  packs: { id: string; name: string; blurb: string; outlets: string[]; subreddits?: string[] }[];
  panel: { outlets: number; subreddits: number };
};

const CATEGORY_LABELS: Record<OutletCategory, string> = {
  general: "General news",
  world: "World",
  politics: "Politics",
  business: "Business",
  tech: "Technology",
  science: "Science",
  health: "Health",
  law: "Law & courts",
  climate: "Climate",
  investigative: "Investigative",
  local: "Local",
  culture: "Culture",
  sports: "Sport",
  aggregator: "Aggregators",
};

function faviconFor(host: string) {
  return `https://www.google.com/s2/favicons?domain=${host}&sz=64`;
}

function hostOf(url: string) {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

function outletAsSource(outlet: Outlet): PickedSource {
  return {
    feedUrl: outlet.feedUrl,
    siteUrl: outlet.siteUrl,
    title: outlet.section && outlet.section !== "All" ? `${outlet.name} · ${outlet.section}` : outlet.name,
    favicon: faviconFor(hostOf(outlet.siteUrl)),
  };
}

function subredditAsSource(entry: SubredditEntry): PickedSource {
  return {
    feedUrl: `https://www.reddit.com/r/${entry.name}/.rss`,
    siteUrl: `https://www.reddit.com/r/${entry.name}/`,
    title: entry.label,
    favicon: faviconFor("reddit.com"),
  };
}

/**
 * The directory of outlets and subreddits: tick what you want, add it all at
 * once. Known-good feeds, so nothing is previewed one at a time the way a
 * pasted URL is — the first refresh fills them in.
 */
export default function OutletCatalog({
  onAddMany,
  busy,
}: {
  onAddMany: (sources: PickedSource[]) => void;
  busy: boolean;
}) {
  const [dir, setDir] = useState<Directory | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<OutletCategory | "all" | "reddit">("all");
  const [picked, setPicked] = useState<Record<string, PickedSource>>({});

  useEffect(() => {
    let live = true;
    fetch("/api/outlets")
      .then((res) => res.json())
      .then((data) => live && setDir(data as Directory))
      .catch(() => live && setError("Could not load the outlet directory."));
    return () => {
      live = false;
    };
  }, []);

  const pickedCount = Object.keys(picked).length;

  function toggle(key: string, source: PickedSource) {
    setPicked((current) => {
      const next = { ...current };
      if (next[key]) delete next[key];
      else next[key] = source;
      return next;
    });
  }

  function addPack(pack: Directory["packs"][number]) {
    if (!dir) return;
    setPicked((current) => {
      const next = { ...current };
      for (const id of pack.outlets) {
        const outlet = dir.outlets.find((o) => o.id === id);
        if (outlet) next[`o:${outlet.id}`] = outletAsSource(outlet);
      }
      for (const name of pack.subreddits ?? []) {
        const entry = dir.subreddits.find(
          (s) => s.name.toLowerCase() === name.toLowerCase(),
        );
        if (entry) next[`r:${entry.name}`] = subredditAsSource(entry);
      }
      return next;
    });
  }

  const matches = useMemo(() => {
    if (!dir) return { outlets: [] as Outlet[], subreddits: [] as SubredditEntry[] };
    const needle = query.trim().toLowerCase();
    const hit = (text: string) => text.toLowerCase().includes(needle);
    return {
      outlets:
        category === "reddit"
          ? []
          : dir.outlets.filter(
              (outlet) =>
                (category === "all" || outlet.category === category) &&
                (!needle ||
                  hit(outlet.name) ||
                  hit(outlet.section ?? "") ||
                  hit(outlet.region) ||
                  hit(hostOf(outlet.siteUrl))),
            ),
      subreddits:
        category === "all" || category === "reddit"
          ? dir.subreddits.filter((entry) => !needle || hit(entry.label))
          : dir.subreddits.filter(
              (entry) => entry.category === category && (!needle || hit(entry.label)),
            ),
    };
  }, [dir, query, category]);

  if (error) return <p className="error">{error}</p>;
  if (!dir) return <p className="api-note">Loading the directory…</p>;

  return (
    <div className="outlets">
      <p className="api-note">
        {dir.outlets.length} outlets and {dir.subreddits.length} subreddits.{" "}
        {dir.panel.outlets + dir.panel.subreddits} of them are also read to
        work out how big a story is, whichever sources you follow.
      </p>

      <input
        className="input"
        placeholder="Search outlets — name, section, region"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
      />

      <div className="outlet-packs">
        {dir.packs.map((pack) => (
          <button
            key={pack.id}
            className="btn ghost small"
            title={pack.blurb}
            onClick={() => addPack(pack)}
          >
            {Icon.plus} {pack.name}
          </button>
        ))}
      </div>

      <div className="outlet-cats">
        {(["all", "reddit", ...Object.keys(CATEGORY_LABELS)] as (OutletCategory | "all" | "reddit")[]).map(
          (key) => (
            <button
              key={key}
              className={`chip ${category === key ? "on" : ""}`}
              onClick={() => setCategory(key)}
            >
              {key === "all" ? "Everything" : key === "reddit" ? "Reddit" : CATEGORY_LABELS[key]}
            </button>
          ),
        )}
      </div>

      <ul className="outlet-list">
        {matches.outlets.map((outlet) => {
          const key = `o:${outlet.id}`;
          return (
            <li key={key}>
              <label>
                <input
                  type="checkbox"
                  checked={Boolean(picked[key])}
                  onChange={() => toggle(key, outletAsSource(outlet))}
                />
                <span className="outlet-name">
                  {outlet.name}
                  {outlet.section && outlet.section !== "All" && (
                    <em> · {outlet.section}</em>
                  )}
                </span>
                <span className="outlet-tags">
                  {outlet.region}
                  {outlet.front ? " · front page" : ""}
                  {outlet.panel ? " · ranking panel" : ""}
                </span>
              </label>
            </li>
          );
        })}
        {matches.subreddits.map((entry) => {
          const key = `r:${entry.name}`;
          return (
            <li key={key}>
              <label>
                <input
                  type="checkbox"
                  checked={Boolean(picked[key])}
                  onChange={() => toggle(key, subredditAsSource(entry))}
                />
                <span className="outlet-name">{entry.label}</span>
                <span className="outlet-tags">
                  Reddit{entry.panel ? " · ranking panel" : ""}
                </span>
              </label>
            </li>
          );
        })}
        {matches.outlets.length === 0 && matches.subreddits.length === 0 && (
          <li className="api-note">Nothing matches that.</li>
        )}
      </ul>

      <div className="outlet-add">
        <button
          className="btn small"
          disabled={pickedCount === 0 || busy}
          onClick={() => {
            onAddMany(Object.values(picked));
            setPicked({});
          }}
        >
          {Icon.plus} Add {pickedCount || ""} {pickedCount === 1 ? "source" : "sources"}
        </button>
        {pickedCount > 0 && (
          <button className="btn ghost small" onClick={() => setPicked({})}>
            Clear
          </button>
        )}
      </div>
    </div>
  );
}
