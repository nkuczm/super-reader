"use client";

import { useEffect, useRef, useState } from "react";
import { DEFAULT_DRAWING_HEIGHT, DRAWING_WIDTH, escapeHtml, newItemId, safeImage, safeStrokes, type BoxItem, type Stroke } from "@/lib/subjects";
import { EMBED_TYPE } from "./RichText";
import FlagButton from "./FlagButton";
import { copyPicture } from "./CropDialog";
import { parseTranscript, safeTranscript, speakersOf, titleFromFile, type TMark, type TPoint, type Transcript } from "@/lib/transcript";

const COLORS = ["#111111", "#2563eb", "#dc2626", "#16a34a", "#f59e0b"];
const PEN_SIZES = [2, 5];
export const DRAWING_HEIGHT = DEFAULT_DRAWING_HEIGHT;

/** A handle to drag a drawing or picture into a text box's text. */
function EmbedGrip({ id }: { id: string }) {
  return (
    <span
      className="embed-grip"
      draggable
      title="Drag into a text box to set it in the text — then drag its corner to size it"
      onPointerDown={(e) => e.stopPropagation()}
      onDragStart={(event) => {
        event.dataTransfer.setData(EMBED_TYPE, id);
        event.dataTransfer.effectAllowed = "move";
      }}
    >
      ⠿
    </span>
  );
}

/** Every number pair in a stroke's path, for the eraser to test against. */
function pointsOf(d: string): [number, number][] {
  const nums = d.match(/-?\d+(\.\d+)?/g)?.map(Number) ?? [];
  const out: [number, number][] = [];
  for (let i = 0; i + 1 < nums.length; i += 2) out.push([nums[i], nums[i + 1]]);
  return out;
}

/**
 * A drawing pad: strokes in a fixed 600-wide space so a sketch keeps its
 * shape at any width, on any device. Saved when each stroke ends. ⌘Z and
 * ⌘⇧Z undo and redo while the pad is in use; the tools show only then too.
 */
