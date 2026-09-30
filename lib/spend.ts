/**
 * What the AI features have cost, as far as this device can tell.
 *
 * Every run reports the tokens the provider says it used, and that is
 * recorded here with an estimate of its price. An estimate, because the bill
 * is the provider's to write: prices change, and a model this table does not
 * know is counted in tokens and left unpriced rather than guessed at.
 *
 * Kept on the device and not synced — the numbers are for the person holding
 * it, and each device's runs are its own.
 */

export type AiProvider = "anthropic" | "openai";

export const PROVIDER_NAME: Record<AiProvider, string> = {
  anthropic: "Anthropic",
  openai: "OpenAI",
};

export const DEFAULT_OPENAI_MODEL = "gpt-5-mini";

/** US dollars per million tokens, input then output. */
export const PRICES: Record<string, { input: number; output: number }> = {
  "claude-opus-5-5": { input: 4, output: 20 },
  "gpt-5": { input: 1.25, output: 10 },
  "gpt-5-mini": { input: 0.25, output: 2 },
  "gpt-5-nano": { input: 0.05, output: 0.4 },
  "gpt-4.1": { input: 2, output: 8 },
  "gpt-4.1-mini": { input: 0.4, output: 1.6 },
  "gpt-4o": { input: 2.5, output: 10 },
  "gpt-4o-mini": { input: 0.15, output: 0.6 },
};

export type SpendRecord = {
  at: number;
  provider: AiProvider;
  model: string;
  input: number;
  output: number;
  /** Estimated dollars, or null when the model's price is not known here. */
  cost: number | null;
  /** Which subject the run was for, by name. */
  subject?: string;
};

const KEY = "super-reader:spend:v1";
const MAX_RECORDS = 2000;

/** The price for a model, allowing for dated snapshots ("gpt-4o-2024-08-06"). */
export function priceOf(model: string) {
  if (PRICES[model]) return PRICES[model];
  const match = Object.keys(PRICES)
    .sort((a, b) => b.length - a.length)
    .find((known) => model.startsWith(`${known}-`));
  return match ? PRICES[match] : null;
}

export function costOf(model: string, input: number, output: number): number | null {
  const price = priceOf(model);
  return price ? (input * price.input + output * price.output) / 1_000_000 : null;
}

export function loadSpend(): SpendRecord[] {
  if (typeof window === "undefined") return [];
  try {
    const parsed = JSON.parse(window.localStorage.getItem(KEY) ?? "[]");
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function recordSpend(
  usage: { provider: AiProvider; model: string; input: number; output: number },
  subject?: string,
  now = Date.now(),
) {
  const record: SpendRecord = {
    at: now,
    provider: usage.provider,
    model: usage.model,
    input: usage.input,
    output: usage.output,
    cost: costOf(usage.model, usage.input, usage.output),
    subject,
  };
  try {
    const next = [...loadSpend(), record].slice(-MAX_RECORDS);
    window.localStorage.setItem(KEY, JSON.stringify(next));
    window.dispatchEvent(new Event(SPEND_EVENT));
  } catch {
    /* storage full; the run still happened */
  }
  return record;
}

export const SPEND_EVENT = "super-reader:spend";

export type SpendSummary = {
  runs: number;
  input: number;
  output: number;
  cost: number;
  /** Runs whose price is not known, so the total is a floor. */
  unpriced: number;
};

export function summarise(records: SpendRecord[]): SpendSummary {
  return records.reduce<SpendSummary>(
    (sum, r) => ({
      runs: sum.runs + 1,
      input: sum.input + r.input,
      output: sum.output + r.output,
      cost: sum.cost + (r.cost ?? 0),
      unpriced: sum.unpriced + (r.cost === null ? 1 : 0),
    }),
    { runs: 0, input: 0, output: 0, cost: 0, unpriced: 0 },
  );
}

/** Per-day cost for the last `days` days, oldest first, zeros included. */
export function daily(records: SpendRecord[], days = 30, now = Date.now()) {
  const out: { day: string; cost: number; runs: number }[] = [];
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  for (let i = days - 1; i >= 0; i -= 1) {
    const from = start.getTime() - i * 86_400_000;
    const to = from + 86_400_000;
    const inDay = records.filter((r) => r.at >= from && r.at < to);
    out.push({
      day: new Date(from).toISOString().slice(0, 10),
      cost: inDay.reduce((sum, r) => sum + (r.cost ?? 0), 0),
      runs: inDay.length,
    });
  }
  return out;
}

export function formatDollars(value: number) {
  if (value === 0) return "$0.00";
  if (value < 0.01) return `$${value.toFixed(4)}`;
  return `$${value.toFixed(2)}`;
}
