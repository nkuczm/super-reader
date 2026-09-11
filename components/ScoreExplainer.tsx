"use client";

import { useEffect } from "react";
import type { RankedArticle } from "@/lib/pulse";
import { WEIGHTS } from "@/lib/importance";
import { Icon } from "./icons";

export type CorpusStats = {
  storyCount: number;
  outletCount: number;
  windowHours?: number;
  builtAt?: number;
};

type Props = {
  rank: RankedArticle;
  title: string;
  corpus: CorpusStats | null;
  onClose: () => void;
  /** On a phone the drawer is the only way back to the feeds. */
  onOpenMenu?: () => void;
};

const BANDS: Record<RankedArticle["band"], string> = {
  major: "Major story",
  big: "Big story",
  notable: "Notable",
  quiet: "No wider coverage found",
};

function hours(value: number) {
  if (value < 1) return "under an hour";
  if (value < 48) return `${Math.round(value)} hours`;
  return `${Math.round(value / 24)} days`;
}

/**
 * Where the number came from.
 *
 * A score nobody can interrogate is just an assertion, and this one is
 * assembled from evidence that is all public — so every part is shown with
 * the reading that produced it, the weight it carries, and what it was
 * measured against. The figures here are the ones the server actually used:
 * the weights are imported from the scoring module rather than restated, so
 * this page cannot drift away from the arithmetic.
 */
