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
import { firstWords, remainderNote, TRANSCRIPT_PREVIEW_WORDS, wordsIn } from "./print";
import type { Note } from "./notes";
import {
  bylineOf,
  captionHtmlOf,
  cardsOf,
  contactsOf,
  safeImage,
  composeCardDoc,
  drawingSvg,
  escapeHtml,
  live,
  sanitizeRichText,
  tabOf,
  tabsOf,
  textOf,
  type Board,
  type BoxItem,
  type Card,
  type InsightItem,
  type SuggestItem,
} from "./subjects";

const LABEL: Record<InsightItem["type"], string> = { connection: "Connection", question: "Question", deeper: "Deeper" };

/**
 * Who the HTML is for. The Google Doc export (the default) gets plain
 * formatting a Doc keeps: a drawing is named, since a Doc drops SVG, and a
 * transcript is given whole. A printed page gets drawings drawn, classes its
 * stylesheet lays out, and transcripts as an opening excerpt unless the
 * whole of them is asked for.
 */
export type Output = { print?: boolean; fullTranscripts?: boolean };

function unlinkQuotes(html: string, board?: Board, out: Output = {}) {
  return sanitizeRichText(html)
    .replace(/<a data-quote="[^"]+">([\s\S]*?)<\/a>/g, "$1")
    .replace(/<img data-embed="([^"]+)">/g, (_, id: string) => {
      const item = board?.[id];
      if (!item || item.kind !== "box") return "";
      const image = safeImage(item.image);
      if (image) return `<img src="${image}" alt="" style="max-width:100%">`;
      if (!item.drawing) return "";
      return out.print ? `<img src="${drawingSvg(item)}" alt="A drawing" style="max-width:100%">` : "<i>[A drawing]</i>";
    });
}

type CardLike = Pick<Card, "link" | "title" | "note" | "quotes" | "publishedAt" | "author" | "source">;

/** A story's quotes and notes, without its headline. */
export function cardNotesHtml(card: CardLike, board?: Board, out: Output = {}): string {
  return unlinkQuotes(composeCardDoc(card.note, card.quotes), board, out);
}

/** A story as written up: its headline, linked, the byline, then the quotes and notes. */
export function cardHtml(card: CardLike, board?: Board, out: Output = {}): string {
  const byline = bylineOf(card);
  return (
    `<h3><a href="${escapeHtml(card.link)}">${escapeHtml(card.title)}</a></h3>` +
    (byline ? (out.print ? `<p class="print-byline">${escapeHtml(byline)}</p>` : `<p><i>${escapeHtml(byline)}</i></p>`) : "") +
    cardNotesHtml(card, board, out)
  );
}

/** What a box is, in a word: for its print button and the class its printed block carries. */
export function boxKind(box: BoxItem): "label" | "image" | "transcript" | "table" | "drawing" | "text" {
  if (box.label) return "label";
  if (box.image !== undefined || box.caption !== undefined) return "image";
  if (box.transcript) return "transcript";
  if (box.table) return "table";
  if (box.drawing) return "drawing";
  return "text";
}

