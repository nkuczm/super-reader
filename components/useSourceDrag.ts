"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Dragging a source up, down, or into another feed — and dragging a whole
 * feed up or down the sidebar.
 *
 * Pointer events rather than HTML5 drag-and-drop: dragstart/drop never fire on
 * iOS, and this app is used on a phone. Dragging begins from a grip rather than
 * anywhere on the row, so a touch that lands on the row still scrolls the
 * sidebar and a tap still selects the source — the grip carries
 * `touch-action: none`, which is what stops the browser claiming the gesture
 * before we do.
 */
export type SourceDrag = {
  /** A source, or (with kind "feed") a whole feed, whose id is in sourceId. */
  kind: "source" | "feed";
  sourceId: string;
  fromFeedId: string;
  title: string;
  favicon?: string;
  /** Where the pointer is, for the thing that follows it. */
  x: number;
  y: number;
  /** The feed under the pointer, if any. */
  overFeedId: string | null;
  /** The source row under the pointer (source drags), if any. */
  overSourceId: string | null;
  /** Whether the drop lands after what is under the pointer, not before it. */
  after: boolean;
};

export type DropAt = { kind: "source" | "feed"; id: string; fromFeedId: string; toFeedId: string; targetSourceId: string | null; after: boolean };

type Handle = { id: string; title: string; favicon?: string };

/** How close to an edge before the sidebar scrolls itself, and by how much. */
const EDGE = 56;
const STEP = 12;

export function useSourceDrag(onDrop: (drop: DropAt) => void) {
  const [drag, setDrag] = useState<SourceDrag | null>(null);
  // The handlers run from pointer events, which do not see fresh state.
  const current = useRef<SourceDrag | null>(null);

  const set = useCallback((next: SourceDrag | null) => {
    current.current = next;
    setDrag(next);
  }, []);

  /** What is under the pointer — the ghost must not intercept its own hit. */
  const targetAt = (kind: SourceDrag["kind"], x: number, y: number) => {
    const el = document.elementFromPoint(x, y);
    const group = el?.closest<HTMLElement>("[data-feed-id]");
    const overFeedId = group?.dataset.feedId ?? null;
    if (kind === "feed") {
      const box = group?.querySelector<HTMLElement>(".feed-head")?.getBoundingClientRect() ?? group?.getBoundingClientRect();
      // Over a feed's own head, its top half puts the drop above it; anywhere in its sources, below.
      const after = box ? y > box.top + box.height / 2 : false;
      return { overFeedId, overSourceId: null, after };
    }
    const row = el?.closest<HTMLElement>("[data-source-id]");
    const box = row?.getBoundingClientRect();
    return { overFeedId, overSourceId: row?.dataset.sourceId ?? null, after: box ? y > box.top + box.height / 2 : false };
  };

  const autoScroll = (y: number) => {
    const scroller = document.querySelector<HTMLElement>(".sidebar-scroll");
    if (!scroller) return;
    const box = scroller.getBoundingClientRect();
    if (y < box.top + EDGE) scroller.scrollTop -= STEP;
    else if (y > box.bottom - EDGE) scroller.scrollTop += STEP;
  };

  const onPointerDown = useCallback(
    (event: React.PointerEvent, source: Handle, fromFeedId: string, kind: SourceDrag["kind"] = "source") => {
      // Left button or touch only; and keep the browser from starting its own
      // text selection or scroll with this gesture.
      if (event.button !== 0) return;
      event.preventDefault();
      event.stopPropagation();
      (event.currentTarget as Element).setPointerCapture(event.pointerId);
      set({
        kind,
        sourceId: source.id,
        fromFeedId,
        title: source.title,
        favicon: source.favicon,
        x: event.clientX,
        y: event.clientY,
        overFeedId: fromFeedId,
        overSourceId: null,
        after: false,
      });
    },
    [set],
  );

  const onPointerMove = useCallback(
    (event: React.PointerEvent) => {
      const active = current.current;
      if (!active) return;
      event.preventDefault();
      autoScroll(event.clientY);
      set({
        ...active,
        x: event.clientX,
        y: event.clientY,
        ...targetAt(active.kind, event.clientX, event.clientY),
      });
    },
    [set],
  );

  const finish = useCallback(
    (commit: boolean) => {
      const active = current.current;
      set(null);
      if (!active || !commit) return;
      const { kind, sourceId, fromFeedId, overFeedId, overSourceId, after } = active;
      if (!overFeedId) return;
      if (kind === "feed" && overFeedId === sourceId) return;
      if (kind === "source" && overFeedId === fromFeedId && (!overSourceId || overSourceId === sourceId)) return;
      onDrop({ kind, id: sourceId, fromFeedId, toFeedId: overFeedId, targetSourceId: overSourceId, after });
    },
    [onDrop, set],
  );

  const onPointerUp = useCallback(() => finish(true), [finish]);
  const onPointerCancel = useCallback(() => finish(false), [finish]);

  // A drag has to be abandonable without dropping something somewhere wrong.
  useEffect(() => {
    if (!drag) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") finish(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [drag, finish]);

  return { drag, onPointerDown, onPointerMove, onPointerUp, onPointerCancel };
}
