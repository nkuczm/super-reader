/**
 * The AI models a reader can choose between, described in plain words, and
 * what each would cost them — estimated from what their own use has been.
 *
 * Prices are the providers' list prices per million tokens (Anthropic's as
 * of 25 Sep 2026). A token is roughly three quarters of a word.
 */

import type { AiProvider, SpendRecord } from "./spend";

export type ModelChoice = {
  id: string;
  name: string;
  /** One line on what it is good for, for someone who does not follow AI models. */
  blurb: string;
  /**
   * Offered only once the provider confirms the reader's key can run it —
   * for models whose name and price come from coverage rather than the
   * provider's own documentation.
   */
  unconfirmed?: boolean;
  /** US dollars per million tokens. */
  input: number;
  output: number;
  /** The model used until the reader chooses — a starting point, not the result of any comparison. */
  recommended?: boolean;
};

export const DEFAULT_ANTHROPIC_MODEL = "claude-opus-5-5";

export const MODEL_CHOICES: Record<AiProvider, ModelChoice[]> = {
  anthropic: [
    { id: "claude-opus-5-5", name: "Claude Opus 5.5", blurb: "Careful, thorough reading. The best balance for insights and fact-checks.", input: 4, output: 20, recommended: true },
    { id: "claude-sonnet-5-5", name: "Claude Sonnet 5.5", blurb: "Nearly as good for most subjects, at half the price.", input: 2, output: 10 },
    { id: "claude-haiku-4-5", name: "Claude Haiku 4.5", blurb: "Fastest and cheapest. Fine for quick insights; misses more in a fact-check.", input: 1, output: 5 },
    { id: "claude-fable-5-1", name: "Claude Fable 5.1", blurb: "The most capable. Slower and much more expensive — for work where every detail matters.", input: 10, output: 50 },
  ],
  openai: [
    // The GPT-6 family (Sep 2026): names and prices as reported, not yet read
    // from OpenAI's own pages, so each is shown only when the key lists it.
    { id: "gpt-6-sol", name: "GPT-6 Sol", blurb: "OpenAI's current mid-range model: strong reading at a moderate price.", input: 2, output: 10, unconfirmed: true },
    { id: "gpt-6-luna", name: "GPT-6 Luna", blurb: "OpenAI's current low-cost model: newer than GPT-5 mini and cheaper.", input: 0.1, output: 0.5, unconfirmed: true },
    { id: "gpt-6-astra", name: "GPT-6 Astra", blurb: "OpenAI's flagship. The most capable and by far the priciest.", input: 10, output: 50, unconfirmed: true },
    { id: "gpt-5", name: "GPT-5", blurb: "The previous generation's most capable model.", input: 1.25, output: 10 },
    { id: "gpt-5-mini", name: "GPT-5 mini", blurb: "Low price, and works with any OpenAI key.", input: 0.25, output: 2, recommended: true },
    { id: "gpt-5-nano", name: "GPT-5 nano", blurb: "Cheapest and fastest; noticeably shallower.", input: 0.05, output: 0.4 },
    { id: "gpt-4.1", name: "GPT-4.1", blurb: "The previous generation; solid, with a large memory for long subjects.", input: 2, output: 8 },
  ],
};

/** The chosen model, or the provider's default when the choice is not one offered. */
export function modelFor(provider: AiProvider, chosen: string | undefined): string {
  const list = MODEL_CHOICES[provider];
  if (provider === "openai") return chosen?.trim() || "gpt-5-mini";
  return list.some((m) => m.id === chosen) ? chosen! : DEFAULT_ANTHROPIC_MODEL;
}

/** Roughly what one insights run reads and writes, for a reader with no history yet. */
export const TYPICAL_RUN = { input: 12_000, output: 2_500 };

export type UsageBasis = {
  /** Tokens a month at the reader's pace, read and written. */
  input: number;
  output: number;
  runs: number;
  /** How many days of history the pace is taken from; 0 when there is none. */
  days: number;
};

/**
 * The reader's monthly pace, from the last 30 days of runs. A newer reader's
 * few days are scaled up to a month, but never from less than a week, so a
 * busy first afternoon does not read as a busy month.
 */
export function monthlyUsage(records: SpendRecord[], now = Date.now()): UsageBasis {
  const since = now - 30 * 86_400_000;
  const recent = records.filter((r) => r.at >= since && r.at <= now);
  if (!recent.length) return { input: 0, output: 0, runs: 0, days: 0 };
  const first = Math.min(...records.map((r) => r.at));
  const days = Math.min(30, Math.max(7, (now - first) / 86_400_000));
  const scale = 30 / days;
  return {
    input: Math.round(recent.reduce((n, r) => n + r.input, 0) * scale),
    output: Math.round(recent.reduce((n, r) => n + r.output, 0) * scale),
    runs: Math.round(recent.length * scale),
    days: Math.round(Math.min(30, (now - first) / 86_400_000)),
  };
}

/** What a model would cost for so many tokens. */
export function costAt(model: ModelChoice, usage: { input: number; output: number }): number {
  return (usage.input * model.input + usage.output * model.output) / 1_000_000;
}
