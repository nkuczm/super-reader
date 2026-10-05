/**
 * A subject as a readable document — for the Google Doc backup and the
 * Export button. Everything the person made is in it, in reading order, in
 * plain formatting a Doc keeps: every tab as a section, each story as a
 * linked heading with its quotes and notes, the text boxes, then the AI's
 * insights and any suggested reading still open. If the app vanished
 * tomorrow, this document alone would hold the work.
 */

import { cellKey, coveredCells, display, evaluate, safeGrid, safeMetas } from "./sheet";
import { safeTranscript } from "./transcript";
import type { Note } from "./notes";
import {
  bylineOf,
  cardsOf,
  contactsOf,
  safeImage,
  composeCardDoc,
  escapeHtml,
  live,
  sanitizeRichText,
  tabOf,
  tabsOf,
  type Board,
  type BoxItem,
  type InsightItem,
  type SuggestItem,
} from "./subjects";

const LABEL: Record<InsightItem["type"], string> = { connection: "Connection", question: "Question", deeper: "Deeper" };

function unlinkQuotes(html: string, board?: Board) {
  return sanitizeRichText(html)
    .replace(/<a data-quote="[^"]+">([\s\S]*?)<\/a>/g, "$1")
    .replace(/<img data-embed="([^"]+)">/g, (_, id: string) => {
      const item = board?.[id];
      if (!item || item.kind !== "box") return "";
      const image = safeImage(item.image);
      return image ? `<img src="${image}" alt="" style="max-width:100%">` : item.drawing ? "<i>[A drawing]</i>" : "";
    });
}

export function subjectHtml(note: Note, board: Board | undefined, now = new Date()): string {
  const tabs = tabsOf(board);
  const cards = cardsOf(note, board);
  const items = live(board);
  const boxes = items.filter((item): item is BoxItem => item.kind === "box");
  const insights = items.filter((item): item is InsightItem => item.kind === "insight");
  const suggestions = items.filter((item): item is SuggestItem => item.kind === "suggest" && item.state === "pending");

  const parts: string[] = [
    `<h1>${escapeHtml(note.name)}</h1>`,
    `<p><i>From Super Reader · backed up ${escapeHtml(now.toUTCString())}</i></p>`,
  ];
  for (const tab of tabs) {
    const tabCards = cards.filter((card) => tabOf(board, card.id, tabs) === tab.id);
    const tabBoxes = boxes.filter((box) => !box.embedded && tabOf(board, box.id, tabs) === tab.id);
    if (tabs.length > 1) parts.push(`<h2>${escapeHtml(tab.name)}</h2>`);
    if (tabCards.length === 0 && tabBoxes.length === 0) parts.push("<p><i>Empty</i></p>");
    for (const card of tabCards) {
      parts.push(`<h3><a href="${escapeHtml(card.link)}">${escapeHtml(card.title)}</a></h3>`);
      if (bylineOf(card)) parts.push(`<p><i>${escapeHtml(bylineOf(card))}</i></p>`);
      parts.push(unlinkQuotes(composeCardDoc(card.note, card.quotes), board));
    }
    for (const box of tabBoxes) {
      const image = safeImage(box.image);
      if (image) parts.push(`<p><img src="${image}" alt="" style="max-width:100%"></p>${box.caption ? `<p><i>${escapeHtml(box.caption)}</i></p>` : ""}`);
      else if (box.transcript) parts.push(transcriptHtml(box.transcript, box.transcriptTabs));
      else if (box.table) parts.push(tableHtml(box.table, box.tableMode, box.tableCells));
      else if (box.drawing) parts.push("<p><i>[A drawing — open the subject in Super Reader to see it]</i></p>");
      else parts.push(unlinkQuotes(box.html, board));
    }
  }
  const contacts = contactsOf(board);
  if (contacts.length > 0) {
    parts.push("<h2>Contacts</h2><ul>");
    for (const c of contacts) {
      const details = [c.role, c.email, c.phone, c.linkedin].filter(Boolean).map((d) => escapeHtml(d!)).join(" · ");
      parts.push(`<li><b>${escapeHtml(c.name)}</b>${details ? ` — ${details}` : ""}${c.why ? `<br><i>${escapeHtml(c.why)}</i>` : ""}${c.notes ? `<br>${escapeHtml(c.notes).replace(/\n/g, "<br>")}` : ""}</li>`);
    }
    parts.push("</ul>");
  }
  if (insights.length > 0) {
    parts.push("<h2>Insights</h2><ul>");
    for (const insight of insights) parts.push(`<li><b>${LABEL[insight.type]}:</b> ${escapeHtml(insight.text)}</li>`);
    parts.push("</ul>");
  }
  if (suggestions.length > 0) {
    parts.push("<h2>Suggested reading</h2><ul>");
    for (const s of suggestions) {
      parts.push(`<li><a href="${escapeHtml(s.link)}">${escapeHtml(s.title)}</a> — ${escapeHtml(s.why)}</li>`);
    }
    parts.push("</ul>");
  }
  return `<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(note.name)}</title></head><body>${parts.join("\n")}</body></html>`;
}

/** A fingerprint of a subject's content, so an unchanged subject is not re-uploaded. */
export function subjectSignature(note: Note, board: Board | undefined): string {
  const content = subjectHtml(note, board, new Date(0));
  let hash = 5381;
  for (let i = 0; i < content.length; i += 1) hash = ((hash << 5) + hash + content.charCodeAt(i)) | 0;
  return `${content.length}:${(hash >>> 0).toString(36)}`;
}

/** A table as its worked-out values, for the exported copy. */
export function tableHtml(table: unknown, mode?: "doc" | "sheet", cells?: unknown): string {
  const grid = safeGrid(table);
  const metas = safeMetas(cells, grid.length, grid[0].length);
  const covered = coveredCells(metas);
  // A document table holds formatted text; only a spreadsheet works out formulas.
  const values = mode === "doc" ? null : evaluate(grid);
  const border = mode === "doc" ? "#000" : "#ccc";
  const rows = grid.map((row, r) => `<tr>${row.map((raw, c) => {
    if (covered.has(cellKey(r, c))) return "";
    const m = metas[cellKey(r, c)];
    const span = `${m?.rs ? ` rowspan="${m.rs}"` : ""}${m?.cs ? ` colspan="${m.cs}"` : ""}`;
    const text = values ? escapeHtml(display(values[r][c])) : /[<&]/.test(raw) ? sanitizeRichText(raw) : escapeHtml(raw).replace(/\n/g, "<br>");
    return `<td${span} style="border:1px solid ${border};padding:2px 6px;vertical-align:top${m?.bg ? `;background:${m.bg}` : ""}">${text}</td>`;
  }).join("")}</tr>`);
  return `<table style="border-collapse:collapse">${rows.join("")}</table>`;
}

/** A transcript as who-said-what paragraphs, for the exported copy. */
export function transcriptHtml(input: unknown, more?: unknown): string {
  return [input, ...(Array.isArray(more) ? more : [])].map(oneTranscriptHtml).join("");
}

function oneTranscriptHtml(input: unknown): string {
  const { title, turns } = safeTranscript(input);
  const head = `<p><b>Transcript${title ? ` — ${escapeHtml(title)}` : ""}</b></p>`;
  return head + turns
    .map((t) => {
      const who = t.s ? `<b>${escapeHtml(t.s)}</b>${t.t ? ` <i>(${escapeHtml(t.t)})</i>` : ""}: ` : "";
      return t.x.split("\n\n").map((p, i) => `<p>${i === 0 ? who : ""}${escapeHtml(p)}</p>`).join("");
    })
    .join("");
}
