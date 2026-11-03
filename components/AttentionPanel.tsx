"use client";

import { useEffect, useRef, useState } from "react";
import {
  FIELD_WEIGHT,
  KNOWN_FOR_DAYS,
  NEWS_CYCLE_DAYS,
  noveltyLabel,
  scoreOf,
  stakesLabel,
  type AttentionRequest,
  type AttentionResult,
  type Earlier,
} from "@/lib/attention";
import { MODEL_CHOICES } from "@/lib/models";
import { loadSyncCode } from "@/lib/store";
import { recordSpend, shareSpend } from "@/lib/spend";

/** What the reader supplies: the AI to use, and what it already holds about this story. */
export type AttentionSetup = {
  provider: "anthropic" | "openai";
  model: string;
  hasKey: boolean;
  /** The reader's API keys, in the header the server reads them from. */
  keyHeaders: Record<string, string>;
  /** The reader's earlier stories like this one, the coverage it has had, and where its source sits. */
  context: (story: { url: string; title: string; publishedAt?: string; summary?: string }) =>
    Pick<AttentionRequest, "earlier" | "coverage" | "source"> & { publishedAt?: string };
  onOpenStory?: (link: string, title: string) => void;
};

type Held = { at: number; model: string; result: AttentionResult; earlier: Earlier[] };

// v2: novelty measured by staleness, not by how many others ran the story (3 Nov 2026).
const CACHE_KEY = "super-reader:attention:v2";
const CACHE_MAX = 200;

/*
 * Each story is scored once: opening it again shows the same judgment
 * rather than spending again. Kept per device, newest two hundred.
 */
function cached(url: string): Held | null {
  try {
    return (JSON.parse(localStorage.getItem(CACHE_KEY) ?? "{}") as Record<string, Held>)[url] ?? null;
  } catch {
    return null;
  }
}
function keep(url: string, held: Held) {
  try {
    const all = JSON.parse(localStorage.getItem(CACHE_KEY) ?? "{}") as Record<string, Held>;
    all[url] = held;
    const entries = Object.entries(all).sort((a, b) => b[1].at - a[1].at).slice(0, CACHE_MAX);
    localStorage.setItem(CACHE_KEY, JSON.stringify(Object.fromEntries(entries)));
  } catch {
    /* not kept: it is scored again next time */
  }
}

const textOf = (html: string) =>
  html.replace(/<(script|style)[\s\S]*?<\/\1>/gi, " ").replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/\s+/g, " ").trim();

const verdictOf = (attention: number) =>
  attention >= 70 ? "Pay close attention" : attention >= 40 ? "Worth your attention" : attention >= 15 ? "Some attention" : "Low priority";

/** "Oct 28", or "Oct 28, 2025" from another year. */
const dayOf = (date: string) => {
  const at = new Date(`${date.slice(0, 10)}T12:00:00Z`);
  if (Number.isNaN(at.getTime())) return date;
  return at.toLocaleDateString(undefined, { month: "short", day: "numeric", ...(at.getFullYear() !== new Date().getFullYear() ? { year: "numeric" } : {}) });
};

const VERDICT_NAME = {
  confirmed: "Confirmed",
  disputed: "Disputed",
  overstated: "Overstated",
  understated: "Understated",
  unverified: "Could not confirm",
} as const;

const modelName = (id: string) =>
  [...MODEL_CHOICES.anthropic, ...MODEL_CHOICES.openai].find((m) => id === m.id || id.startsWith(`${m.id}-`))?.name ?? id;

/**
 * How much attention this story deserves, on the story page: the score and
 * what it rests on — the lives at stake, its weight in its own field, and
 * what is new in it against what the reader already has. Scored once the
 * story has loaded, on the reader's own key, and kept.
 */
