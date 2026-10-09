/**
 * How well each source is delivering, remembered over time.
 *
 * Collection fails silently (docs/COLLECTION.md §6): a dead source reads as a
 * quiet one, because the held window keeps showing what it collected before.
 * So every refresh records, per source, what came back — and this module turns
 * that history into a verdict a person can act on.
 *
 * Kept on the device, like the feeds themselves: the server never learns what
 * a reader follows. Bounded — the last few dozen refreshes in detail, and a
 * daily roll-up for a month — so it costs a few kilobytes per source.
 */

export type Run = {
  at: number;
  ok: boolean;
  /** Stories the feed returned this time. */
  fetched: number;
  /** Stories this device held for the source after the merge. */
  held: number;
  /** The newest publication date among what came back. */
  newest?: number;
  error?: string;
  /** An HTTP status, where the error carried one. */
  status?: number;
};

export type Day = {
  /** yyyy-mm-dd, local. */
  day: string;
  runs: number;
  failures: number;
  /** The most any one refresh returned that day. */
  fetched: number;
  held: number;
  newest?: number;
};

export type SourceHealth = { runs: Run[]; days: Day[] };
export type HealthLog = Record<string, SourceHealth>;

const KEY = "super-reader:health:v1";
export const MAX_RUNS = 40;
export const MAX_DAYS = 30;
const DAY_MS = 24 * 60 * 60 * 1000;

