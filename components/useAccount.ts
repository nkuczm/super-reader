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

export type AccountInfo = { id: string; email: string; name?: string; picture?: string };
export type Writing = { notes: Note[]; noteRemovals: NoteRemoval[]; boards: Boards };
export type SaveStatus = "idle" | "saving" | "saved" | "offline" | "error";

const SAVE_DELAY_MS = 1500;
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
  /** The account's copy has been read this session; saving may begin. */
  const loaded = useRef(false);
  /** Bumped to make the autosave look again without a new edit. */
  const [nudge, setNudge] = useState(0);
  const lastSent = useRef("");
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

  const load = useCallback(async () => {
    const res = await fetch("/api/subjects", { cache: "no-store" });
    if (res.status === 401) {
      setAccount(null);
      return;
    }
    if (!res.ok) throw new Error("Could not load subjects");
    const data = await res.json();
    applyRef.current(data.doc);
    loaded.current = true;
    setNudge((n) => n + 1);
  }, []);

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
        if (!cancelled) setStatus("saved");
      } catch {
        if (!cancelled) setStatus(navigator.onLine ? "error" : "offline");
      }
    };
    start();
    const onFocus = () => {
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
      if (!res.ok) throw new Error("backup failed");
      setBackedUpAt(Date.now());
    } catch {
      backupDue.current = true;
    }
  }, []);

  // Autosave: a burst of typing is one request, and only real changes go.
  useEffect(() => {
    if (!account || !loaded.current) return;
    const body = JSON.stringify(writing);
    if (body === lastSent.current) return;
    setStatus("saving");
    const timer = setTimeout(async () => {
      try {
        const res = await fetch("/api/subjects", {
          method: "PUT",
          headers: { "content-type": "application/json" },
          body,
        });
        if (res.status === 401) {
          setAccount(null);
          setStatus("error");
          return;
        }
        if (!res.ok) throw new Error("save failed");
        const data = await res.json();
        lastSent.current = body;
        applyRef.current(data.doc);
        setSavedAt(Date.now());
        setStatus("saved");
        backupDue.current = true;
        if (!backupTimer.current) backupTimer.current = setTimeout(backup, BACKUP_DELAY_MS);
      } catch {
        // Still safe on this device; the next change or focus tries again.
        lastSent.current = "";
        setStatus(navigator.onLine ? "error" : "offline");
        setTimeout(() => setNudge((n) => n + 1), 30_000);
      }
    }, SAVE_DELAY_MS);
    return () => clearTimeout(timer);
  }, [account, writing, backup, nudge]);

  // Putting the tab away is the moment work is most likely to be left: send
  // the backup then, in a request the browser finishes even as the page goes.
  useEffect(() => {
    if (!account) return;
    const onHide = () => {
      if (document.visibilityState !== "hidden" || !backupDue.current) return;
      if (navigator.sendBeacon?.("/api/subjects/backup")) backupDue.current = false;
    };
    const onOnline = () => {
      lastSent.current = "";
      load().catch(() => {});
    };
    document.addEventListener("visibilitychange", onHide);
    window.addEventListener("online", onOnline);
    return () => {
      document.removeEventListener("visibilitychange", onHide);
      window.removeEventListener("online", onOnline);
    };
  }, [account, load]);

  const signOut = useCallback(async () => {
    await fetch("/api/auth/logout", { method: "POST" }).catch(() => {});
    loaded.current = false;
    linked.current = false;
    setAccount(null);
    setStatus("idle");
  }, []);

  const backupNow = useCallback(async () => {
    backupDue.current = true;
    await backup();
  }, [backup]);

  return { enabled, account, checked, status, savedAt, backedUpAt, signOut, backupNow };
}
