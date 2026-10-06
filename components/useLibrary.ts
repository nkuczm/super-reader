"use client";

/**
 * Keeping the account's library (lib/library.ts) in step with this device:
 * every bookmark, pasted story and highlight, with no cap. Signed in, a
 * device first reads what changed since it last looked, merges it in, and
 * then sends what the account does not yet hold — so a browser whose data
 * was cleared gets everything back on signing in, and sends nothing it did
 * not add. What the account is known to hold is remembered on the device, so
 * a reload asks only for what is new.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { itemBatches, itemId, itemsOf, libraryDelta, libraryOf, type Library, type LibraryBase, type LibraryItem } from "@/lib/library";

const STATE_KEY = "super-reader:library:v1";
const PUSH_DELAY_MS = 2000;
/** Coming back to the tab looks for other devices' changes at most this often. */
const LOOK_EVERY_MS = 3 * 60 * 1000;

type Held = { account: string; cursor: string | null; base: LibraryBase };

function loadHeld(account: string): Held {
  try {
    const parsed = JSON.parse(localStorage.getItem(STATE_KEY) ?? "null");
    if (parsed && parsed.account === account && parsed.base && typeof parsed.base === "object") {
      return { account, cursor: typeof parsed.cursor === "string" ? parsed.cursor : null, base: parsed.base };
    }
  } catch {
    /* start afresh */
  }
  return { account, cursor: null, base: {} };
}

function saveHeld(held: Held) {
  try {
    localStorage.setItem(STATE_KEY, JSON.stringify(held));
  } catch {
    /* the next visit reads everything again, and sends nothing twice */
  }
}

export function useLibrary(params: { account: string | null; library: Library; apply: (library: Library) => void }) {
  const { account, library, apply } = params;
  const held = useRef<Held | null>(null);
  const libraryRef = useRef(library);
  libraryRef.current = library;
  const applyRef = useRef(apply);
  applyRef.current = apply;
  const looked = useRef(false);
  const lastLook = useRef(0);
  const queue = useRef<Promise<void>>(Promise.resolve());
  const failures = useRef(0);
  const retry = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState<"idle" | "working" | "saved" | "error">("idle");

  const pull = useCallback(async (h: Held) => {
    let cursor = h.cursor;
    const got: LibraryItem[] = [];
    for (let page = 0; page < 500; page++) {
      const res = await fetch(`/api/library${cursor ? `?since=${encodeURIComponent(cursor)}` : ""}`, { cache: "no-store" });
      if (!res.ok) throw new Error("Could not read the library");
      const data = await res.json();
      got.push(...((data.items ?? []) as LibraryItem[]));
      cursor = data.cursor ?? cursor;
      if (!data.more) break;
    }
    if (got.length) applyRef.current(libraryOf(got));
    for (const item of got) h.base[itemId(item)] = Math.max(h.base[itemId(item)] ?? 0, item.at);
    h.cursor = cursor;
    saveHeld(h);
    lastLook.current = Date.now();
    looked.current = true;
  }, []);

  const push = useCallback(async (h: Held) => {
    const change = libraryDelta(itemsOf(libraryRef.current), h.base);
    for (const batch of itemBatches(change)) {
      const res = await fetch("/api/library", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ items: batch }),
      });
      if (!res.ok) throw new Error("Could not save to the library");
      for (const item of batch) h.base[itemId(item)] = Math.max(h.base[itemId(item)] ?? 0, item.at);
      saveHeld(h);
    }
  }, []);

  /** One at a time: read first (always, the first time), then send. A failure tries again, more slowly each time. */
  const run = useCallback(
    (read: boolean) => {
      queue.current = queue.current.then(async () => {
        const h = held.current;
        if (!h) return;
        setState("working");
        try {
          if (read || !looked.current) await pull(h);
          await push(h);
          failures.current = 0;
          setState("saved");
        } catch {
          setState("error");
          if (retry.current) clearTimeout(retry.current);
          const delay = Math.min(5 * 60_000, 15_000 * 2 ** failures.current);
          failures.current += 1;
          retry.current = setTimeout(() => setAttempt((n) => n + 1), delay);
        }
      });
      return queue.current;
    },
    [pull, push],
  );

  // Signing in (or a retry): read what changed, then send what is missing.
  useEffect(() => {
    if (!account) {
      held.current = null;
      looked.current = false;
      return;
    }
    if (held.current?.account !== account) {
      held.current = loadHeld(account);
      looked.current = false;
    }
    void run(true);
  }, [account, attempt, run]);

  // A change here goes a moment later.
  useEffect(() => {
    if (!account || !looked.current) return;
    const timer = setTimeout(() => void run(false), PUSH_DELAY_MS);
    return () => clearTimeout(timer);
  }, [account, library, run]);

  // Another device's changes, on coming back to the tab or back online.
  useEffect(() => {
    if (!account) return;
    const onFocus = () => {
      if (Date.now() - lastLook.current > LOOK_EVERY_MS) void run(true);
    };
    const onOnline = () => void run(true);
    window.addEventListener("focus", onFocus);
    window.addEventListener("online", onOnline);
    return () => {
      window.removeEventListener("focus", onFocus);
      window.removeEventListener("online", onOnline);
      if (retry.current) clearTimeout(retry.current);
    };
  }, [account, run]);

  return { state };
}
