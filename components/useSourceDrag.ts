"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Dragging a source from one feed to another.
 *
 * Pointer events rather than HTML5 drag-and-drop: dragstart/drop never fire on
 * iOS, and this app is used on a phone. Dragging begins from a grip rather than
 * anywhere on the row, so a touch that lands on the row still scrolls the
 * sidebar and a tap still selects the source — the grip carries
 * `touch-action: none`, which is what stops the browser claiming the gesture
 * before we do.
 */
export type SourceDrag = {
  sourceId: string;
  fromFeedId: string;
  title: string;
  favicon?: string;
  /** Where the pointer is, for the thing that follows it. */
  x: number;
  y: number;
  /** The feed under the pointer, if any. */
  overFeedId: string | null;
};

type Handle = { id: string; title: string; favicon?: string };

/** How close to an edge before the sidebar scrolls itself, and by how much. */
const EDGE = 56;
const STEP = 12;

export function useSourceDrag(
  onDrop: (sourceId: string, fromFeedId: string, toFeedId: string) => void,
) {
  const [drag, setDrag] = useState<SourceDrag | null>(null);
  // The handlers run from pointer events, which do not see fresh state.
  const current = useRef<SourceDrag | null>(null);

  const set = useCallback((next: SourceDrag | null) => {
    current.current = next;
    setDrag(next);
  }, []);

  /** The feed under the pointer — the ghost must not intercept its own hit. */
  const feedAt = (x: number, y: number) => {
    const el = document.elementFromPoint(x, y);
    return el?.closest<HTMLElement>("[data-feed-id]")?.dataset.feedId ?? null;
  };

  const autoScroll = (y: number) => {
    const scroller = document.querySelector<HTMLElement>(".sidebar-scroll");
    if (!scroller) return;
    const box = scroller.getBoundingClientRect();
    if (y < box.top + EDGE) scroller.scrollTop -= STEP;
    else if (y > box.bottom - EDGE) scroller.scrollTop += STEP;
  };

  const onPointerDown = useCallback(
    (event: React.PointerEvent, source: Handle, fromFeedId: string) => {
      // Left button or touch only; and keep the browser from starting its own
      // text selection or scroll with this gesture.
      if (event.button !== 0) return;
      event.preventDefault();
      event.stopPropagation();
      (event.currentTarget as Element).setPointerCapture(event.pointerId);
      set({
        sourceId: source.id,
        fromFeedId,
        title: source.title,
        favicon: source.favicon,
        x: event.clientX,
        y: event.clientY,
        overFeedId: fromFeedId,
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
        overFeedId: feedAt(event.clientX, event.clientY),
      });
    },
    [set],
  );

  const finish = useCallback(
    (commit: boolean) => {
      const active = current.current;
      set(null);
      if (!active || !commit) return;
      const { sourceId, fromFeedId, overFeedId } = active;
      if (overFeedId && overFeedId !== fromFeedId) {
        onDrop(sourceId, fromFeedId, overFeedId);
      }
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
