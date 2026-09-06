"use client";

import { useEffect, useRef, useState } from "react";

type Props = {
  state: "idle" | "working" | "done" | "error";
  done?: number;
  total?: number;
};

/**
 * How far the offline download has got, across the top of the screen.
 *
 * The download is a background chore that can run for a minute on a slow
 * connection — before this, the only sign it was happening was a count inside
 * Settings, so the app looked idle while it worked. The bar stays at 100% for
 * a moment after the last article lands rather than vanishing mid-stride,
 * which is the difference between "it finished" and "it stopped".
 */
export default function DownloadBar({ state, done = 0, total = 0 }: Props) {
  const [finishing, setFinishing] = useState(false);
  const wasWorking = useRef(false);

  useEffect(() => {
    if (state === "working") {
      wasWorking.current = true;
      setFinishing(false);
      return;
    }
    if (!wasWorking.current) return;
    wasWorking.current = false;
    setFinishing(true);
    const timer = setTimeout(() => setFinishing(false), 900);
    return () => clearTimeout(timer);
  }, [state]);

  const working = state === "working";
  if (!working && !finishing) return null;

  // Before the first article lands there is nothing to show but the track, so
  // start slightly filled rather than empty.
  const percent =
    finishing || total === 0 ? 100 : Math.max(2, Math.round((done / total) * 100));

  return (
    <div
      className={`download-bar${finishing ? " finishing" : ""}`}
      role="progressbar"
      aria-label="Downloading articles for offline reading"
      aria-valuemin={0}
      aria-valuemax={total || 100}
      aria-valuenow={finishing ? total || 100 : done}
      aria-valuetext={
        working && total > 0
          ? `${done} of ${total} articles saved for offline reading`
          : "Offline download finished"
      }
      title={
        working && total > 0
          ? `Saving articles for offline reading — ${done} of ${total}`
          : "Saved for offline reading"
      }
    >
      <span style={{ width: `${percent}%` }} />
    </div>
  );
}
