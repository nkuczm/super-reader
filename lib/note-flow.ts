/**
 * A note as one flowing page of writing, with the quotes highlighted in it.
 *
 * The note itself is still a list of entries (lib/notes.ts) — that is what
 * syncs, and what a quote's bookmark hangs off. This module is the translation
 * between that list and the single editable surface the note page presents:
 * runs of your own writing with the quoted passages sitting among them, so a
 * quote can be typed either side of like any other word.
 *
 * The editor is uncontrolled — once the page is open the browser owns the DOM,
 * because nothing else keeps a cursor where the reader left it. So the shape
 * here is: build the flow once from the entries, and after every edit read the
 * DOM back and fold it into a fresh list.
 *
 * Folding has to keep identities steady, or syncing would see every keystroke
 * as a delete and an add. A run of writing is identified by the quote it sits
 * in front of — stable through any amount of typing, and only disturbed by
 * adding or removing a quote, which is a deliberate act rather than something
 * that happens on its own.
 */

import { isQuote, type NoteComment, type NoteEntry, type NoteQuote } from "./notes";

/** The key for the run of writing after the last quote — or the whole note. */
export const END_SLOT = "\u0000end";

/**
 * A caret needs something to stand in, and two quotes side by side leave it
 * nowhere to go. An empty run is rendered as a zero-width space so there is
 * always somewhere to click; it is stripped again on the way back.
 */
export const CARET_SPACE = "\u200b";

export type FlowPiece =
  | { kind: "text"; text: string }
  | { kind: "quote"; quote: NoteQuote };

type Slot = {
  text: string;
  /**
   * The entry this run came from, when there is exactly one. A slot holding
   * several — which older notes have, from when every line was its own entry
   * — has no single identity to keep, so the next edit gives it a fresh one.
   */
  original: NoteComment | null;
};

/** The writing in a note, grouped by the quote each run sits in front of. */
export function slotsOf(entries: NoteEntry[]): Map<string, Slot> {
  const slots = new Map<string, Slot>();
  let texts: string[] = [];
  let originals: NoteComment[] = [];

  const flush = (key: string) => {
    slots.set(key, {
      text: texts.join("\n"),
      original: originals.length === 1 ? originals[0] : null,
    });
    texts = [];
    originals = [];
  };

  for (const entry of entries) {
    if (isQuote(entry)) {
      flush(entry.id);
    } else {
      if (entry.text) texts.push(entry.text);
      originals.push(entry);
    }
  }
  flush(END_SLOT);
  return slots;
}

/** The page as it is laid out: writing, quote, writing, quote, … writing. */
export function flowOf(entries: NoteEntry[]): FlowPiece[] {
  const slots = slotsOf(entries);
  const pieces: FlowPiece[] = [];
  for (const entry of entries) {
    if (!isQuote(entry)) continue;
    pieces.push({ kind: "text", text: slots.get(entry.id)?.text ?? "" });
    pieces.push({ kind: "quote", quote: entry });
  }
  pieces.push({ kind: "text", text: slots.get(END_SLOT)?.text ?? "" });
  return pieces;
}

const TEXT_NODE = 3;
const ELEMENT_NODE = 1;

/**
 * Read the editor back: which quotes are still in it, in what order, and the
 * writing between them.
 *
 * Always one more run than there are quotes — the writing before the first,
 * between each pair, and after the last, any of which may be empty.
 */
export function readFlow(container: Element): { quoteIds: string[]; runs: string[] } {
  const quoteIds: string[] = [];
  const runs: string[] = [];
  let current = "";

  const walk = (node: Node) => {
    for (const child of Array.from(node.childNodes)) {
      if (child.nodeType === TEXT_NODE) {
        current += child.nodeValue ?? "";
        continue;
      }
      if (child.nodeType !== ELEMENT_NODE) continue;
      const element = child as Element;

      const id = element.getAttribute("data-quote-id");
      if (id) {
        runs.push(current);
        current = "";
        quoteIds.push(id);
        continue;
      }
      if (element.tagName === "BR") {
        current += "\n";
        continue;
      }
      // Anything the browser wrapped around the writing is walked rather than
      // flattened, so a quote inside it is still a quote and not a run of
      // plain text that could never be deleted again.
      if (element.querySelector("[data-quote-id]")) {
        walk(element);
        continue;
      }
      current += element.textContent ?? "";
    }
  };

  walk(container);
  runs.push(current);

  return {
    quoteIds,
    runs: runs.map((run) => run.split(CARET_SPACE).join("")),
  };
}

function randomId() {
  return Math.random().toString(36).slice(2, 10);
}

/**
 * Fold the editor's contents back into a note's entries.
 *
 * Quotes are carried across untouched — this path can remove one, never
 * rewrite it, which is what makes a quote a quote. A run of writing keeps the
 * entry it came from, so ordinary typing edits an entry rather than replacing
 * it, and a run that has been emptied leaves no entry behind at all.
 */
export function foldFlow(
  previous: NoteEntry[],
  quoteIds: string[],
  runs: string[],
  now = Date.now(),
): NoteEntry[] {
  const quoteById = new Map(
    previous.filter(isQuote).map((entry) => [entry.id, entry] as const),
  );
  const slots = slotsOf(previous);
  const entries: NoteEntry[] = [];

  const pushRun = (text: string, key: string) => {
    if (!text.trim()) return;
    const slot = slots.get(key);
    if (slot?.original && slot.text === text) {
      entries.push(slot.original);
    } else if (slot?.original) {
      entries.push({ ...slot.original, text, editedAt: now });
    } else {
      entries.push({ id: randomId(), kind: "text", text, at: now, editedAt: now });
    }
  };

  quoteIds.forEach((id, index) => {
    pushRun(runs[index] ?? "", id);
    const quote = quoteById.get(id);
    if (quote) entries.push(quote);
  });
  pushRun(runs[quoteIds.length] ?? "", END_SLOT);

  return entries;
}

/**
 * Put what the page folded back into the note it belongs to.
 *
 * The page is built once and then owned by the browser, so it does not know
 * about anything that arrived while it was open — a quote taken on a phone,
 * landing in this note through a sync. Left alone, the next keystroke would
 * fold the page as it stands, notice that quote missing, and bury it. So
 * anything the page never knew about survives its edits: only what it was
 * holding and has since let go of counts as deleted.
 */
export function foldIntoNote(
  noteEntries: NoteEntry[],
  folded: NoteEntry[],
  known: ReadonlySet<string>,
): NoteEntry[] {
  const kept = new Set(folded.map((entry) => entry.id));
  const arrived = noteEntries.filter(
    (entry) => !known.has(entry.id) && !kept.has(entry.id),
  );
  return arrived.length === 0 ? folded : [...folded, ...arrived];
}
