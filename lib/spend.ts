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
  "claude-sonnet-5-5": { input: 2, output: 10 },
  "claude-haiku-4-5": { input: 1, output: 5 },
  "claude-fable-5-1": { input: 10, output: 50 },
  "gpt-6-astra": { input: 10, output: 50 },
  "gpt-6-sol": { input: 2, output: 10 },
  "gpt-6-luna": { input: 0.1, output: 0.5 },
  "gpt-5": { input: 1.25, output: 10 },
  "gpt-5-mini": { input: 0.25, output: 2 },
  "gpt-5-nano": { input: 0.05, output: 0.4 },
  "gpt-4.1": { input: 2, output: 8 },
  "gpt-4.1-mini": { input: 0.4, output: 1.6 },
  "gpt-4o": { input: 2.5, output: 10 },
  "gpt-4o-mini": { input: 0.15, output: 0.6 },
};

export type SpendRecord = {
  /** One id per run, so the same run counted from two devices counts once. */
  id?: string;
  /** Which kind of device ran it — "Mac", "iPhone" — for the breakdown. */
  device?: string;
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
    id: `${now.toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
    device: deviceName(),
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

/** A plain name for this kind of device, from the browser's own description. */
export function deviceName(): string {
  if (typeof navigator === "undefined") return "This device";
  const ua = navigator.userAgent;
  if (/iPhone/.test(ua)) return "iPhone";
  if (/iPad/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1)) return "iPad";
  if (/Android/.test(ua)) return /Mobile/.test(ua) ? "Android phone" : "Android tablet";
  if (/Macintosh|Mac OS X/.test(ua)) return "Mac";
  if (/Windows/.test(ua)) return "Windows PC";
  if (/CrOS/.test(ua)) return "Chromebook";
  if (/Linux/.test(ua)) return "Linux";
  return "Other device";
}

/** An id for a record from before ids existed: the same run gives the same id on every look. */
export function idOf(record: SpendRecord): string {
  return record.id ?? `old-${record.at}-${record.model}-${record.input}-${record.output}`;
}

/**
 * Every device's runs, through the server under the sync code — so the page
 * shows what the account spent, not what one device did. Local runs not yet
 * there are sent first (the first visit after this existed sends a device's
 * whole history). Falls back to this device's own records when offline or
 * not syncing.
 */
export async function loadSharedSpend(code: string | null): Promise<{ records: SpendRecord[]; shared: boolean }> {
  const local = loadSpend();
  if (!code) return { records: local, shared: false };
  try {
    const records = local.map((r) => ({ ...r, id: idOf(r), device: r.device ?? deviceName() }));
    if (records.length) {
      await fetch("/api/spend", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ code, records: records.slice(-MAX_RECORDS) }),
      });
    }
    const res = await fetch(`/api/spend?code=${encodeURIComponent(code)}`, { cache: "no-store" });
    if (!res.ok) throw new Error();
    const data = (await res.json()) as { records?: SpendRecord[] };
    return { records: data.records ?? local, shared: true };
  } catch {
    return { records: local, shared: false };
  }
}

/** Send one run to the shared ledger as it happens; the page sends any it missed. */
export function shareSpend(code: string | null, record: SpendRecord) {
  if (!code) return;
  void fetch("/api/spend", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ code, records: [record] }),
    keepalive: true,
  }).catch(() => {});
}
