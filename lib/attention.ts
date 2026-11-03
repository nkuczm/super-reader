/**
 * How much attention a story deserves: what is new in it, and how much rides
 * on it. Not how widely it is covered — that is lib/importance.ts, and the
 * two answer different questions. A story written a thousand times is big
 * and not worth reading again; a unique piece about a new film is new and
 * matters to almost no one.
 *
 * Two scales, and the higher one counts (the reader chose this shape on
 * 2 Nov 2026, "option B"):
 *
 *  world stakes  — how many lives the event puts at stake, lost or saved, on
 *                  a scale where each step is ten times the last. What has
 *                  happened counts in full; what might happen counts by its
 *                  probability and then three steps lower, so a shooting that
 *                  happened outranks a war that might, which outranks a
 *                  shooting that might.
 *  field         — how much it matters within its own discipline, so a
 *                  landmark paper in philosophy is not scored as nothing for
 *                  killing no one. Counted at half weight for a field of
 *                  knowledge, less for culture, little for entertainment.
 *
 * Then novelty, judged as the world's news rather than as a count of who
 * else ran it. Every outlet that reports a story in the same news cycle —
 * within about a day and a half of the first report — counts in full: a
 * blitz of coverage on one day does not make any one report worth less.
 * What loses value is staleness: a story whose main point was already known
 * days or weeks before it was published, or a long-familiar idea restated
 * (the reader's correction, 3 Nov 2026). How long it was known comes from
 * the reader's own earlier stories, the outlet panel, a web check, and the
 * model's knowledge for ideas that have been around for years.
 *
 * The model gives the estimates — lives, probability, field significance,
 * novelty — and the arithmetic is done here, the same way every time, so a
 * score can be explained and two stories compared.
 */

import { idfOver, similarity, tokensOf } from "./cluster";

export type StoryKind = "news" | "research" | "analysis" | "opinion" | "other";
export type FieldClass = "knowledge" | "culture" | "entertainment";
export type Novelty = "new" | "development" | "minor" | "rehash";
/** How long a story's main point had been known when it was published. */
export type KnownFor = "fresh" | "days" | "weeks" | "months" | "years";

/** What the model judges of a story: its estimates, not the score. */
export type Assessment = {
  /** One sentence: what happened, was found or is argued. */
  summary: string;
  kind: StoryKind;
  /** Lives already lost or saved, or that the event makes all but certain. */
  realizedLives: number;
  /** Further lives plausibly at stake if it goes the way it could. */
  potentialLives: number;
  /** The chance, 0–1, that the potential comes about within about five years. */
  probability: number;
  /** How lives come into it, in a sentence. */
  stakesWhy: string;
  /** The discipline, as a reader of it would name it. */
  field: string;
  fieldClass: FieldClass;
  /** 0–10 within the field: 10 changes it, 7 is what specialists will discuss this year, 4 a solid contribution, 1 routine. */
  fieldSignificance: number;
  fieldWhy: string;
  novelty: Novelty;
  /** What this adds to what was known, in a sentence. */
  whatsNew: string;
  /** Ids of the reader's earlier stories that already carried it. */
  knownFrom: string[];
  /** The model's sense of how long its main point had been known: "years" for a saturated idea. */
  knownFor: KnownFor;
  /** It challenges or changes established understanding, not only the news. */
  fundamental: boolean;
  /**
   * How many days its main point had been known when it was published, from
   * everything there is to go on (`knownForDays`). Worked out on the server
   * after the model answers; absent from a score kept by an older build.
   */
  knownDays?: number;
};

/** One model call's cost, as the provider reported it. */
export type AttentionUsage = { provider: "anthropic" | "openai"; model: string; input: number; output: number; searches?: number };

/** What the story page sends: the article, what the reader already holds, and the coverage it has had. */
export type AttentionRequest = {
  provider: "anthropic" | "openai";
  model?: string;
  article: { url: string; title: string; siteName?: string; byline?: string; publishedAt?: string; text: string };
  source?: { title?: string; folders?: string[] };
  earlier: Earlier[];
  /** The outlet panel's view of the story: how long before this article it first saw it, and some of its headlines. */
  coverage?: { firstSeenHoursBefore?: number; newsrooms?: number; titles?: string[] };
  /** false skips the recent-reporting check. */
  check?: boolean;
};

