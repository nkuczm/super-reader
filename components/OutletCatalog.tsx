"use client";

import { useEffect, useMemo, useRef, useState } from "react";
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

/** The news desks, in the order their chips are shown. */
const NEWS_LABELS: Partial<Record<OutletCategory, string>> = {
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

/** The disciplines: journals, preprint servers and working papers, social sciences and humanities first. */
const DISCIPLINE_LABELS: Partial<Record<OutletCategory, string>> = {
  economics: "Economics & finance",
  psychology: "Psychology",
  sociology: "Sociology & demography",
  polisci: "Political science",
  anthropology: "Anthropology",
  history: "History",
  philosophy: "Philosophy",
  linguistics: "Linguistics",
  education: "Education",
  legal: "Legal scholarship",
  geography: "Geography & urban studies",
  humanities: "Literature, arts & classics",
  neuroscience: "Neuroscience",
  biology: "Biology & genetics",
  ecology: "Ecology & evolution",
  medicine: "Medicine & public health",
  physics: "Physics & astronomy",
  chemistry: "Chemistry & materials",
  earth: "Earth & climate",
  mathematics: "Mathematics & statistics",
  computing: "Computer science & AI",
  research: "General science",
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
  onPicked,
}: {
  /**
   * Called with the current selection on every change. The button that acts
   * on it lives in the dialog's footer, where it stays put while this list
   * scrolls — at the bottom of a list of a hundred and fifty outlets it was
   * somewhere nobody would find it.
   */
  onPicked: (sources: PickedSource[]) => void;
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

  // The dialog footer owns the button, so it needs the selection.
  useEffect(() => {
    onPicked(Object.values(picked));
    // onPicked is a fresh closure each render in the parent; depending on it
    // would loop.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [picked]);

  /**
   * One tap is one change. An iPhone could deliver a tap on a row to the row
   * and again to its box, which ticked it and unticked it in the same moment;
   * the same row changing twice that fast is the same tap.
   */
  const lastToggle = useRef<{ key: string; at: number } | null>(null);
  function toggle(key: string, source: PickedSource) {
    const now = Date.now();
    if (lastToggle.current?.key === key && now - lastToggle.current.at < 450) return;
    lastToggle.current = { key, at: now };
    setPicked((current) => {
      const next = { ...current };
      if (next[key]) delete next[key];
      else next[key] = source;
      return next;
    });
  }

  /** The keys a bundle covers, skipping anything the directory lacks. */
  function packKeys(pack: Directory["packs"][number]) {
    if (!dir) return [];
    const keys: [string, PickedSource][] = [];
    for (const id of pack.outlets) {
      const outlet = dir.outlets.find((o) => o.id === id);
      if (outlet) keys.push([`o:${outlet.id}`, outletAsSource(outlet)]);
    }
    for (const name of pack.subreddits ?? []) {
      const entry = dir.subreddits.find(
        (s) => s.name.toLowerCase() === name.toLowerCase(),
      );
      if (entry) keys.push([`r:${entry.name}`, subredditAsSource(entry)]);
    }
    return keys;
  }

  /**
   * Tapping a bundle selects all of it, and tapping it again lets go — so a
   * mis-tap is undoable at the same button, and the button's own state says
   * whether the tap landed. Before this, a bundle ticked boxes far down a
   * scrolling list and looked like it had done nothing at all.
   */
  function togglePack(pack: Directory["packs"][number]) {
    const keys = packKeys(pack);
    if (keys.length === 0) return;
    const allPicked = keys.every(([key]) => picked[key]);
    setPicked((current) => {
      const next = { ...current };
      for (const [key, source] of keys) {
        if (allPicked) delete next[key];
        else next[key] = source;
      }
      return next;
    });
  }

  /**
   * A whole discipline in one tap, from the discipline itself: every journal
   * and preprint server in it, or none of them again. A bundle chip would
   * need maintaining by hand for twenty-two disciplines; the list already
   * says what belongs to each.
   */
  const discipline = category in DISCIPLINE_LABELS ? (category as OutletCategory) : null;
  const inDiscipline = dir && discipline ? dir.outlets.filter((outlet) => outlet.category === discipline) : [];
  const allInDiscipline = inDiscipline.length > 0 && inDiscipline.every((outlet) => picked[`o:${outlet.id}`]);
  function toggleDiscipline() {
    setPicked((current) => {
      const next = { ...current };
      for (const outlet of inDiscipline) {
        if (allInDiscipline) delete next[`o:${outlet.id}`];
        else next[`o:${outlet.id}`] = outletAsSource(outlet);
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

      <p className="field-label">Whole beats</p>
      <div className="outlet-packs">
        {dir.packs.map((pack) => {
          const keys = packKeys(pack);
          const on = keys.length > 0 && keys.every(([key]) => picked[key]);
          return (
            <button
              key={pack.id}
              className={`chip pack-chip ${on ? "on" : ""}`}
              title={`${pack.blurb} — ${keys.length} sources`}
              aria-pressed={on}
              onClick={() => togglePack(pack)}
            >
              {on ? Icon.check : Icon.plus} {pack.name}
              <em>{keys.length}</em>
            </button>
          );
        })}
      </div>

      <p className="field-label">Or pick them one by one</p>

      <div className="outlet-cats">
        {(["all", "reddit", ...Object.keys(NEWS_LABELS)] as (OutletCategory | "all" | "reddit")[]).map(
          (key) => (
            <button
              key={key}
              className={`chip ${category === key ? "on" : ""}`}
              onClick={() => setCategory(key)}
            >
              {key === "all" ? "Everything" : key === "reddit" ? "Reddit" : NEWS_LABELS[key]}
            </button>
          ),
        )}
      </div>

      <p className="field-label">Journals and papers, by discipline</p>
      <div className="outlet-cats">
        {(Object.keys(DISCIPLINE_LABELS) as OutletCategory[]).map((key) => (
          <button
            key={key}
            className={`chip ${category === key ? "on" : ""}`}
            onClick={() => setCategory(category === key ? "all" : key)}
          >
            {DISCIPLINE_LABELS[key]}
          </button>
        ))}
      </div>

      {discipline && inDiscipline.length > 0 && (
        <button
          className={`chip pack-chip discipline-all ${allInDiscipline ? "on" : ""}`}
          aria-pressed={allInDiscipline}
          onClick={toggleDiscipline}
        >
          {allInDiscipline ? Icon.check : Icon.plus} All of {DISCIPLINE_LABELS[discipline]}
          <em>{inDiscipline.length}</em>
        </button>
      )}

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

    </div>
  );
}