export default function ScoreExplainer({
  rank,
  title,
  corpus,
  onClose,
  onOpenMenu,
}: Props) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  // Defensive: the ranking is cached server-side and a payload from an older
  // build can reach a newer page. The shape check in lib/corpus.ts should
  // prevent it; this makes the failure a thinner page rather than a crash.
  const parts = rank.parts ?? { breadth: 0, placement: 0, engagement: 0, velocity: 0 };
  const evidence =
    rank.evidence ?? { weighted: 0, ceiling: 9, subreddits: [], comments: 0, ageHours: 0 };
  const copies = rank.titles ?? [];
  const rows = [
    {
      id: "breadth",
      name: "Breadth",
      weight: WEIGHTS.breadth,
      value: parts.breadth,
      headline: `${rank.newsrooms} newsroom${rank.newsrooms === 1 ? "" : "s"}`,
      detail: `How many different newsrooms ran this story, weighted by reach — wires and agenda-setting papers count 1, major outlets 0.65, specialist and local 0.4. This story scores ${evidence.weighted} against a ceiling of ${evidence.ceiling}, the point where any more coverage stops telling you anything new. Counted per newsroom: a paper running it in two sections is one newsroom.`,
    },
    {
      id: "placement",
      name: "Placement",
      weight: WEIGHTS.placement,
      value: parts.placement,
      headline: evidence.front
        ? evidence.front.position === 0
          ? `Leading ${evidence.front.newsroom}`
          : `#${evidence.front.position + 1} on ${evidence.front.newsroom}`
        : evidence.section
          ? `#${evidence.section.position + 1} in a section feed`
          : "No placement recorded",
      detail:
        "Where it sat. Position in a front-page or top-stories feed is an editor ranking the day, so it counts fully. Position in a section feed is mostly just recency, so it counts for about a third as much. The best few placements are averaged, so one outlet burying a story cannot sink it and one outlet leading with it cannot carry it alone.",
    },
    {
      id: "engagement",
      name: "Engagement",
      weight: WEIGHTS.engagement,
      value: parts.engagement,
      headline:
        evidence.subreddits.length > 0
          ? `${evidence.subreddits.length} subreddit${evidence.subreddits.length === 1 ? "" : "s"}${
              evidence.comments > 0 ? `, ${evidence.comments.toLocaleString()} comments` : ""
            }`
          : evidence.comments > 0
            ? `${evidence.comments.toLocaleString()} comments`
            : "No discussion found",
      detail: `What readers did with it: which communities carried it and how near the top of their own day's ranking${
        evidence.subreddits.length > 0
          ? ` — ${evidence.subreddits
              .slice(0, 6)
              .map((hit) => `r/${hit.subreddit} at #${hit.position + 1}`)
              .join(", ")}`
          : ""
      }. Comment counts are used wherever a feed reports them. Reddit's own vote and comment numbers are not reachable from this app's server, so the position in a community's top-of-day list stands in for them.`,
    },
    {
      id: "velocity",
      name: "Velocity",
      weight: WEIGHTS.velocity,
      value: parts.velocity,
      headline: `First seen ${hours(evidence.ageHours)} ago`,
      detail:
        "How fast that breadth arrived. Ten newsrooms inside two hours is breaking news; the same ten over three days is a topic. This is the smallest part of the score on purpose — it fades as a story ages, and a story should not stop being big just because it is a day old.",
    },
  ];

  return (
    <div className="reader score-page">
      <div className="reader-bar">
        {onOpenMenu && (
          <button className="menu-btn" onClick={onOpenMenu} aria-label="Open feeds">
            {Icon.menu}
          </button>
        )}
        <button className="btn ghost small" onClick={onClose}>
          {Icon.back} Back
        </button>
      </div>

      <article className="score-body">
        <div className="score-hero">
          <div className={`score-dot big rank-${rank.band}`} aria-hidden="true">
            {rank.score}
          </div>
          <div>
            <h1>{BANDS[rank.band]}</h1>
            <p className="score-sub">
              {rank.score} out of 100 · {rank.reasons.join(" · ")}
            </p>
          </div>
        </div>

        <p className="score-lede">
          <strong>{title}</strong>
        </p>
        <p className="score-note">
          This is not an opinion about the story — it is a count of what the
          press and its readers did with it, which you can check below.
          {rank.via === "headline" && (
            <>
              {" "}
              This article was matched to the story by its headline rather than
              by its link, so the copies listed are ones with closely matching
              wording.
            </>
          )}
        </p>

        <div className="score-rows">
          {rows.map((row) => (
            <section key={row.id} className="score-row">
              <header>
                <strong>{row.name}</strong>
                <span className="score-weight">{Math.round(row.weight * 100)}% of the score</span>
              </header>
              <div className="score-meter" aria-hidden="true">
                <span style={{ width: `${Math.round(row.value * 100)}%` }} />
              </div>
              <p className="score-reading">
                {row.headline}
                <em> · {Math.round(row.value * 100)} of 100 on this measure</em>
              </p>
              <p className="score-detail">{row.detail}</p>
            </section>
          ))}
        </div>

        <h2 className="score-h2">
          The {copies.length} cop{copies.length === 1 ? "y" : "ies"} this is counted
          from
        </h2>
        <ul className="score-copies">
          {copies.map((entry) => (
            <li key={entry}>{entry}</li>
          ))}
        </ul>

        <h2 className="score-h2">What it was measured against</h2>
        <p className="score-detail">
          {corpus
            ? `${corpus.storyCount.toLocaleString()} stories collected from ${corpus.outletCount} feeds over the last ${corpus.windowHours ?? 48} hours.`
            : "The story corpus this deployment collects from its outlet panel."}{" "}
          The panel is a fixed set of newsrooms read on a rolling schedule, so
          &ldquo;more newsrooms than usual ran this&rdquo; means the same thing
          from one day to the next. Only headlines, links and positions are
          recorded — nothing about what you read.
        </p>

        <h2 className="score-h2">Where it is weakest</h2>
        <p className="score-detail">
          Copies are matched by URL first and by headline second, so two
          write-ups sharing only a single distinctive word — a paper and a
          journal on the same study, say — are counted separately, and the
          story is understated. Scores are conservative for that reason. A
          story with no wider coverage gets no number at all rather than a
          guess.
        </p>
      </article>
    </div>
  );
}