export default function AttentionPanel({
  setup,
  url,
  title,
  html,
  summary,
  siteName,
  byline,
  publishedAt,
  ready,
}: {
  setup: AttentionSetup;
  url: string;
  title: string;
  /** The article as read, or nothing when only the feed's summary is to hand. */
  html?: string;
  summary?: string;
  siteName?: string;
  byline?: string;
  publishedAt?: string;
  /** Whether the story has finished loading, one way or the other: it is judged on its full text. */
  ready: boolean;
}) {
  const [held, setHeld] = useState<Held | null>(() => cached(url));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<{ text: string; needsKey?: boolean } | null>(null);
  const [open, setOpen] = useState(false);
  const asked = useRef<string | null>(null);

  useEffect(() => {
    setHeld(cached(url));
    setError(null);
    setOpen(false);
    asked.current = null;
  }, [url]);

  const run = async (again = false) => {
    if (!setup.hasKey) {
      setError({ text: `Add your ${setup.provider === "openai" ? "OpenAI" : "Anthropic"} key under Settings → Account to score stories.`, needsKey: true });
      return;
    }
    const text = textOf(html || summary || "");
    const { publishedAt: listed, ...context } = setup.context({ url, title, publishedAt, summary });
    const body: AttentionRequest = {
      provider: setup.provider,
      model: setup.model,
      article: { url, title, siteName, byline, publishedAt: publishedAt ?? listed, text },
      ...context,
    };
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/attention", {
        method: "POST",
        headers: { "content-type": "application/json", ...setup.keyHeaders },
        body: JSON.stringify(body),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError({ text: data.error ?? "Could not score this story.", needsKey: data.needsKey });
        return;
      }
      const result = data as AttentionResult;
      for (const usage of result.usages ?? []) shareSpend(loadSyncCode(), recordSpend({ ...usage, activity: "importance" }));
      const next: Held = { at: Date.now(), model: result.usages?.[0]?.model ?? setup.model, result, earlier: context.earlier };
      keep(url, next);
      setHeld(next);
      if (again) setOpen(true);
    } catch {
      setError({ text: "Could not reach the server to score this story." });
    } finally {
      setBusy(false);
    }
  };

  // Scored once the story has loaded, unless it already has been.
  useEffect(() => {
    if (!ready || held || asked.current === url) return;
    asked.current = url;
    void run();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, url, held]);

  if (!held) {
    if (busy || (!error && !ready)) {
      return (
        <div className="attention attention-busy" role="status">
          <span className="attention-dot" aria-hidden="true" />
          {busy ? "Weighing what is new in this story and what rides on it…" : "Story importance will be scored once the story loads."}
        </div>
      );
    }
    if (!error) return null;
    return (
      <div className="attention attention-error" role="status">
        <span>{error.text}</span>
        {!error.needsKey && (
          <button className="link-btn" onClick={() => void run()}>
            Try again
          </button>
        )}
      </div>
    );
  }

  const { assessment: a, verification: v, usages } = held.result;
  const score = scoreOf(a);
  const known = held.earlier.filter((e) => a.knownFrom.includes(e.id));
  const cost = (usages ?? []).reduce((sum, u) => sum + (recordCostOf(u) ?? 0), 0);
  const label = noveltyLabel(a);
  const knownDays = Number.isFinite(a.knownDays) ? a.knownDays! : KNOWN_FOR_DAYS[a.knownFor] ?? 0;
  const at = Date.parse(publishedAt ?? "");
  /** "3 days before it", "the same day" — an earlier story's place against this one. */
  const before = (date?: string) => {
    const t = Date.parse(date ?? "");
    if (!Number.isFinite(t) || !Number.isFinite(at)) return "";
    const days = (at - t) / 86_400_000;
    return days < 1 ? "the same day" : days < 2 ? "the day before" : `${Math.round(days)} days before`;
  };
  /** How long its main point had been known, and what that does to the score. */
  const staleNote =
    knownDays <= NEWS_CYCLE_DAYS
      ? a.novelty === "new" ? "" : "Reported in the same news cycle as the first reports, so it counts in full."
      : a.novelty === "new"
        ? ""
        : `${knownDays >= 365 ? "A long-familiar idea" : knownDays >= 60 ? `Known for about ${Math.round(knownDays / 30)} months` : `Known for ${Math.round(knownDays)} days`} before this was published${a.novelty === "development" ? "; the new information still counts" : ""}.`;

  return (
    <section className={`attention level-${score.attention >= 70 ? "high" : score.attention >= 40 ? "mid" : score.attention >= 15 ? "some" : "low"}`} aria-label="Story importance">
      <button className="attention-head" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        <span className="attention-score" aria-label={`Attention ${score.attention} out of 100`}>{score.attention}</span>
        <span className="attention-line">
          <strong>{verdictOf(score.attention)}</strong>
          <span className="attention-chips">
            <span className={`attention-chip novelty-${label === "Fresh" ? "new" : a.novelty}`}>{label}</span>
            <span className="attention-chip">World {score.world.toFixed(1)}</span>
            <span className="attention-chip">{a.field} {score.field}/10</span>
            {v && <span className={`attention-chip check-${v.verdict}`}>{VERDICT_NAME[v.verdict]}</span>}
          </span>
        </span>
        <span className="attention-toggle" aria-hidden="true">{open ? "▴" : "▾"}</span>
      </button>

      {open && (
        <div className="attention-body">
          {a.whatsNew && (
            <p className="attention-new">
              <b>{a.novelty === "rehash" && label !== "Fresh" ? "Nothing new: " : "What's new: "}</b>
              {a.whatsNew}
              {a.fundamental && <em className="attention-fundamental"> Claims to change established understanding.</em>}
            </p>
          )}
          {staleNote && <p className="attention-dim">{staleNote}</p>}
          {known.length > 0 && (
            <div className="attention-known">
              <span>Reported earlier, in your stories:</span>
              <ul>
                {known.map((e) => (
                  <li key={e.id}>
                    {setup.onOpenStory ? (
                      <button className="link-btn" onClick={() => setup.onOpenStory!(e.link, e.title)}>{e.title}</button>
                    ) : (
                      <a href={e.link} target="_blank" rel="noreferrer noopener">{e.title}</a>
                    )}
                    {(e.outlet || before(e.publishedAt)) && (
                      <span className="attention-dim"> · {[e.outlet, before(e.publishedAt)].filter(Boolean).join(", ")}</span>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div className="attention-scale">
            <div className="attention-scale-head">
              <span>World stakes</span>
              <span className="attention-dim">{score.world.toFixed(1)} / 10</span>
            </div>
            <div className="attention-bar" aria-hidden="true"><span style={{ width: `${score.world * 10}%` }} /></div>
            <p>
              {stakesLabel(a)}. {a.stakesWhy}
            </p>
          </div>

          <div className="attention-scale">
            <div className="attention-scale-head">
              <span>Within {a.field}</span>
              <span className="attention-dim">{score.field} / 10</span>
            </div>
            <div className="attention-bar field" aria-hidden="true"><span style={{ width: `${score.field * 10}%` }} /></div>
            <p>
              {a.fieldWhy}{" "}
              <span className="attention-dim">
                Counts at {Math.round(FIELD_WEIGHT[a.fieldClass] * 100)}% against world stakes
                {a.fieldClass === "entertainment" ? ", as entertainment" : a.fieldClass === "culture" ? ", as culture" : ""}.
              </span>
            </p>
          </div>

          {v && (
            <div className="attention-check">
              <p>
                <b>Checked against recent reporting: {VERDICT_NAME[v.verdict].toLowerCase()}.</b>{" "}
                {v.firstReported && <>First reported {dayOf(v.firstReported)}. </>}
                {v.note}
              </p>
              {v.sources.length > 0 && (
                <ul>
                  {v.sources.map((s) => (
                    <li key={s.url}>
                      <a href={s.url} target="_blank" rel="noreferrer noopener">{s.title || s.url}</a>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}

          <p className="attention-foot attention-dim">
            {score.led === "field" ? "Scored on its weight in its field" : "Scored on the lives at stake"}, × {score.noveltyFactor} for novelty
            · {modelName(held.model)}
            {cost > 0 && ` · about $${cost < 0.01 ? cost.toFixed(4) : cost.toFixed(2)}`}
            {" · "}
            <button className="link-btn" disabled={busy} onClick={() => void run(true)}>{busy ? "Scoring…" : "Score again"}</button>
          </p>
          {error && <p className="attention-dim">{error.text}</p>}
        </div>
      )}
    </section>
  );
}

/** A run's cost as Spending would count it. */
function recordCostOf(u: { provider: "anthropic" | "openai"; model: string; input: number; output: number; searches?: number }) {
  const price = [...MODEL_CHOICES.anthropic, ...MODEL_CHOICES.openai].find((m) => u.model === m.id || u.model.startsWith(`${m.id}-`));
  if (!price) return null;
  return (u.input * price.input + u.output * price.output) / 1_000_000 + (u.provider === "anthropic" ? (u.searches ?? 0) * 0.01 : 0);
}
