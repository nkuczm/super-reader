"use client";

/**
 * The Google account on the client: who is signed in, and keeping their
 * subjects saved to it.
 *
 * Writing is saved three times over. Every keystroke is already in this
 * device's storage; within a couple of seconds it is merged into the account
 * on the server (encrypted, with a version kept of every save); and a few
 * minutes after a change — or as soon as the tab is put away — the subjects
 * are rewritten as Google Docs in the person's own Drive.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import type { Note, NoteRemoval } from "@/lib/notes";
import type { Boards } from "@/lib/subjects";
import { delta, emptyBase, isEmpty, remember, withPictures, withRefs, type Base } from "@/lib/subject-sync";

export type AccountInfo = { id: string; email: string; name?: string; picture?: string };
export type Writing = { notes: Note[]; noteRemovals: NoteRemoval[]; boards: Boards };
export type SaveStatus = "idle" | "saving" | "saved" | "offline" | "error";

const SAVE_DELAY_MS = 1500;
/** Coming back to the tab looks for other devices' changes at most this often. */
const LOAD_EVERY_MS = 3 * 60 * 1000;
const BACKUP_DELAY_MS = 5 * 60 * 1000;

export function useAccount(params: {
  ready: boolean;
  syncCode: string | null;
  writing: Writing;
  /** Merge the account's copy into this device's. */
  applyWriting: (doc: Writing) => void;
  /** Follow a sync code (the account's), or start one when there is none. */
  adoptCode: (code: string | null) => Promise<string | null>;
}) {
  const { ready, syncCode, writing, applyWriting, adoptCode } = params;
  const [enabled, setEnabled] = useState(false);
  const [account, setAccount] = useState<AccountInfo | null>(null);
  const [checked, setChecked] = useState(false);
  const [status, setStatus] = useState<SaveStatus>("idle");
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [backedUpAt, setBackedUpAt] = useState<number | null>(null);
  const [backupProblem, setBackupProblem] = useState<string | null>(null);
  /** The account's copy has been read this session; saving may begin. */
  const loaded = useRef(false);
  /** Bumped to make the autosave look again without a new edit. */
  const [nudge, setNudge] = useState(0);
  /** What the account is known to hold, so only changes are sent. */
  const base = useRef<Base>(emptyBase());
  /** The last change read from the account: the next look asks only for what came after. */
  const cursor = useRef<string | null>(null);
  const lastLoad = useRef(0);
  /** Pictures the account is known to hold, by hash. */
  const onServer = useRef(new Set<string>());
  const writingRef = useRef(writing);
  writingRef.current = writing;
  const backupDue = useRef(false);
  const backupTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const applyRef = useRef(applyWriting);
  applyRef.current = applyWriting;
  const adoptRef = useRef(adoptCode);
  adoptRef.current = adoptCode;

  useEffect(() => {
    if (!ready) return;
    fetch("/api/auth/me", { cache: "no-store" })
      .then((res) => res.json())
      .then((data) => {
        setEnabled(Boolean(data.enabled));
        setAccount(data.account ?? null);
      })
      .catch(() => {})
      .finally(() => setChecked(true));
  }, [ready]);

  const fetchImages = useCallback(async (hashes: string[]) => {
    const res = await fetch(`/api/subjects/images?h=${hashes.join(",")}`, { cache: "no-store" });
    if (!res.ok) throw new Error("Could not load pictures");
    return ((await res.json()).images ?? {}) as Record<string, string>;
  }, []);

  /** Anything from the account that has pictures by reference: filled in, then merged into this device's copy. */
  const applyRemote = useCallback(
    async (doc: Writing) => {
      const full = await withPictures(doc, writingRef.current.boards, fetchImages, onServer.current);
      applyRef.current(full);
      return full;
    },
    [fetchImages],
  );

  /** Read what changed in the account since last time (all of it the first time), and merge it in. */
  const load = useCallback(async () => {
    lastLoad.current = Date.now();
    const since = cursor.current ? `?since=${encodeURIComponent(cursor.current)}` : "";
    const res = await fetch(`/api/subjects${since}`, { cache: "no-store" });
    if (res.status === 401) {
      setAccount(null);
      return;
    }
    if (!res.ok) throw new Error("Could not load subjects");
    const data = await res.json();
    const full = await applyRemote(data.doc);
    // The whole copy resets what the account is known to hold; changes add to it.
    if (data.full) base.current = emptyBase();
    remember(base.current, full);
    if (data.cursor) cursor.current = String(data.cursor);
    loaded.current = true;
    setNudge((n) => n + 1);
  }, [applyRemote]);

  // Once signed in: tie this device's sync code to the account, then read the
  // account's subjects. Again on focus, for changes made on another device.
  const linked = useRef(false);
  useEffect(() => {
    if (!ready || !account) return;
    let cancelled = false;
    const start = async () => {
      try {
        if (!linked.current) {
          const link = async (code: string | null) => {
            const res = await fetch("/api/account/link", {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({ code }),
            });
            return res.ok ? ((await res.json()).code as string | null) : null;
          };
          let code = await link(syncCode);
          if (!code) code = await link(await adoptRef.current(null));
          else if (code !== syncCode) await adoptRef.current(code);
          linked.current = true;
        }
        if (!cancelled) await load();
        // Once per visit, bring Drive up to date even if nothing is edited:
        // only subjects that differ from their last backup are uploaded.
        if (!cancelled) {
          backupDue.current = true;
          setTimeout(() => void backupRef.current(), 15_000);
        }
        if (!cancelled) setStatus("saved");
      } catch {
        if (!cancelled) setStatus(navigator.onLine ? "error" : "offline");
      }
    };
    start();
    // Another device's changes, on coming back to the tab — not more often than every few minutes.
    const onFocus = () => {
      if (Date.now() - lastLoad.current < LOAD_EVERY_MS) return;
      load().catch(() => {});
    };
    window.addEventListener("focus", onFocus);
    return () => {
      cancelled = true;
      window.removeEventListener("focus", onFocus);
    };
    // syncCode is read once when linking; following it would re-run the link.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, account, load]);

  const backup = useCallback(async () => {
    if (backupTimer.current) clearTimeout(backupTimer.current);
    backupTimer.current = null;
    if (!backupDue.current) return;
    backupDue.current = false;
    try {
      const res = await fetch("/api/subjects/backup", { method: "POST" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? "Backup to Google Docs failed");
      if (data.problem) throw new Error(data.problem);
      setBackupProblem(null);
      setBackedUpAt(Date.now());
    } catch (error) {
      backupDue.current = true;
      setBackupProblem(error instanceof Error ? error.message : "Backup to Google Docs failed");
    }
  }, []);

  const backupRef = useRef(backup);
  backupRef.current = backup;

  // Autosave: a burst of typing is one request, and only what changed goes.
  useEffect(() => {
    if (!account || !loaded.current) return;
    const change = delta(writing, base.current);
    if (isEmpty(change)) return;
    setStatus("saving");
    const timer = setTimeout(async () => {
      try {
        let { doc: body, sent } = await withRefs(change, onServer.current);
        let res = await fetch("/api/subjects", {
          method: "PUT",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
        });
        if (res.status === 409) {
          // The account lacks pictures this device thought it had: send them whole.
          const missing: string[] = (await res.json().catch(() => ({}))).missing ?? [];
          for (const h of missing) onServer.current.delete(h);
          ({ doc: body, sent } = await withRefs(change, onServer.current));
          res = await fetch("/api/subjects", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
        }
        if (res.status === 401) {
          setAccount(null);
          setStatus("error");
          return;
        }
        if (!res.ok) throw new Error("save failed");
        remember(base.current, change);
        for (const h of sent) onServer.current.add(h);
        setSavedAt(Date.now());
        setStatus("saved");
        backupDue.current = true;
        if (!backupTimer.current) backupTimer.current = setTimeout(backup, BACKUP_DELAY_MS);
      } catch {
        // Still safe on this device; the change stays unsent, and goes with the next try.
        setStatus(navigator.onLine ? "error" : "offline");
        setTimeout(() => setNudge((n) => n + 1), 30_000);
      }
    }, SAVE_DELAY_MS);
    return () => clearTimeout(timer);
  }, [account, writing, backup, nudge]);

  const flushNow = useCallback(async () => {
    if (!account || !loaded.current) return;
    const change = delta(writingRef.current, base.current);
    if (isEmpty(change)) return;
    try {
      const { doc: body, sent } = await withRefs(change, onServer.current);
      const text = JSON.stringify(body);
      const res = await fetch("/api/subjects", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: text,
        // Browsers carry a request past the page's end only up to 64 KB.
        keepalive: text.length < 60_000,
      });
      if (!res.ok) return;
      remember(base.current, change);
      for (const h of sent) onServer.current.add(h);
      setSavedAt(Date.now());
      setStatus("saved");
    } catch {
      /* the autosave, or the next visit, sends it */
    }
  }, [account]);

  // Putting the tab away is the moment work is most likely to be left: send
  // the backup then, in a request the browser finishes even as the page goes.
  useEffect(() => {
    if (!account) return;
    const onHide = () => {
      if (document.visibilityState !== "hidden") return;
      // Unsent changes go now, in a request the browser finishes even if the
      // tab is then closed — a moment after, once the last keystrokes are in.
      setTimeout(() => void flushNow(), 50);
      if (!backupDue.current) return;
      if (navigator.sendBeacon?.("/api/subjects/backup")) backupDue.current = false;
    };
    const onOnline = () => {
      load().catch(() => {});
    };
    document.addEventListener("visibilitychange", onHide);
    window.addEventListener("online", onOnline);
    return () => {
      document.removeEventListener("visibilitychange", onHide);
      window.removeEventListener("online", onOnline);
    };
  }, [account, load, flushNow]);

  const signOut = useCallback(async () => {
    await fetch("/api/auth/logout", { method: "POST" }).catch(() => {});
    loaded.current = false;
    linked.current = false;
    base.current = emptyBase();
    cursor.current = null;
    setAccount(null);
    setStatus("idle");
  }, []);

  const backupNow = useCallback(async () => {
    backupDue.current = true;
    await backup();
  }, [backup]);

  return { enabled, account, checked, status, savedAt, backedUpAt, backupProblem, signOut, backupNow, applyRemote };
}
