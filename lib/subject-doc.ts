/**
 * A subject as a readable document — for the Google Doc backup and the
 * Export button. Everything the person made is in it, in reading order, in
 * plain formatting a Doc keeps: every tab as a section, each story as a
 * linked heading with its quotes and notes, the text boxes, then the AI's
 * insights and any suggested reading still open. If the app vanished
 * tomorrow, this document alone would hold the work.
 */

import type { Note } from "./notes";
import {
  bylineOf,
  cardsOf,
  contactsOf,
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

function unlinkQuotes(html: string) {
  return sanitizeRichText(html).replace(/<a data-quote="[^"]+">([\s\S]*?)<\/a>/g, "$1");
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
    const tabBoxes = boxes.filter((box) => tabOf(board, box.id, tabs) === tab.id);
    if (tabs.length > 1) parts.push(`<h2>${escapeHtml(tab.name)}</h2>`);
    if (tabCards.length === 0 && tabBoxes.length === 0) parts.push("<p><i>Empty</i></p>");
    for (const card of tabCards) {
      parts.push(`<h3><a href="${escapeHtml(card.link)}">${escapeHtml(card.title)}</a></h3>`);
      if (bylineOf(card)) parts.push(`<p><i>${escapeHtml(bylineOf(card))}</i></p>`);
      parts.push(unlinkQuotes(composeCardDoc(card.note, card.quotes)));
    }
    for (const box of tabBoxes) parts.push(unlinkQuotes(box.html));
  }
  const contacts = contactsOf(board);
  if (contacts.length > 0) {
    parts.push("<h2>Contacts</h2><ul>");
    for (const c of contacts) {
      const details = [c.role, c.email, c.phone].filter(Boolean).map((d) => escapeHtml(d!)).join(" · ");
      parts.push(`<li><b>${escapeHtml(c.name)}</b>${details ? ` — ${details}` : ""}${c.why ? `<br><i>${escapeHtml(c.why)}</i>` : ""}</li>`);
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