export type AttentionResult = { assessment: Assessment; verification?: Verification; usages: AttentionUsage[] };

/** A recent search's check of a story that looked very important. */
export type Verification = {
  verdict: "confirmed" | "disputed" | "overstated" | "understated" | "unverified";
  /** When it was first reported, if the search found earlier coverage. */
  firstReported?: string;
  note: string;
  sources: { title: string; url: string }[];
};

/** What possible harm loses against the same harm done: three steps, a thousandth. */
export const SPECULATIVE_PENALTY = 3;
/** How much field significance counts against world stakes. */
export const FIELD_WEIGHT: Record<FieldClass, number> = { knowledge: 0.5, culture: 0.3, entertainment: 0.1 };
export const NOVELTY_NAME: Record<Novelty, string> = { new: "New", development: "Development", minor: "Minor update", rehash: "Already known" };
/** One news cycle: reports this close to the first are all equally new. */
export const NEWS_CYCLE_DAYS = 1.5;
/** What the model's sense of "known for" means in days, when nothing dated says more. */
export const KNOWN_FOR_DAYS: Record<KnownFor, number> = { fresh: 0, days: 3, weeks: 14, months: 90, years: 730 };

/** What a repeat is worth, by how long what it repeats had been known: in full within the news cycle, a tenth for a settled idea. */
export function staleness(days: number): number {
  if (!(days > NEWS_CYCLE_DAYS)) return 1;
  if (days <= 3) return 0.7;
  if (days <= 7) return 0.5;
  if (days <= 30) return 0.3;
  if (days <= 365) return 0.15;
  return 0.1;
}

/**
 * The novelty multiplier. Something new to the world counts in full, and so
 * does anything in the same news cycle as the first report, however many
 * others carried it. Past the cycle: new information on an older story
 * keeps most of its weight; a small new detail on it a little more than a
 * plain repeat; a repeat as much as `staleness` leaves it.
 */
export function noveltyFactor(a: Pick<Assessment, "novelty" | "knownFor" | "knownDays">): number {
  const days = Number.isFinite(a.knownDays) ? a.knownDays! : KNOWN_FOR_DAYS[a.knownFor] ?? 0;
  if (a.novelty === "new" || days <= NEWS_CYCLE_DAYS) return 1;
  if (a.novelty === "development") return 0.85;
  const stale = staleness(days);
  return a.novelty === "minor" ? Math.round((stale + (1 - stale) * 0.3) * 100) / 100 : stale;
}

/** The novelty as the panel names it: within the news cycle, a repeat is simply fresh. */
export function noveltyLabel(a: Pick<Assessment, "novelty" | "knownFor" | "knownDays">): string {
  const days = Number.isFinite(a.knownDays) ? a.knownDays! : KNOWN_FOR_DAYS[a.knownFor] ?? 0;
  if (a.novelty !== "new" && days <= NEWS_CYCLE_DAYS) return "Fresh";
  return NOVELTY_NAME[a.novelty];
}

/**
 * How many days a story's main point had been known when the article was
 * published: the longest of what the evidence says — the reader's own
 * earlier stories that carried it, when the outlet panel first saw it, the
 * date a web check found it first reported, and the model's own sense of it
 * (which is what catches an idea that has been around for years). An
 * article's own outlet running its own story again does not age it.
 */
export function knownForDays(
  a: Pick<Assessment, "knownFrom" | "knownFor" | "novelty">,
  context: {
    publishedAt?: string;
    earlier: Pick<Earlier, "id" | "publishedAt">[];
    coverage?: { firstSeenHoursBefore?: number };
    firstReported?: string;
    now?: number;
  },
): number {
  const at = Date.parse(context.publishedAt ?? "");
  const when = Number.isFinite(at) ? at : context.now ?? Date.now();
  const ages = [KNOWN_FOR_DAYS[a.knownFor] ?? 0];
  for (const e of context.earlier) {
    if (!a.knownFrom.includes(e.id)) continue;
    const t = Date.parse(e.publishedAt ?? "");
    if (Number.isFinite(t)) ages.push((when - t) / 86_400_000);
  }
  // The panel's cluster can hold an earlier stage of a running story, so it
  // only dates a report that the model says repeats what was known.
  if ((a.novelty === "minor" || a.novelty === "rehash") && Number(context.coverage?.firstSeenHoursBefore) > 0) {
    ages.push(Number(context.coverage!.firstSeenHoursBefore) / 24);
  }
  const first = Date.parse(`${context.firstReported ?? ""}T12:00:00Z`);
  // Dated to the day, so a day's slack either side.
  if (Number.isFinite(first)) ages.push((when - first) / 86_400_000 - 1);
  return Math.max(0, Math.round(Math.max(...ages) * 10) / 10);
}
/** A news story whose world stakes reach this is checked against recent reporting. */
export const VERIFY_AT = 3.5;