/** A box as written up: a section heading, picture, transcript, table, drawing or text. */
export function boxHtml(box: BoxItem, board?: Board, out: Output = {}): string {
  if (box.label) return `<h2 class="section">${escapeHtml(textOf(box.html).trim())}</h2>`;
  const image = safeImage(box.image);
  if (image) {
    // The caption reads as the writing it is, under the picture — not a line of small italics.
    const caption = captionHtmlOf(box) ? unlinkQuotes(captionHtmlOf(box), board, out) : "";
    if (out.print) return `<figure><img src="${image}" alt=""></figure>${caption}`;
    return `<p><img src="${image}" alt="" style="max-width:100%"></p>${caption}`;
  }
  if (box.transcript) return out.print ? transcriptHtml(box.transcript, box.transcriptTabs, { full: out.fullTranscripts }) : transcriptHtml(box.transcript, box.transcriptTabs);
  if (box.table) return tableCardHtml(box);
  if (box.drawing) {
    return out.print
      ? `<p><img src="${drawingSvg(box)}" alt="A drawing"></p>`
      : "<p><i>[A drawing — open the subject in Super Reader to see it]</i></p>";
  }
  return unlinkQuotes(box.html, board, out);
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
    for (const card of tabCards) parts.push(cardHtml(card, board));
    for (const box of tabBoxes) parts.push(box.label ? unlinkQuotes(box.html, board) : boxHtml(box, board));
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
/** A table card, every tab of it, each under its name when there are several. */
export function tableCardHtml(box: Pick<BoxItem, "table" | "tableMode" | "tableCells" | "tableName" | "tableTabs">): string {
  const tabs = box.tableTabs ?? [];
  if (!tabs.length) return tableHtml(box.table, box.tableMode, box.tableCells);
  return [{ name: box.tableName || "Table 1", ...box }, ...tabs.map((t, i) => ({ ...t, name: t.name || `Table ${i + 2}` }))]
    .map((t) => `<h4>${escapeHtml(t.name)}</h4>${tableHtml(t.table, t.tableMode, t.tableCells)}`)
    .join("");
}

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

/**
 * A transcript as who-said-what paragraphs. Without `print` this is the
 * export's form, unchanged. With it, the printed form: each turn's speaker
 * and time over what they said — and, unless `full`, only the opening
 * (about TRANSCRIPT_PREVIEW_WORDS words) and a line saying how much more
 * there is. A transcript can run to hours; a print of a subject should not
 * be forty pages of one interview unless that is what was asked for.
 */
export function transcriptHtml(input: unknown, more?: unknown, print?: { full?: boolean }): string {
  const all = [input, ...(Array.isArray(more) ? more : [])];
  return print ? all.map((t) => printedTranscriptHtml(t, Boolean(print.full))).join("") : all.map(oneTranscriptHtml).join("");
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

function printedTranscriptHtml(input: unknown, full: boolean): string {
  const { title, turns } = safeTranscript(input);
  const shown: typeof turns = [];
  let words = 0;
  for (const turn of turns) {
    if (!full && words >= TRANSCRIPT_PREVIEW_WORDS) break;
    const n = wordsIn(turn.x);
    // A long turn is cut rather than dropped: the excerpt always says something.
    shown.push(!full && words + n > TRANSCRIPT_PREVIEW_WORDS * 1.4 ? { ...turn, x: firstWords(turn.x, Math.max(40, TRANSCRIPT_PREVIEW_WORDS - words)) } : turn);
    words += n;
  }
  const turnHtml = (t: (typeof turns)[number]) => {
    const head = t.s || t.t ? `<p>${t.s ? `<span class="t-who">${escapeHtml(t.s)}</span>` : ""}${t.t ? `<span class="t-time">${escapeHtml(t.t)}</span>` : ""}</p>` : "";
    return `<div class="t-turn">${head}${t.x.split("\n\n").map((p) => `<p>${escapeHtml(p)}</p>`).join("")}</div>`;
  };
  const cut = shown.length > 0 && shown[shown.length - 1].x !== turns[shown.length - 1].x;
  const restTurns = turns.slice(shown.length);
  const restWords = restTurns.reduce((n, t) => n + wordsIn(t.x), 0) + (cut ? wordsIn(turns[shown.length - 1].x) - wordsIn(shown[shown.length - 1].x) : 0);
  const rest = !full && (restTurns.length > 0 || cut) ? remainderNote(restTurns.length, restWords) : "";
  return `<div class="print-transcript"><p class="t-title">Transcript${title ? ` — ${escapeHtml(title)}` : ""}</p>${shown.map(turnHtml).join("") || "<p><i>Empty</i></p>"}${rest}</div>`;
}