export function DrawingPad({ box, onChange }: { box: BoxItem; onChange: (next: Partial<BoxItem>) => void }) {
  const strokes = safeStrokes(box.drawing);
  const height = Math.min(1200, Math.max(80, Number(box.height) || DRAWING_HEIGHT));
  const [color, setColor] = useState(COLORS[0]);
  const [size, setSize] = useState(PEN_SIZES[0]);
  const [erasing, setErasing] = useState(false);
  const [live, setLive] = useState<string | null>(null);
  const svg = useRef<SVGSVGElement | null>(null);
  const path = useRef<string[]>([]);
  /** Undo and redo, as whole stroke lists, for this visit. */
  const past = useRef<Stroke[][]>([]);
  const future = useRef<Stroke[][]>([]);
  /** Strokes as they stand mid-erase, before the change is saved. */
  const erased = useRef<Stroke[] | null>(null);
  const [, redraw] = useState(0);

  const commit = (next: Stroke[]) => {
    past.current.push(strokes);
    future.current = [];
    onChange({ drawing: next });
  };

  const toPoint = (event: React.PointerEvent): [number, number] => {
    const rect = svg.current!.getBoundingClientRect();
    const scale = DRAWING_WIDTH / rect.width;
    return [
      Math.round((event.clientX - rect.left) * scale * 10) / 10,
      Math.round((event.clientY - rect.top) * scale * 10) / 10,
    ];
  };

  const eraseAt = (x: number, y: number) => {
    const current = erased.current ?? strokes;
    const r = 10;
    const kept = current.filter(
      (s) => !pointsOf(s.d).some(([px, py]) => (px - x) ** 2 + (py - y) ** 2 <= (r + s.w) ** 2),
    );
    if (kept.length !== current.length) {
      erased.current = kept;
      redraw((n) => n + 1);
    }
  };

  const finish = () => {
    if (erasing) {
      if (erased.current && erased.current.length !== strokes.length) commit(erased.current);
      erased.current = null;
      path.current = [];
      return;
    }
    if (path.current.length === 0) return;
    // A single tap still leaves a dot.
    const parts = path.current.length === 1 ? [path.current[0], path.current[0]] : path.current;
    const d = `M ${parts[0]} ${parts.slice(1).map((p) => `L ${p}`).join(" ")}`;
    path.current = [];
    setLive(null);
    commit([...strokes, { d, color, w: size }]);
  };

  const shown = erased.current ?? strokes;

  return (
    <div
      className="drawing"
      tabIndex={0}
      onKeyDown={(event) => {
        if (!(event.metaKey || event.ctrlKey)) return;
        const key = event.key.toLowerCase();
        const redo = (key === "z" && event.shiftKey) || key === "y";
        if (key !== "z" && key !== "y") return;
        event.preventDefault();
        event.stopPropagation();
        if (redo) {
          const next = future.current.pop();
          if (!next) return;
          past.current.push(strokes);
          onChange({ drawing: next });
        } else {
          const prev = past.current.pop();
          if (!prev) return;
          future.current.push(strokes);
          onChange({ drawing: prev });
        }
      }}
    >
      <div className="drawing-tools" onPointerDown={(e) => e.stopPropagation()}>
        <EmbedGrip id={box.id} />
        {COLORS.map((c) => (
          <button key={c} className={`drawing-color${c === color && !erasing ? " on" : ""}`} style={{ background: c }}
            aria-label={`Pen colour ${c}`} onClick={() => { setColor(c); setErasing(false); }} />
        ))}
        {PEN_SIZES.map((w) => (
          <button key={w} className={`drawing-size${w === size && !erasing ? " on" : ""}`} aria-label={`Pen size ${w}`}
            onClick={() => { setSize(w); setErasing(false); }}>
            <span style={{ width: w + 2, height: w + 2 }} />
          </button>
        ))}
        <button className={`drawing-eraser${erasing ? " on" : ""}`} aria-pressed={erasing} title="Eraser — drag over a line to remove it"
          onClick={() => setErasing((e) => !e)}>
          <svg viewBox="0 0 24 24" width="15" height="15" aria-hidden="true">
            <path d="M16 3l5 5-10 10H6l-3-3z M9 9l6 6" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
          </svg>
        </button>
      </div>
      <div className="drawing-frame">
        <svg
          ref={svg}
          className={`drawing-canvas${erasing ? " erasing" : ""}`}
          viewBox={`0 0 ${DRAWING_WIDTH} ${height}`}
          onPointerDown={(event) => {
            event.stopPropagation();
            event.preventDefault();
            (event.currentTarget.parentElement?.parentElement as HTMLElement | null)?.focus({ preventScroll: true });
            (event.target as Element).setPointerCapture?.(event.pointerId);
            const [x, y] = toPoint(event);
            if (erasing) {
              path.current = ["e"];
              eraseAt(x, y);
              return;
            }
            path.current = [`${x} ${y}`];
            setLive(`M ${path.current[0]}`);
          }}
          onPointerMove={(event) => {
            if (path.current.length === 0) return;
            const [x, y] = toPoint(event);
            if (erasing) return eraseAt(x, y);
            path.current.push(`${x} ${y}`);
            setLive(`M ${path.current[0]} ${path.current.slice(1).map((p) => `L ${p}`).join(" ")}`);
          }}
          onPointerUp={finish}
          onPointerCancel={finish}
        >
          {shown.map((s, i) => (
            <path key={i} d={s.d} stroke={s.color} strokeWidth={s.w} fill="none" strokeLinecap="round" strokeLinejoin="round" />
          ))}
          {live && <path d={live} stroke={color} strokeWidth={size} fill="none" strokeLinecap="round" strokeLinejoin="round" />}
        </svg>
        <span
          className="drawing-pin"
          role="separator"
          aria-label="Drag to make the drawing taller or shorter"
          title="Drag to resize"
          onPointerDown={(event) => {
            event.stopPropagation();
            event.preventDefault();
            const rect = svg.current!.getBoundingClientRect();
            const scale = DRAWING_WIDTH / rect.width;
            const startY = event.clientY;
            const startH = height;
            const target = event.currentTarget;
            target.setPointerCapture(event.pointerId);
            let next = startH;
            const move = (e: PointerEvent) => {
              next = Math.round(Math.min(1200, Math.max(80, startH + (e.clientY - startY) * scale)));
              svg.current?.setAttribute("viewBox", `0 0 ${DRAWING_WIDTH} ${next}`);
            };
            const up = () => {
              target.removeEventListener("pointermove", move);
              target.removeEventListener("pointerup", up);
              target.removeEventListener("pointercancel", up);
              if (next !== startH) onChange({ height: next });
            };
            target.addEventListener("pointermove", move);
            target.addEventListener("pointerup", up);
            target.addEventListener("pointercancel", up);
          }}
        />
      </div>
    </div>
  );
}

/** "Add caption" chosen from a picture's menu: its caption field opens, ready to type in. */
export const CAPTION_EVENT = "super-reader:caption";