/** Lives on the 0–10 scale: one life is 2, ten is 3, a hundred 4 … a billion or more is 10. */
export function livesScale(lives: number): number {
  if (!(lives > 0)) return 0;
  if (lives < 1) return 2 * lives;
  return Math.min(10, 2 + Math.log10(lives));
}

const clamp = (n: unknown, lo: number, hi: number, fallback = lo) => {
  const v = Number(n);
  return Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : fallback;
};

/** World stakes, 0–10: the larger of what has happened and what might, the latter at its discount. */
export function worldStakes(a: Pick<Assessment, "realizedLives" | "potentialLives" | "probability">): number {
  const realized = livesScale(clamp(a.realizedLives, 0, 1e10));
  const expected = clamp(a.potentialLives, 0, 1e10) * clamp(a.probability, 0, 1);
  const potential = Math.max(0, livesScale(expected) - SPECULATIVE_PENALTY);
  return Math.round(Math.max(realized, potential) * 10) / 10;
}

export type Score = {
  /** 0–100: how much attention the story deserves. */
  attention: number;
  /** 0–10 */
  world: number;
  /** 0–10 within the field, and what it counts for against world stakes. */
  field: number;
  fieldCounts: number;
  noveltyFactor: number;
  /** Which scale set the score. */
  led: "world" | "field";
};

export function scoreOf(a: Assessment): Score {
  const world = worldStakes(a);
  const field = Math.round(clamp(a.fieldSignificance, 0, 10, 0));
  const weight = FIELD_WEIGHT[a.fieldClass] ?? FIELD_WEIGHT.knowledge;
  const fieldCounts = Math.round(field * weight * 10) / 10;
  const novelty = noveltyFactor(a);
  const led = fieldCounts > world ? "field" : "world";
  return { attention: Math.round(10 * Math.max(world, fieldCounts) * novelty), world, field, fieldCounts, noveltyFactor: novelty, led };
}

/** Whether to check the story against recent reporting: a news event that looks very important. */
export function needsCheck(a: Assessment): boolean {
  return a.kind === "news" && worldStakes(a) >= VERIFY_AT;
}

const round = (n: number) => {
  if (n >= 1e9) return `${Math.round(n / 1e9)} billion`;
  if (n >= 1e6) return `${Math.round(n / 1e6)} million`;
  if (n >= 1e4) return `${Math.round(n / 1e3).toLocaleString("en-US")},000`;
  return Math.round(n).toLocaleString("en-US");
};

/** "About 12 lives lost or saved" / "Up to 100,000 at stake, 10% likely" — what the world score rests on. */
export function stakesLabel(a: Pick<Assessment, "realizedLives" | "potentialLives" | "probability">): string {
  const realized = clamp(a.realizedLives, 0, 1e10);
  const potential = clamp(a.potentialLives, 0, 1e10);
  const p = clamp(a.probability, 0, 1);
  const parts: string[] = [];
  if (realized >= 1) parts.push(`about ${round(realized)} ${realized < 1.5 ? "life" : "lives"} affected`);
  if (potential >= 1 && p > 0) parts.push(`up to ${round(potential)} at stake, ${p < 0.01 ? "under 1" : Math.round(p * 100)}% likely`);
  if (!parts.length) return "No lives plausibly at stake";
  const text = parts.join("; ");
  return text[0].toUpperCase() + text.slice(1);
}

/** The verifier's revisions folded in: what it found replaces what the first reading assumed. */
export function revise(a: Assessment, found: Partial<Pick<Assessment, "realizedLives" | "potentialLives" | "probability" | "novelty">>): Assessment {
  const next = { ...a };
  if (Number.isFinite(Number(found.realizedLives))) next.realizedLives = clamp(found.realizedLives, 0, 1e10);
  if (Number.isFinite(Number(found.potentialLives))) next.potentialLives = clamp(found.potentialLives, 0, 1e10);
  if (Number.isFinite(Number(found.probability))) next.probability = clamp(found.probability, 0, 1);
  if (found.novelty && found.novelty in NOVELTY_NAME) next.novelty = found.novelty;
  return next;
}

