/**
 * Fact-checking a script table against the subject's research.
 *
 * A script is a two- or three-column table — Visuals, Words, and
 * optionally Notes — and only the Words column is checked: what is said is
 * what has to be right. The research is the subject's own story cards,
 * notes and interview transcripts; each is given a short id (S1, N1, T1) so
 * the model can name its sources and they can be linked back.
 */

import { escapeHtml, live, posId, put, sanitizeRichText, textOf, type Board, type BoxItem, type Card, type PosItem } from "./subjects";
import { safeGrid, type Grid } from "./sheet";
import { safeTranscript } from "./transcript";

export type FactStatus = "pass" | "verify" | "contradicts";
export type FactSource = { ref: string; quote: string };
export type FactClaim = { row: number; text: string; status: FactStatus; why: string; sources: FactSource[] };
export type FactOmission = { text: string; refs: string[] };
export type FactCheckInput = {
  rows: { row: number; text: string; visual?: string }[];
  sources: { id: string; title?: string; text: string }[];
  provider?: string;
  model?: string;
};
export type FactCheckResult = {
  claims: FactClaim[];
  omissions: FactOmission[];
  web: { text: string; url: string }[];
  usages: { provider: "anthropic" | "openai"; model: string; input: number; output: number }[];
};

/** What a short source id points at, so a claim's source can be shown and opened. */
export type SourceTarget =
  | { kind: "card"; id: string; title: string; link: string; source?: string }
  | { kind: "note"; id: string; title: string }
  | { kind: "transcript"; id: string; title: string };

/** A finished check, kept on the script's table. */
export type FactCheck = { at: number; claims: FactClaim[]; targets: Record<string, SourceTarget> };

/** Which column holds what: by the header row's words, else by position. */
export function scriptColumns(table: unknown): { words: number; visuals: number | null; notes: number | null; header: boolean } {
  const grid = safeGrid(table);
  const head = grid[0].map((cell) => textOf(cell).trim().toLowerCase());
  const find = (re: RegExp) => {
    const i = head.findIndex((h) => re.test(h));
    return i >= 0 ? i : null;
  };
  const words = find(/\b(words?|script|narration|voice ?over|vo|dialogue|audio|copy|text)\b/);
  const visuals = find(/\b(visuals?|video|picture|shots?|b-?roll|on ?screen)\b/);
  const notes = find(/\b(notes?|comments?|sources?)\b/);
  const header = words !== null || visuals !== null || notes !== null;
  const cols = grid[0].length;
  if (words !== null) return { words, visuals, notes, header };
  // Visuals | Words | Notes, the usual layout, when the header does not say.
  const guess = cols >= 2 ? (visuals === 1 ? 0 : 1) : 0;
  return { words: guess, visuals: visuals ?? (cols >= 2 && guess === 1 ? 0 : null), notes: notes ?? (cols >= 3 ? 2 : null), header };
}

/** The script's rows to check: the words column, with what is on screen beside it. */
export function scriptRows(table: unknown): FactCheckInput["rows"] {
  const grid: Grid = safeGrid(table);
  const { words, visuals, header } = scriptColumns(table);
  return grid.flatMap((row, r) => {
    if (header && r === 0) return [];
    const text = textOf(row[words] ?? "").trim();
    if (!text) return [];
    const visual = visuals !== null ? textOf(row[visuals] ?? "").trim() : "";
    return [{ row: r, text, ...(visual ? { visual } : {}) }];
  });
}

/**
 * The subject's research as sources with short ids, and what each id is.
 * The script table itself, and any card made from an earlier check, are
 * left out — a script cannot corroborate itself.
 */
export function researchOf(cards: Card[], boxes: BoxItem[], scriptId: string): { sources: FactCheckInput["sources"]; targets: Record<string, SourceTarget> } {
  const sources: FactCheckInput["sources"] = [];
  const targets: Record<string, SourceTarget> = {};
  cards.forEach((card, i) => {
    const id = `S${i + 1}`;
    const lines = [
      `Headline: ${card.title}${card.source ? ` (${card.source})` : ""}${card.publishedAt ? `, ${card.publishedAt.slice(0, 10)}` : ""}`,
      ...card.quotes.map((q) => `Quoted: “${q.text}”`),
      card.note ? `Writer's notes: ${textOf(card.note)}` : "",
    ].filter(Boolean);
    sources.push({ id, title: card.title, text: lines.join("\n") });
    targets[id] = { kind: "card", id: card.id, title: card.title, link: card.link, ...(card.source ? { source: card.source } : {}) };
  });
  let n = 0;
  let t = 0;
  for (const box of boxes) {
    if (box.id === scriptId || box.notesFor === `${scriptId}#facts` || box.embedded) continue;
    if (box.transcript) {
      for (const tr of [box.transcript, ...(box.transcriptTabs ?? [])].map(safeTranscript)) {
        if (!tr.turns.length) continue;
        const id = `T${++t}`;
        const title = tr.title || "Transcript";
        sources.push({ id, title, text: tr.turns.map((turn, k) => `[${id}#${k}] ${turn.s ? `${turn.s}: ` : ""}${turn.x.replace(/\s+/g, " ")}`).join("\n") });
        targets[id] = { kind: "transcript", id: box.id, title };
      }
      continue;
    }
    const text = box.table ? safeGrid(box.table).map((row) => row.map((c) => textOf(c)).join(" | ")).join("\n") : textOf(box.html || "");
    if (!text.trim()) continue;
    const id = `N${++n}`;
    const title = text.split("\n")[0].slice(0, 60);
    sources.push({ id, title, text });
    targets[id] = { kind: "note", id: box.id, title };
  }
  return { sources, targets };
}