export function ImageView({ box, onChange, onRemove, dragHandle }: {
  box: BoxItem;
  onChange: (next: Partial<BoxItem>) => void;
  onRemove?: () => void;
  /** On the whiteboard: the whole picture moves the card; dropped on writing, it is set in there. */
  dragHandle?: (e: React.PointerEvent) => void;
}) {
  const src = safeImage(box.image);
  const [note, setNote] = useState<string | null>(null);
  // The caption shows once there is one — or once it is asked for, from the menu.
  const [captioning, setCaptioning] = useState(false);
  const caption = useRef<HTMLInputElement | null>(null);
  useEffect(() => {
    const open = (e: Event) => {
      if ((e as CustomEvent<string>).detail !== box.id) return;
      setCaptioning(true);
      requestAnimationFrame(() => caption.current?.focus());
    };
    window.addEventListener(CAPTION_EVENT, open);
    return () => window.removeEventListener(CAPTION_EVENT, open);
  }, [box.id]);
  const showCaption = !dragHandle || captioning || Boolean(box.caption?.trim());
  return (
    // Click the picture, then ⌘C copies it and ⌘X cuts it, to paste into a table, a text box or another app.
    <figure className={`subject-image${dragHandle ? " on-board" : ""}`} tabIndex={-1} onPointerDown={dragHandle}
      onKeyDown={(e) => {
        const key = e.key.toLowerCase();
        if (!src || !(e.metaKey || e.ctrlKey) || (key !== "c" && key !== "x")) return;
        if ((e.target as HTMLElement).closest("input, textarea")) return;
        e.preventDefault();
        e.stopPropagation();
        void copyPicture(src).then((ok) => {
          if (!ok) return setNote("Couldn't copy the picture");
          if (key === "x" && onRemove) onRemove();
          else { setNote("Picture copied"); setTimeout(() => setNote(null), 1400); }
        });
      }}
      onClick={(e) => (e.target as HTMLElement).tagName === "IMG" && (e.currentTarget as HTMLElement).focus()}>
      {note && <span className="rt-img-copied">{note}</span>}
      {src ? (
        // In the document the picture itself is dragged into writing; on the whiteboard the card is.
        // eslint-disable-next-line @next/next/no-img-element
        <img src={src} alt={box.caption || ""} draggable={!dragHandle}
          onDragStart={(event) => {
            event.dataTransfer.setData(EMBED_TYPE, box.id);
            event.dataTransfer.effectAllowed = "move";
          }} />
      ) : (
        <p className="sub">This picture is kept on the device it was added from.</p>
      )}
      {showCaption && (
        <input
          ref={caption}
          className="subject-image-caption"
          placeholder="Add a caption…"
          defaultValue={box.caption ?? ""}
          onPointerDown={(e) => e.stopPropagation()}
          onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
          onBlur={(e) => {
            if (e.target.value !== (box.caption ?? "")) onChange({ caption: e.target.value.slice(0, 300) });
            if (!e.target.value.trim()) setCaptioning(false);
          }}
        />
      )}
    </figure>
  );
}

/**
 * A picture made small enough to keep: at most 1400px on its long side, as a
 * JPEG (or PNG where it has transparency worth keeping), so a phone photo
 * of several megabytes becomes a couple of hundred kilobytes.
 */
export async function shrinkImage(file: File, max = 1400): Promise<string> {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error("That file isn't a picture this browser can open."));
      el.src = url;
    });
    const scale = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(img.naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(img.naturalHeight * scale));
    const ctx = canvas.getContext("2d")!;
    const png = file.type === "image/png" && file.size < 400_000;
    if (!png) {
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
    }
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    return png ? canvas.toDataURL("image/png") : canvas.toDataURL("image/jpeg", 0.8);
  } finally {
    URL.revokeObjectURL(url);
  }
}

export type { Stroke };

export { TableBox } from "./TableBox";

const SPEAKER_COLORS = ["#2563eb", "#c2410c", "#15803d", "#7c3aed", "#be185d", "#0e7490"];

/**
 * An interview transcript: a scrolling box of who said what. Drop a file on
 * it or paste the text; Riverside, Otter, Zoom and "Name: text" exports are
 * split into speakers. The magnifying glass searches within.
 */
/* ---------- highlights in a transcript ---------- */

type Registry = Map<string, unknown> | undefined;
/** Every transcript's highlighted ranges, painted through two shared CSS highlights. */
const painted = new Map<string, { plain: Range[]; noted: Range[] }>();
function repaint() {
  const registry = (globalThis.CSS as unknown as { highlights?: Registry } | undefined)?.highlights;
  const Ctor = (globalThis as unknown as { Highlight?: new (...r: Range[]) => unknown }).Highlight;
  if (!registry || !Ctor) return;
  const all = [...painted.values()];
  registry.set("transcript-mark", new Ctor(...all.flatMap((x) => x.plain)));
  registry.set("transcript-mark-noted", new Ctor(...all.flatMap((x) => x.noted)));
}

/** The DOM spot for a transcript point: inside paragraph `t:p`, `o` characters in. */
function domAt(host: HTMLElement, pt: TPoint): { node: Node; offset: number } | null {
  const para = host.querySelector(`[data-tp="${pt.t}:${pt.p}"]`);
  if (!para) return null;
  const walker = document.createTreeWalker(para, NodeFilter.SHOW_TEXT);
  let left = pt.o;
  let last: Text | null = null;
  for (let n = walker.nextNode() as Text | null; n; n = walker.nextNode() as Text | null) {
    if (left <= n.length) return { node: n, offset: left };
    left -= n.length;
    last = n;
  }
  return last ? { node: last, offset: last.length } : { node: para, offset: 0 };
}