/** A story the reader already holds, offered as what was known before this one. */
export type Earlier = { id: string; title: string; link: string; outlet?: string; publishedAt?: string; summary?: string };
type Candidate = { title: string; link: string; summary?: string; publishedAt?: string; outlet?: string };

/**
 * The reader's earlier stories most like this one — what they could already
 * know — for the model to say what this one adds. Only stories from before
 * it (an hour's grace for clocks), never the story itself, and only ones
 * that share at least two telling words with it.
 */
export function earlierStories(
  story: { title: string; link: string; publishedAt?: string; summary?: string },
  pool: Candidate[],
  { limit = 12, canonical = (url: string) => url }: { limit?: number; canonical?: (url: string) => string } = {},
): Earlier[] {
  const self = canonical(story.link);
  const at = Date.parse(story.publishedAt ?? "");
  const before = (c: Candidate) => {
    const t = Date.parse(c.publishedAt ?? "");
    return !Number.isFinite(at) || !Number.isFinite(t) || t <= at + 3_600_000;
  };
  const seen = new Set<string>([self]);
  const candidates = pool.filter((c) => {
    if (!c?.title || !c.link) return false;
    const key = canonical(c.link);
    if (seen.has(key) || !before(c)) return false;
    seen.add(key);
    return true;
  });
  const words = (c: { title: string; summary?: string }) => tokensOf(`${c.title} ${(c.summary ?? "").slice(0, 300)}`);
  const target = words(story);
  if (target.length < 2 || candidates.length === 0) return [];
  const docs = candidates.map(words);
  const idf = idfOver([target, ...docs]);
  return candidates
    .map((c, i) => ({ c, score: similarity(target, docs[i], idf) }))
    .filter((x) => x.score >= 0.12)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map(({ c }, i) => ({
      id: `E${i + 1}`,
      title: c.title.slice(0, 300),
      link: c.link,
      ...(c.outlet ? { outlet: c.outlet } : {}),
      ...(c.publishedAt ? { publishedAt: c.publishedAt } : {}),
      ...(c.summary ? { summary: c.summary.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().slice(0, 300) } : {}),
    }));
}

/** An assessment as the model returned it, checked: anything missing or out of range is made safe. */
export function cleanAssessment(raw: unknown, earlierIds: Set<string>): Assessment | null {
  const r = raw as Partial<Assessment> | null;
  if (!r || typeof r !== "object") return null;
  const text = (v: unknown, max = 400) => (typeof v === "string" ? v.trim().slice(0, max) : "");
  const kinds: StoryKind[] = ["news", "research", "analysis", "opinion", "other"];
  const classes: FieldClass[] = ["knowledge", "culture", "entertainment"];
  const novelties: Novelty[] = ["new", "development", "minor", "rehash"];
  return {
    summary: text(r.summary),
    kind: kinds.includes(r.kind as StoryKind) ? (r.kind as StoryKind) : "other",
    realizedLives: clamp(r.realizedLives, 0, 1e10, 0),
    potentialLives: clamp(r.potentialLives, 0, 1e10, 0),
    probability: clamp(r.probability, 0, 1, 0),
    stakesWhy: text(r.stakesWhy),
    field: text(r.field, 80) || "General",
    fieldClass: classes.includes(r.fieldClass as FieldClass) ? (r.fieldClass as FieldClass) : "knowledge",
    fieldSignificance: Math.round(clamp(r.fieldSignificance, 0, 10, 0)),
    fieldWhy: text(r.fieldWhy),
    novelty: novelties.includes(r.novelty as Novelty) ? (r.novelty as Novelty) : "minor",
    whatsNew: text(r.whatsNew),
    knownFrom: (Array.isArray(r.knownFrom) ? r.knownFrom : []).filter((id): id is string => typeof id === "string" && earlierIds.has(id)).slice(0, 6),
    knownFor: (["fresh", "days", "weeks", "months", "years"] as KnownFor[]).includes(r.knownFor as KnownFor) ? (r.knownFor as KnownFor) : "fresh",
    fundamental: r.fundamental === true,
  };
}