/** A source id as a reader would name it: "Reuters: Headline", "Interview with X". */
export function sourceLabel(ref: string, targets: Record<string, SourceTarget>): string {
  const target = targets[ref] ?? targets[ref.split("#")[0]];
  if (!target) return ref;
  if (target.kind === "card") return target.source ? `${target.source}: ${target.title}` : target.title;
  if (target.kind === "transcript") return target.title;
  return `Note: ${target.title}`;
}

/** The card beside the script: facts the script leaves out, from the research and the web. */
export function omissionsHtml(result: Pick<FactCheckResult, "omissions" | "web">, targets: Record<string, SourceTarget>): string {
  const parts: string[] = ["<h3>Worth considering</h3>"];
  if (result.omissions.length) {
    parts.push("<p><b>From your research</b></p><ul>");
    for (const o of result.omissions) {
      const from = [...new Set(o.refs.map((r) => sourceLabel(r, targets)))].slice(0, 3).join("; ");
      parts.push(`<li>${escapeHtml(o.text)}${from ? ` <i>(${escapeHtml(from)})</i>` : ""}</li>`);
    }
    parts.push("</ul>");
  }
  if (result.web.length) {
    parts.push("<p><b>From the web</b></p><ul>");
    for (const w of result.web) {
      let host = "";
      try { host = new URL(w.url).hostname.replace(/^www\./, ""); } catch { /* shown without it */ }
      parts.push(`<li>${escapeHtml(w.text)} <a href="${escapeHtml(w.url)}">${escapeHtml(host || "source")}</a></li>`);
    }
    parts.push("</ul>");
  }
  if (!result.omissions.length && !result.web.length) parts.push("<p>Nothing obvious is missing from the script.</p>");
  return sanitizeRichText(parts.join(""));
}

/**
 * The omissions card, made beside the script and linked to it on the first
 * check, and rewritten (not added to) on each check after.
 */
export function putFactNotes(board: Board | undefined, scriptId: string, html: string, newId: string, now = Date.now()): Board {
  let next: Board = board ?? {};
  const key = `${scriptId}#facts`;
  const held = live(next).find((item): item is BoxItem => item.kind === "box" && (item as BoxItem).notesFor === key);
  if (held) return put(next, { ...held, html, at: now });
  next = put(next, { id: newId, kind: "box", html, notesFor: key, at: now });
  const pos = next[posId(scriptId)] as PosItem | undefined;
  if (pos && !pos.deleted) next = put(next, { id: posId(newId), kind: "pos", target: newId, x: pos.x + pos.w + 60, y: pos.y, w: 340, at: now });
  return put(next, { id: `link:${scriptId}|${newId}`, kind: "link", from: scriptId, to: newId, at: now });
}

/** A check kept on a table, made safe to read back from storage or sync. */
export function safeFactCheck(input: unknown): FactCheck | null {
  if (!input || typeof input !== "object") return null;
  const v = input as Partial<FactCheck>;
  if (!Array.isArray(v.claims)) return null;
  const claims = v.claims.slice(0, 500).flatMap((c): FactClaim[] => {
    if (!c || typeof c !== "object" || !Number.isInteger(c.row) || typeof c.text !== "string") return [];
    const status: FactStatus = c.status === "pass" || c.status === "contradicts" ? c.status : "verify";
    const sources = (Array.isArray(c.sources) ? c.sources : []).slice(0, 5).flatMap((s): FactSource[] =>
      s && typeof s.ref === "string" ? [{ ref: s.ref.slice(0, 20), quote: typeof s.quote === "string" ? s.quote.slice(0, 400) : "" }] : []);
    return [{ row: c.row, text: c.text.slice(0, 2000), status, why: typeof c.why === "string" ? c.why.slice(0, 400) : "", sources }];
  });
  const targets: Record<string, SourceTarget> = {};
  for (const [k, t] of Object.entries(v.targets && typeof v.targets === "object" ? v.targets : {})) {
    if (!t || typeof t !== "object" || typeof (t as SourceTarget).id !== "string") continue;
    const kind = (t as SourceTarget).kind;
    if (kind === "card" || kind === "note" || kind === "transcript") targets[k.slice(0, 20)] = t as SourceTarget;
  }
  return { at: typeof v.at === "number" ? v.at : 0, claims, targets };
}