/** The transcript point for a DOM spot, if it is in a paragraph of this transcript. */
function pointAt(node: Node, offset: number): TPoint | null {
  const el = node.nodeType === Node.ELEMENT_NODE ? (node as Element) : node.parentElement;
  const para = el?.closest<HTMLElement>("[data-tp]");
  if (!para) return null;
  const [t, p] = para.dataset.tp!.split(":").map(Number);
  const range = document.createRange();
  range.setStart(para, 0);
  try {
    range.setEnd(node, offset);
  } catch {
    return null;
  }
  return { t, p, o: range.toString().length };
}

const before = (a: TPoint, b: TPoint) => a.t - b.t || a.p - b.p || a.o - b.o;

/** A passage the AI search found: a run of turns, and why it fits. */
export type AiMatch = { from: number; to: number; why: string };
export type AiSearch = (turns: { s?: string; t?: string; x: string }[], query: string) => Promise<AiMatch[]>;

/** A passage longer than this opens in the transcript rather than in its card. */
const LONG_QUOTE = 1500;

export function TranscriptBox({ box, onChange, onComment, aiSearch, flagWith }: {
  /** Who and what to name when an AI search result is flagged. */
  flagWith?: { subject: string; model: string };
  /** Search by meaning; absent where no AI is set up. */
  aiSearch?: AiSearch;
  box: BoxItem;
  onChange: (next: Partial<BoxItem>) => void;
  /** A comment made on a passage, as a line for the notes card beside the transcript. */
  onComment?: (itemHtml: string) => void;
}) {
  // One block can hold several transcripts — one per person — as tabs.
  const tabs = [box.transcript, ...(box.transcriptTabs ?? [])].map(safeTranscript);
  const [active, setActive] = useState(0);
  const tab = Math.min(active, tabs.length - 1);
  const { title, turns } = tabs[tab];
  const write = (next: Transcript[]) => onChange({ transcript: next[0], transcriptTabs: next.slice(1) });
  const writeTab = (t: Transcript) => write(tabs.map((x, j) => (j === tab ? t : x)));
  const speakers = speakersOf(turns);
  const [searching, setSearching] = useState(false);
  const [query, setQuery] = useState("");
  /** Search by meaning instead of by the letters typed. */
  const [aiMode, setAiMode] = useState(false);
  const [ai, setAi] = useState<{ state: "running" | "done" | "error"; query: string; matches: AiMatch[]; message?: string; shown: boolean } | null>(null);
  const [opened, setOpened] = useState<Set<number>>(new Set());
  const [hit, setHit] = useState(0);
  const [dragging, setDragging] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const scroller = useRef<HTMLDivElement | null>(null);

  const load = (text: string, name?: string) => {
    const next = parseTranscript(text);
    if (next.length === 0) return setProblem("There was no text in that.");
    setProblem(null);
    writeTab({ title: title || (name ? titleFromFile(name) : ""), turns: next }); // new text: old highlights no longer line up
  };
  const readFile = async (file: File) => {
    if (!/^text\/|\/(json|x-subrip)$/.test(file.type) && !/\.(txt|vtt|srt|md|text)$/i.test(file.name))
      return setProblem("That file isn't plain text — export the transcript as .txt, .vtt or .srt.");
    if (file.size > 2_000_000) return setProblem("That file is too large for a transcript.");
    load(await file.text(), file.name);
  };

  // Spaces count: " meth" finds a word starting "meth", not "something".
  const needle = !aiMode && query.trim() ? query.toLowerCase() : "";
  const pattern = needle ? new RegExp(needle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "gi") : null;
  const total = pattern ? turns.reduce((n, t) => n + (t.x.match(pattern)?.length ?? 0) + (t.s?.match(pattern)?.length ?? 0), 0) : 0;
  const current = total ? ((hit % total) + total) % total : 0;

  // Keep the current match in view, inside the box — never scrolling the page.
  useEffect(() => {
    const host = scroller.current;
    const mark = host?.querySelector<HTMLElement>("mark.on");
    if (!host || !mark) return;
    const top = mark.getBoundingClientRect().top - host.getBoundingClientRect().top + host.scrollTop;
    host.scrollTo({ top: top - host.clientHeight / 3, behavior: "smooth" });
  }, [current, needle]);

  let seen = 0;
  const marked = (text: string) => {
    if (!pattern) return text;
    const out: React.ReactNode[] = [];
    let last = 0;
    for (const m of text.matchAll(pattern)) {
      out.push(text.slice(last, m.index));
      const n = seen++;
      out.push(<mark key={m.index} className={n === current ? "on" : undefined}>{m[0]}</mark>);
      last = m.index! + m[0].length;
    }
    out.push(text.slice(last));
    return out;
  };
  const colorOf = (s?: string) => (s ? SPEAKER_COLORS[speakers.indexOf(s) % SPEAKER_COLORS.length] : undefined);

  /** Ask the AI for passages that fit the description, and show them in place of the transcript. */
  async function runAi() {
    const q = query.trim();
    if (!q || !aiSearch || ai?.state === "running") {
      if (!aiSearch) setAi({ state: "error", query: q, matches: [], message: "Search by meaning needs an AI key — add one in Settings → API keys.", shown: true });
      return;
    }
    setOpened(new Set());
    setAi({ state: "running", query: q, matches: [], shown: true });
    try {
      const matches = await aiSearch(turns, q);
      setAi({ state: "done", query: q, matches, shown: true });
    } catch (error) {
      setAi({ state: "error", query: q, matches: [], message: error instanceof Error ? error.message : "The search failed.", shown: true });
    }
  }

  /** Back to the transcript, at the passage, which flashes so the eye finds it. */
  function goToTurn(t: number) {
    if (ai) setAi({ ...ai, shown: false });
    setTimeout(() => {
      const host = scroller.current;
      const para = host?.querySelector<HTMLElement>(`[data-tp="${t}:0"]`);
      const turnEl = para?.closest<HTMLElement>(".transcript-turn");
      if (!host || !turnEl) return;
      host.scrollTo({ top: turnEl.offsetTop - host.offsetTop - 12, behavior: "smooth" });
      turnEl.classList.remove("flash");
      void turnEl.offsetWidth;
      turnEl.classList.add("flash");
    }, 30);
  }

  /* Highlights and comments, kept with the transcript they mark. */
  const marks = tabs[tab].marks ?? [];
  const setMarks = (next: TMark[]) => writeTab({ ...tabs[tab], marks: next });
  const [pop, setPop] = useState<{ left: number; top: number; quote?: string; from?: TPoint; to?: TPoint; mark?: TMark; writing?: string } | null>(null);
  const shell = useRef<HTMLDivElement | null>(null);

  // Paint the highlights over the text whenever it is drawn.
  useEffect(() => {
    const host = scroller.current;
    const key = box.id;
    if (!host) { painted.delete(key); repaint(); return; }
    const plain: Range[] = [];
    const noted: Range[] = [];
    for (const m of marks) {
      const a = domAt(host, m.from);
      const b = domAt(host, m.to);
      if (!a || !b) continue;
      try {
        const r = document.createRange();
        r.setStart(a.node, a.offset);
        r.setEnd(b.node, b.offset);
        (m.comment ? noted : plain).push(r);
      } catch { /* the text changed under it */ }
    }
    painted.set(key, { plain, noted });
    repaint();
    return () => { painted.delete(key); repaint(); };
  });

  // A press anywhere else puts the popover away.
  useEffect(() => {
    if (!pop) return;
    const away = (e: PointerEvent) => !(e.target as Element | null)?.closest?.(".transcript-pop, .transcript-body") && setPop(null);
    window.addEventListener("pointerdown", away, true);
    return () => window.removeEventListener("pointerdown", away, true);
  }, [pop]);

  /** Where on the transcript a screen rectangle is, for the popover (the board may be zoomed). */
  const placeOf = (rect: DOMRect) => {
    const host = shell.current!;
    const h = host.getBoundingClientRect();
    const scale = h.width / (host.offsetWidth || 1) || 1;
    return { left: Math.max(0, Math.min(host.offsetWidth - 240, (rect.left - h.left) / scale)), top: (rect.bottom - h.top) / scale + 6 };
  };

  /** A selection becomes a choice of highlight or comment; a click on a highlight offers to take it off. */
  function pickPassage() {
    const sel = window.getSelection();
    const host = scroller.current;
    if (!sel || !host || sel.rangeCount === 0) return;
    const range = sel.getRangeAt(0);
    if (!host.contains(range.commonAncestorContainer)) return;
    if (sel.isCollapsed) {
      const here = pointAt(range.startContainer, range.startOffset);
      const hit = here && marks.find((m) => before(m.from, here) <= 0 && before(here, m.to) <= 0);
      setPop(hit ? { ...placeOf(range.getBoundingClientRect()), mark: hit } : null);
      return;
    }
    const from = pointAt(range.startContainer, range.startOffset);
    const to = pointAt(range.endContainer, range.endOffset);
    if (!from || !to || before(from, to) >= 0) return;
    setPop({ ...placeOf(range.getBoundingClientRect()), from, to, quote: range.toString().trim() });
  }

  function saveMark(comment?: string) {
    if (!pop?.from || !pop.to) return;
    const text = comment?.trim();
    const mark: TMark = { id: newItemId("tm"), from: pop.from, to: pop.to, ...(text ? { comment: text } : {}) };
    setMarks([...marks, mark]);
    if (text && onComment) {
      const quote = pop.quote ?? "";
      const turn = turns[pop.from.t];
      const who = [turn?.s, turn?.t].filter(Boolean).join(", ");
      onComment(`<i>“${escapeHtml(quote.slice(0, 600))}”</i>${who ? ` (${escapeHtml(who)})` : ""} — ${escapeHtml(text)}`);
    }
    window.getSelection()?.removeAllRanges();
    setPop(null);
  }

  const drop = {
    onDragOver: (e: React.DragEvent) => {
      if (!e.dataTransfer.types.includes("Files")) return;
      e.preventDefault();
      e.stopPropagation();
      setDragging(true);
    },
    onDragLeave: () => setDragging(false),
    onDrop: (e: React.DragEvent) => {
      const file = e.dataTransfer.files[0];
      setDragging(false);
      if (!file) return;
      e.preventDefault();
      e.stopPropagation();
      if (turns.length && !window.confirm("Replace this transcript with the file?")) return;
      void readFile(file);
    },
  };

  return (
    <div ref={shell} tabIndex={-1} className={`transcript${dragging ? " dragging" : ""}`} onPointerDown={(e) => e.stopPropagation()} {...drop}
      // ⌘F / Ctrl+F after clicking in a transcript searches the transcript, not the page.
      onKeyDown={(e) => {
        if ((e.metaKey || e.ctrlKey) && !e.altKey && e.key.toLowerCase() === "f" && turns.length > 0) {
          e.preventDefault();
          e.stopPropagation();
          setSearching(true);
          setTimeout(() => {
            const input = shell.current?.querySelector<HTMLInputElement>(".transcript-find input");
            input?.focus();
            input?.select();
          }, 0);
        }
      }}>
      <div className="transcript-head">
        <span className="transcript-kind">Transcript</span>
        <input
          className="transcript-title"
          placeholder="Interview with…"
          key={tab}
          defaultValue={title}
          onBlur={(e) => e.target.value !== title && writeTab({ ...tabs[tab], title: e.target.value.slice(0, 200) })}
        />
        {turns.length > 0 && (
          <button className={`transcript-search-btn${searching ? " on" : ""}`} title="Search this transcript" aria-label="Search this transcript"
            onClick={() => { setSearching((v) => !v); if (searching) setQuery(""); }}>
            <svg viewBox="0 0 24 24" width="15" height="15" aria-hidden="true">
              <circle cx="10.5" cy="10.5" r="6" fill="none" stroke="currentColor" strokeWidth="2" />
              <path d="M15 15l5 5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            </svg>
          </button>
        )}
      </div>
      <div className="transcript-tabs" role="tablist">
        {tabs.map((t, j) => (
          <button key={j} role="tab" aria-selected={j === tab} className={`transcript-tab${j === tab ? " on" : ""}`}
            onClick={() => { setActive(j); setQuery(""); setHit(0); }}>
            {t.title || `Transcript ${j + 1}`}
            {j === tab && tabs.length > 1 && (
              <span className="transcript-tab-x" role="button" aria-label="Remove this transcript" title="Remove this transcript"
                onClick={(e) => {
                  e.stopPropagation();
                  if (t.turns.length && !window.confirm(`Remove “${t.title || `Transcript ${j + 1}`}” from this block?`)) return;
                  write(tabs.filter((_, k) => k !== j));
                  setActive(Math.max(0, j - 1));
                }}>×</span>
            )}
          </button>
        ))}
        <button className="transcript-tab add" title="Add another transcript to this block" aria-label="Add another transcript"
          onClick={() => { write([...tabs, { title: "", turns: [] }]); setActive(tabs.length); setQuery(""); }}>+</button>
      </div>
      {speakers.length > 0 && (
        <SpeakerNames speakers={speakers} colorOf={colorOf}
          onRename={(from, to) => writeTab({ ...tabs[tab], turns: turns.map((t) => (t.s === from ? { ...t, s: to } : t)) })} />
      )}
      {searching && (
        <div className="transcript-find">
          <button className={`transcript-ai-toggle${aiMode ? " on" : ""}`} aria-pressed={aiMode}
            title={aiMode ? "Searching by meaning — click to search for exact words" : "Search by meaning, with AI"}
            onClick={() => { setAiMode((v) => !v); setHit(0); }}>✦ AI</button>
          <input
            autoFocus
            placeholder={aiMode ? "Describe what to find… e.g. where they declined to answer" : "Find in transcript"}
            value={query}
            onChange={(e) => { setQuery(e.target.value); setHit(0); }}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                if (aiMode) void runAi();
                else setHit((h) => h + (e.shiftKey ? -1 : 1));
              }
              if (e.key === "Escape") { setSearching(false); setQuery(""); }
            }}
          />
          {aiMode ? (
            <>
              {ai && !ai.shown && ai.state === "done" && (
                <button className="transcript-ai-back" onClick={() => setAi({ ...ai, shown: true })}>Results ({ai.matches.length})</button>
              )}
              <button className="transcript-ai-go" disabled={!query.trim() || ai?.state === "running"} onClick={() => void runAi()}>Search</button>
            </>
          ) : (
            <>
              <span className="transcript-count">{needle ? (total ? `${current + 1} of ${total}` : "No matches") : ""}</span>
              <button disabled={!total} aria-label="Previous match" onClick={() => setHit((h) => h - 1)}>↑</button>
              <button disabled={!total} aria-label="Next match" onClick={() => setHit((h) => h + 1)}>↓</button>
            </>
          )}
        </div>
      )}
      {turns.length === 0 ? (
        <div className="transcript-empty">
          <p>Drop a transcript file here (.txt, .vtt, .srt) or paste the text — speakers are separated automatically.</p>
          <textarea
            placeholder="Paste a transcript…"
            rows={4}
            onPaste={(e) => {
              const text = e.clipboardData.getData("text/plain");
              if (!text.trim()) return;
              e.preventDefault();
              load(text);
            }}
            onBlur={(e) => e.target.value.trim() && load(e.target.value)}
          />
          <label className="link-btn transcript-pick">
            Choose a file…
            <input type="file" accept=".txt,.vtt,.srt,.md,text/plain" hidden
              onChange={(e) => { const f = e.target.files?.[0]; if (f) void readFile(f); e.target.value = ""; }} />
          </label>
        </div>
      ) : (
        ai?.shown ? (
          <div className="transcript-results" onWheel={(e) => e.stopPropagation()}>
            <div className="transcript-results-head">
              <button className="link-btn" onClick={() => setAi({ ...ai, shown: false })}>← Transcript</button>
              <span>
                {ai.state === "running" ? <>Reading the transcript for “{ai.query}”…</>
                  : ai.state === "error" ? ai.message
                  : ai.matches.length ? <>✦ {ai.matches.length} passage{ai.matches.length === 1 ? "" : "s"} for “{ai.query}”</>
                  : <>Nothing in this transcript fits “{ai.query}”.</>}
              </span>
            </div>
            {ai.state === "running" && [0, 1, 2].map((i) => <div key={i} className="transcript-result skeleton" style={{ animationDelay: `${i * 120}ms` }} />)}
            {ai.state === "done" && ai.matches.map((m, i) => {
              const run = turns.slice(m.from, m.to + 1);
              const first = run[0];
              if (!first) return null;
              const firstPara = first.x.split("\n\n")[0];
              const whole = run.reduce((n, t) => n + t.x.length, 0);
              const more = run.length > 1 || first.x.length > firstPara.length;
              const isOpen = opened.has(i);
              return (
                <div key={`${m.from}-${m.to}`} className="transcript-result" style={{ animationDelay: `${i * 70}ms` }}>
                  <div className="transcript-who">
                    {first.s && <b style={{ color: colorOf(first.s) }}>{first.s}</b>}
                    {first.t && <span className="transcript-time">{first.t}</span>}
                  </div>
                  {isOpen ? (
                    run.map((t, k) => (
                      <div key={k} className="transcript-result-turn">
                        {k > 0 && t.s && <b style={{ color: colorOf(t.s) }}>{t.s} </b>}
                        {t.x.split("\n\n").map((para, j) => <p key={j}>{para}</p>)}
                      </div>
                    ))
                  ) : (
                    <p className="transcript-result-text">{firstPara}{more ? " …" : ""}</p>
                  )}
                  <p className="transcript-result-why">
                    {m.why}
                    <FlagButton make={() => ({
                      kind: "transcript-search",
                      subject: flagWith?.subject,
                      model: flagWith?.model,
                      output: m.why,
                      context: [
                        { label: "Search", text: ai.query },
                        { label: "Transcript", text: title || `Transcript ${tab + 1}` },
                        { label: "Passage", text: run.map((t) => `${t.s ? `${t.s}${t.t ? ` (${t.t})` : ""}: ` : ""}${t.x}`).join("\n") },
                      ],
                    })} />
                  </p>
                  <div className="transcript-result-tools">
                    {more && whole <= LONG_QUOTE && (
                      <button className="link-btn" onClick={() => setOpened((o) => { const n = new Set(o); if (n.has(i)) n.delete(i); else n.add(i); return n; })}>
                        {isOpen ? "Show less" : "Show whole quote"}
                      </button>
                    )}
                    <button className="link-btn" onClick={() => goToTurn(m.from)}>
                      {more && whole > LONG_QUOTE ? "Read the whole quote in the transcript →" : "Go to it in the transcript →"}
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
        <div className="transcript-body" ref={scroller} onWheel={(e) => e.stopPropagation()} onMouseUp={pickPassage}
          onKeyUp={(e) => e.shiftKey && pickPassage()}>
          {turns.map((turn, i) => {
            const same = i > 0 && turns[i - 1].s === turn.s;
            return (
              <div key={i} className={`transcript-turn${same ? " cont" : ""}`}>
                {(!same || turn.t) && (
                  <div className="transcript-who">
                    {!same && turn.s && <b style={{ color: colorOf(turn.s) }}>{marked(turn.s)}</b>}
                    {turn.t && <span className="transcript-time">{turn.t}</span>}
                  </div>
                )}
                {turn.x.split("\n\n").map((para, j) => <p key={j} data-tp={`${i}:${j}`}>{marked(para)}</p>)}
              </div>
            );
          })}
        </div>
        )
      )}
      {pop && (
        <div className="transcript-pop" style={{ left: pop.left, top: pop.top }} onMouseDown={(e) => e.target instanceof HTMLTextAreaElement || e.preventDefault()}>
          {pop.mark ? (
            <>
              {pop.mark.comment && <p className="transcript-pop-note">{pop.mark.comment}</p>}
              <button onClick={() => { setMarks(marks.filter((m) => m.id !== pop.mark!.id)); setPop(null); }}>Remove highlight</button>
            </>
          ) : pop.writing !== undefined ? (
            <form onSubmit={(e) => { e.preventDefault(); saveMark(pop.writing ?? ""); }}>
              <textarea autoFocus rows={3} placeholder="Comment… (added to the notes beside this transcript)" value={pop.writing}
                onChange={(e) => setPop({ ...pop, writing: e.target.value })}
                onKeyDown={(e) => {
                  e.stopPropagation();
                  if (e.key === "Enter" && (e.metaKey || e.ctrlKey || !e.shiftKey)) { e.preventDefault(); saveMark(pop.writing ?? ""); }
                  if (e.key === "Escape") setPop(null);
                }} />
              <div className="transcript-pop-row">
                <button type="button" onClick={() => setPop(null)}>Cancel</button>
                <button type="submit" className="on">Comment</button>
              </div>
            </form>
          ) : (
            <>
              <button onClick={() => saveMark()}>Highlight</button>
              <button onClick={() => setPop({ ...pop, writing: "" })}>Comment</button>
            </>
          )}
        </div>
      )}
      {problem && <p className="transcript-problem">{problem}</p>}
      {turns.length > 0 && (
        <div className="transcript-foot">
          <span>{speakers.length > 0 ? speakers.join(" · ") : "One speaker"} · {turns.length} turns</span>
          <label className="link-btn">
            Replace…
            <input type="file" accept=".txt,.vtt,.srt,.md,text/plain" hidden
              onChange={(e) => { const f = e.target.files?.[0]; if (f) void readFile(f); e.target.value = ""; }} />
          </label>
        </div>
      )}
    </div>
  );
}

/**
 * Who speaks, once, at the top: renaming "Speaker 3" here renames them on
 * every line they speak. Giving two speakers the same name makes them one.
 */
function SpeakerNames({ speakers, colorOf, onRename }: {
  speakers: string[];
  colorOf: (s?: string) => string | undefined;
  onRename: (from: string, to: string) => void;
}) {
  const [editing, setEditing] = useState<{ name: string; draft: string } | null>(null);
  const finish = () => {
    if (!editing) return;
    const to = editing.draft.replace(/\s+/g, " ").trim().slice(0, 80);
    if (to && to !== editing.name) onRename(editing.name, to);
    setEditing(null);
  };
  return (
    <div className="transcript-speakers" onPointerDown={(e) => e.stopPropagation()}>
      <span className="transcript-speakers-label">Speakers</span>
      {speakers.map((name) =>
        editing?.name === name ? (
          <input key={name} className="transcript-speaker-input" autoFocus aria-label={`Rename ${name}`}
            value={editing.draft}
            onFocus={(e) => e.currentTarget.select()}
            onChange={(e) => setEditing({ name, draft: e.target.value })}
            onKeyDown={(e) => {
              e.stopPropagation();
              if (e.key === "Enter") finish();
              if (e.key === "Escape") setEditing(null);
            }}
            onBlur={finish} />
        ) : (
          <button key={name} className="transcript-speaker" style={{ color: colorOf(name) }} title={`Rename ${name} everywhere they speak`}
            onClick={() => setEditing({ name, draft: name })}>
            {name}<span aria-hidden="true"> ✎</span>
          </button>
        ),
      )}
    </div>
  );
}
