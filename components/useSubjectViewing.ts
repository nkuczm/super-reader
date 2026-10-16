"use client";

import { useEffect } from "react";
import { lookingAtPage, markViewed } from "@/lib/subject-seen";

/** How often a subject being looked at is marked again, so its time is the last moment it was on screen. */
const BEAT_MS = 60_000;

/**
 * Marks a subject viewed for as long as it is open and being looked at:
 * when it opens, when the reader comes back to its tab or window, once a
 * minute while they stay, and when they leave it or look away. Opened in a
 * tab in the background — a page restored where it was — it is not marked
 * until that tab is looked at.
 */
export function useSubjectViewing(subjectId: string) {
  useEffect(() => {
    let looking = lookingAtPage();
    if (looking) markViewed(subjectId);
    // Starting to look, or stopping: either way, this is when it was last seen.
    const check = () => {
      const now = lookingAtPage();
      if (now || looking) markViewed(subjectId);
      looking = now;
    };
    const beat = window.setInterval(() => {
      if (lookingAtPage()) markViewed(subjectId);
    }, BEAT_MS);
    document.addEventListener("visibilitychange", check);
    window.addEventListener("focus", check);
    window.addEventListener("blur", check);
    window.addEventListener("pagehide", check);
    return () => {
      if (lookingAtPage()) markViewed(subjectId);
      window.clearInterval(beat);
      document.removeEventListener("visibilitychange", check);
      window.removeEventListener("focus", check);
      window.removeEventListener("blur", check);
      window.removeEventListener("pagehide", check);
    };
  }, [subjectId]);
}
