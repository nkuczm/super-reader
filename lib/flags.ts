/**
 * AI results the reader has flagged, kept with what they were about, so the
 * prompts behind them can be tuned. Each flag holds the output as it was
 * shown and the context it was produced from — the script line a fact-check
 * judged, the stories a connection linked — plus an optional note.
 *
 * A tuning aid, meant to be removed once the prompts are settled. Kept on
 * the device; the Flagged page exports them.
 */

export type FlagKind = "fact-check" | "omissions" | "insight" | "reading" | "transcript-search";

export type Flag = {
  id: string;
  at: number;
  kind: FlagKind;
  subject?: string;
  /** The model that produced it, where known. */
  model?: string;
  /** What the AI said, as shown. */
  output: string;
  /** What it was said about: labelled pieces of text. */
  context: { label: string; text: string }[];
  /** Sources it cited or connected. */
  links?: { title: string; url?: string }[];
  /** The reader's own words on what is wrong (or right) with it. */
  note?: string;
};

export type FlagInput = Omit<Flag, "id" | "at">;

const KEY = "super-reader:ai-flags:v1";
export const FLAGS_EVENT = "super-reader:flags";

export function loadFlags(): Flag[] {
  if (typeof window === "undefined") return [];
  try {
    const parsed = JSON.parse(window.localStorage.getItem(KEY) ?? "[]");
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function save(flags: Flag[]) {
  try {
    window.localStorage.setItem(KEY, JSON.stringify(flags.slice(-1000)));
    window.dispatchEvent(new Event(FLAGS_EVENT));
  } catch {
    /* storage full */
  }
}

export function addFlag(input: FlagInput, now = Date.now()): Flag {
  const flag: Flag = { ...input, id: `${now.toString(36)}-${Math.random().toString(36).slice(2, 7)}`, at: now };
  save([...loadFlags(), flag]);
  return flag;
}

export function updateFlag(id: string, change: Partial<Pick<Flag, "note">>) {
  save(loadFlags().map((f) => (f.id === id ? { ...f, ...change } : f)));
}

export function removeFlag(id: string) {
  save(loadFlags().filter((f) => f.id !== id));
}

/** Flags as plain text for pasting into a conversation about the prompts. */
export function flagsAsText(flags: Flag[]): string {
  return flags
    .map((f) => [
      `## ${f.kind} — ${new Date(f.at).toISOString().slice(0, 16).replace("T", " ")}${f.subject ? ` — ${f.subject}` : ""}${f.model ? ` (${f.model})` : ""}`,
      ...f.context.map((c) => `**${c.label}:** ${c.text}`),
      `**AI output:** ${f.output}`,
      ...(f.links?.length ? [`**Sources:** ${f.links.map((l) => (l.url ? `${l.title} <${l.url}>` : l.title)).join("; ")}`] : []),
      ...(f.note ? [`**My note:** ${f.note}`] : []),
    ].join("\n"))
    .join("\n\n");
}
