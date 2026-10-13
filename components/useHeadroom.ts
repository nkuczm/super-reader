"use client";

import { useEffect, useState, type RefObject } from "react";

/** How far a scroll has to run one way before the bar answers it, in pixels. */
const RUN = 10;

/**
 * A top bar that steps out of the way while a page is read downwards, and
 * comes back the moment it is scrolled up — as a phone's browser does with
 * its own bars — so getting out of an article or a subject is never a scroll
 * all the way back to the top.
 *
 * `bar` is the sticky element; it scrolls with the list's own column (.main).
 * Near the top it is always shown, and it stays while something in it has
 * focus or a menu of its is open (Safari does not focus a tapped button), so
 * a menu opened from it does not slide away under the finger. A run
 * of small scrolls counts as one: a slow drag upwards still brings it back.
 * The tuck itself is CSS (`.tucked`), so where it applies is up to each bar.
 */
export function useHeadroom(bar: RefObject<HTMLElement | null>, enabled = true): boolean {
  const [tucked, setTucked] = useState(false);
  useEffect(() => {
    const el = bar.current;
    const scroller = el?.closest<HTMLElement>(".main");
    if (!enabled || !el || !scroller) {
      setTucked(false);
      return;
    }
    let previous = scroller.scrollTop;
    let run = 0;
    let frame = 0;
    const settle = () => {
      frame = 0;
      const now = scroller.scrollTop;
      const moved = now - previous;
      previous = now;
      // One run is a scroll one way; turning round starts another.
      run = Math.sign(moved) === Math.sign(run) ? run + moved : moved;
      const inUse = el.matches(":focus-within") || el.querySelector('[aria-expanded="true"]');
      if (now <= el.offsetHeight || inUse) setTucked(false);
      else if (run > RUN) setTucked(true);
      else if (run < -RUN) setTucked(false);
    };
    const onScroll = () => {
      if (!frame) frame = requestAnimationFrame(settle);
    };
    scroller.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      scroller.removeEventListener("scroll", onScroll);
      cancelAnimationFrame(frame);
    };
  }, [bar, enabled]);
  return tucked;
}