export function loadHealth(): HealthLog {
  if (typeof window === "undefined") return {};
  try {
    const parsed = JSON.parse(window.localStorage.getItem(KEY) ?? "{}");
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

export function saveHealth(log: HealthLog) {
  try {
    window.localStorage.setItem(KEY, JSON.stringify(log));
  } catch {
    /* storage full; the page shows what it has */
  }
}

function dayOf(at: number) {
  const date = new Date(at);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** The HTTP status buried in an error message, where there is one. */
export function statusIn(error: string | undefined): number | undefined {
  const match = error?.match(/\b([45]\d\d)\b/);
  return match ? Number(match[1]) : undefined;
}

/** Add one refresh's results, and forget sources no longer followed. */
export function recordRuns(
  log: HealthLog,
  runs: Record<string, Omit<Run, "status">>,
  following: ReadonlySet<string>,
): HealthLog {
  const next: HealthLog = {};
  for (const [id, health] of Object.entries(log)) if (following.has(id)) next[id] = health;
  for (const [id, raw] of Object.entries(runs)) {
    if (!following.has(id)) continue;
    const run: Run = { ...raw, status: statusIn(raw.error) };
    const current = next[id] ?? { runs: [], days: [] };
    const day = dayOf(run.at);
    const days = current.days.filter((entry) => entry.day !== day);
    const today = current.days.find((entry) => entry.day === day);
    days.push({
      day,
      runs: (today?.runs ?? 0) + 1,
      failures: (today?.failures ?? 0) + (run.ok ? 0 : 1),
      fetched: Math.max(today?.fetched ?? 0, run.fetched),
      held: run.held,
      newest: Math.max(today?.newest ?? 0, run.newest ?? 0) || undefined,
    });
    next[id] = {
      runs: [...current.runs, run].slice(-MAX_RUNS),
      days: days.sort((a, b) => a.day.localeCompare(b.day)).slice(-MAX_DAYS),
    };
  }
  return next;
}

export type Verdict = "healthy" | "quiet" | "degraded" | "declining" | "losing-access" | "broken" | "unknown";

export type Assessment = {
  verdict: Verdict;
  /** One line a person can read, saying why. */
  reason: string;
  /** Stories held now. */
  held: number;
  /** What the last refresh returned. */
  fetched: number;
  /** The typical refresh, over the week before the last day. */
  baseline: number | null;
  newest?: number;
  lastRun?: number;
};

/** Refusals that do not get better on their own. */
const ACCESS_STATUSES = new Set([401, 402, 403, 404, 410, 451]);

function median(values: number[]) {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/**
 * The verdict, from the most serious down:
 *
 * - broken: nothing is arriving and nothing is cached — the reader sees an
 *   empty source. Also when the feed delivers but nothing it delivered is
 *   held: an empty source all the same.
 * - losing-access: the publisher is refusing or has removed the feed (401,
 *   403, 404, 410…) on the recent refreshes — the "source that died after it
 *   was added" of COLLECTION.md §6. Still showing cached stories, which is
 *   exactly why it needs saying.
 * - degraded: the last refreshes failed some other way, and the cache is
 *   covering for it.
 * - declining: it answers, but with well under half of what it used to, or
 *   its newest story is getting older while the count stays the same — the
 *   shape of a feed that is being wound down.
 * - quiet: answering fine, nothing new for a while. Often just a slow
 *   publication, so it is not called broken.
 */
export function assess(health: SourceHealth | undefined, now = Date.now()): Assessment {
  const runs = health?.runs ?? [];
  const last = runs[runs.length - 1];
  if (!last) {
    return { verdict: "unknown", reason: "Not refreshed since status tracking began.", held: 0, fetched: 0, baseline: null };
  }

  const recent = runs.slice(-3);
  const failing = recent.filter((run) => !run.ok || run.fetched === 0);
  const refusals = recent.filter((run) => run.status && ACCESS_STATUSES.has(run.status));
  const newest = runs.reduce<number | undefined>((best, run) => Math.max(best ?? 0, run.newest ?? 0) || best, undefined);

  // The baseline is the week before today, so a bad day does not lower the bar it is judged against.
  const today = dayOf(now);
  const earlier = (health?.days ?? []).filter((day) => day.day !== today).slice(-7);
  const baseline = median(earlier.map((day) => day.fetched).filter((n) => n > 0));
  const base = { held: last.held, fetched: last.fetched, baseline, newest, lastRun: last.at };

  if (last.held === 0 && (!last.ok || last.fetched === 0)) {
    return {
      ...base,
      verdict: "broken",
      reason: last.error ? `No stories, none cached. Last error: ${last.error}` : "The feed returned nothing and nothing is cached.",
    };
  }
  // The feed answers with stories and none of them reach the list: an empty
  // source to the reader, whatever the fetch says. It used to read as
  // healthy, because a good fetch was all this looked at.
  if (last.ok && last.fetched > 0 && last.held === 0) {
    return {
      ...base,
      verdict: "broken",
      reason: `The feed returned ${last.fetched} ${last.fetched === 1 ? "story" : "stories"}, but none reached your list.`,
    };
  }
  if (refusals.length >= Math.min(2, recent.length) && refusals.length > 0) {
    return {
      ...base,
      verdict: "losing-access",
      reason: `The publisher answered ${refusals[refusals.length - 1].status} on ${refusals.length} of the last ${recent.length} refreshes; you are seeing cached stories.`,
    };
  }
  if (failing.length >= Math.min(2, recent.length) && !last.ok) {
    return {
      ...base,
      verdict: "degraded",
      reason: `${failing.length} of the last ${recent.length} refreshes failed${last.error ? ` (${last.error})` : ""}; cached stories are covering.`,
    };
  }
  if (baseline && baseline >= 4 && last.fetched < baseline * 0.5) {
    return {
      ...base,
      verdict: "declining",
      reason: `Returning ${last.fetched} stories against a usual ${Math.round(baseline)}.`,
    };
  }
  const stalled = staleWhileSteady(health?.days ?? []);
  if (stalled) {
    return { ...base, verdict: "declining", reason: stalled };
  }
  if (newest && now - newest > 14 * DAY_MS) {
    return {
      ...base,
      verdict: "quiet",
      reason: `Answering, but the newest story is ${Math.round((now - newest) / DAY_MS)} days old.`,
    };
  }
  return { ...base, verdict: "healthy", reason: "Delivering normally." };
}

/**
 * A feed still returning its usual count, but whose newest story has not
 * moved for a week of daily readings — a frozen or abandoned feed that still
 * answers 200, the "fresh-looking stale feed" of COLLECTION.md §6.
 */
function staleWhileSteady(days: Day[]): string | null {
  const week = days.slice(-7);
  if (week.length < 5) return null;
  const newest = week.map((day) => day.newest ?? 0);
  if (newest.some((value) => value === 0)) return null;
  const frozen = newest.every((value) => value === newest[0]);
  const steady = week.every((day) => day.fetched > 0);
  if (!frozen || !steady) return null;
  const firstDay = new Date(`${week[0].day}T00:00:00`).getTime();
  if (firstDay - newest[0] < 7 * DAY_MS) return null;
  return `The feed still answers, but its newest story has not changed across ${week.length} days of refreshes.`;
}

export const VERDICT_ORDER: Verdict[] = ["broken", "losing-access", "degraded", "declining", "quiet", "unknown", "healthy"];
