/**
 * Turning a script into what it takes to make it: a shot list, one row per
 * shot with a box to tick, tied to the script line it serves; and a prep
 * list of everything production has to find — space, people, props, kit.
 *
 * Interview soundbites already recorded get no shot: those lines are filmed.
 */

import { escapeHtml, live, posId, put, type Board, type BoxItem, type PosItem } from "./subjects";
import type { ScriptQuote } from "./factcheck";

export type Shot = {
  row: number;
  /** Wide, close-up, insert, B-roll, graphic, piece to camera… */
  type: string;
  description: string;
  talent: string[];
  props: string[];
  location: string;
};

export const NEED_CATEGORIES = [
  "Studio & locations",
  "Talent",
  "Props & items",
  "Wardrobe & makeup",
  "Equipment",
  "Graphics & archive",
  "Crew",
  "Permissions & other",
] as const;
export type NeedCategory = (typeof NEED_CATEGORIES)[number];
export type Need = { category: NeedCategory; item: string; detail: string; rows: number[] };

export type ProductionInput = {
  rows: { row: number; text: string; visual?: string }[];
  /** Lines quoting an interview already recorded: no shot to plan for them. */
  quotes?: Pick<ScriptQuote, "row" | "speaker" | "text">[];
  provider?: string;
  model?: string;
};
export type ProductionResult = {
  shots: Shot[];
  needs: Need[];
  usages: { provider: "anthropic" | "openai"; model: string; input: number; output: number }[];
};

/** What "Line" says of a script row: its number and first words, so a shot can be found in the script. */
function lineLabel(row: number, text: string | undefined) {
  const words = (text ?? "").replace(/\s+/g, " ").trim();
  const short = words.length > 60 ? `${words.slice(0, 60).replace(/\s+\S*$/, "")}…` : words;
  return `<b>Row ${row}</b>${short ? `<br>${escapeHtml(short)}` : ""}`;
}

const list = (items: string[]) => escapeHtml(items.filter(Boolean).join(", "));

/** The shot list as a table: a tick box and number, the script line, then what the shot is and needs. */
export function shotlistGrid(shots: Shot[], rows: ProductionInput["rows"]): string[][] {
  const text = new Map(rows.map((r) => [r.row, r.text]));
  return [
    ["Shot", "Script line", "Type", "Description", "Talent", "Props / items", "Location"],
    ...shots.map((s, i) => [
      `<ul data-check=""><li>${i + 1}</li></ul>`,
      lineLabel(s.row, text.get(s.row)),
      escapeHtml(s.type),
      escapeHtml(s.description),
      list(s.talent),
      list(s.props),
      escapeHtml(s.location),
    ]),
  ];
}

/** Production prep as a checklist under each heading, with the script rows that call for each thing. */
export function prepHtml(needs: Need[], subject?: string): string {
  const parts = [`<h2>Production prep${subject ? ` — ${escapeHtml(subject)}` : ""}</h2>`];
  for (const category of NEED_CATEGORIES) {
    const here = needs.filter((n) => n.category === category);
    if (!here.length) continue;
    parts.push(`<h3>${category}</h3><ul data-check="">${here.map((n) => {
      const rows = n.rows.length ? ` <i>(row${n.rows.length > 1 ? "s" : ""} ${n.rows.join(", ")})</i>` : "";
      return `<li><b>${escapeHtml(n.item)}</b>${n.detail ? ` — ${escapeHtml(n.detail)}` : ""}${rows}</li>`;
    }).join("")}</ul>`);
  }
  if (parts.length === 1) parts.push("<p>Nothing to prepare was found in the script.</p>");
  return parts.join("");
}

/**
 * The shot list and the prep list beside the script, connected to it. Run
 * again, they are replaced in place, wherever they have been moved to.
 */
export function putProduction(board: Board | undefined, scriptId: string, shots: string[][], prep: string, newId: () => string, now = Date.now()): Board {
  let next: Board = board ?? {};
  const pos = next[posId(scriptId)] as PosItem | undefined;
  const place = (key: string, change: Partial<BoxItem>, dx: number, dy: number, w: number) => {
    const held = live(next).find((item): item is BoxItem => item.kind === "box" && (item as BoxItem).notesFor === key);
    if (held) {
      next = put(next, { ...held, ...change, at: now });
      return;
    }
    const id = newId();
    next = put(next, { id, kind: "box", html: "", notesFor: key, ...change, at: now } as BoxItem);
    if (pos && !pos.deleted) next = put(next, { id: posId(id), kind: "pos", target: id, x: pos.x + dx, y: pos.y + dy, w, at: now });
    next = put(next, { id: `link:${scriptId}|${id}`, kind: "link", from: scriptId, to: id, at: now });
  };
  // To the right of the script, past where its fact-check notes sit.
  const right = (pos?.w ?? 600) + 460;
  place(`${scriptId}#shots`, { table: shots, tableMode: "doc", tableName: "Shot list", tableTabs: undefined, tableCols: undefined, tableRows: undefined, tableCells: undefined }, right, 0, 980);
  place(`${scriptId}#prep`, { html: prep }, right + 1040, 0, 420);
  return next;
}

/** Whether a box is one of the production lists made from a script. */
export const productionOf = (box: BoxItem) => (box.notesFor?.endsWith("#shots") ? "shots" : box.notesFor?.endsWith("#prep") ? "prep" : null);
