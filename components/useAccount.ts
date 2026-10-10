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
import { delta, emptyBase, isEmpty, joinParts, pictureBatches, remember, splitWriting, withPictures, withRefs, type Base } from "@/lib/subject-sync";

export type AccountInfo = { id: string; email: string; name?: string; picture?: string };
export type Writing = { notes: Note[]; noteRemovals: NoteRemoval[]; boards: Boards };
export type SaveStatus = "idle" | "saving" | "saved" | "offline" | "error";

class SignedOut extends Error {}

const SAVE_DELAY_MS = 1500;
/** Coming back to the tab looks for other devices' changes at most this often. */
const LOAD_EVERY_MS = 3 * 60 * 1000;
/** Google Docs backups: at most this often. Each reads the changed subjects, pictures and all, from the database. */
const BACKUP_DELAY_MS = 20 * 60 * 1000;

/**
 * Who was signed in the last time the server said. The app opens with no
 * connection (the service worker serves it), and the question "who is signed
 * in?" then has no answer — which used to be taken as "nobody": writing done
 * on a train was kept on the phone but never sent, not even once the phone
 * was back online, until the app happened to be closed and opened again.
 */
const KNOWN_KEY = "super-reader:account:v1";

function knownAccount(): AccountInfo | null {
  try {
    const held = JSON.parse(localStorage.getItem(KNOWN_KEY) ?? "null");
    if (!held || typeof held.id !== "string" || typeof held.email !== "string") return null;
    return {
      id: held.id,
      email: held.email,
      ...(typeof held.name === "string" ? { name: held.name } : {}),
      ...(typeof held.picture === "string" ? { picture: held.picture } : {}),
    };
  } catch {
    return null;
  }
}

function rememberAccount(account: AccountInfo | null) {
  try {
    if (account) localStorage.setItem(KNOWN_KEY, JSON.stringify(account));
    else localStorage.removeItem(KNOWN_KEY);
  } catch {
    /* asked again next time */
  }
}

/** The same person, so a confirmation does not start everything over. */
const sameAccount = (a: AccountInfo | null, b: AccountInfo | null) =>
  a === b || (!!a && !!b && a.id === b.id && a.email === b.email && a.name === b.name && a.picture === b.picture);

export function useAccount(params: {
  ready: boolean;
  writing: Writing;
  /** Merge the account's copy into this device's. */
  applyWriting: (doc: Writing) => void;
}) {
  const { ready, writing, applyWriting } = params;
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
  const retrySave = useRef<ReturnType<typeof setTimeout> | null>(null);
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
  const lastBackup = useRef(0);
  const applyRef = useRef(applyWriting);
  applyRef.current = applyWriting;
  const accountRef = useRef(account);
  accountRef.current = account;
  /** Bumped to try linking and loading again after they failed. */
  const [attempt, setAttempt] = useState(0);
  const failures = useRef(0);

  /** The server has said who is signed in, this visit. Until it has, it is asked again whenever the connection may be back. */
  const reached = useRef(false);
  const [askAgain, setAskAgain] = useState(0);
  const askFailures = useRef(0);
  useEffect(() => {
    if (!ready) return;
    let cancelled = false;
    let retry: ReturnType<typeof setTimeout> | null = null;
    fetch("/api/auth/me", { cache: "no-store" })
      .then((res) => {
        if (!res.ok) throw new Error(`auth ${res.status}`);
        return res.json();
      })
      .then((data) => {
        if (cancelled) return;
        reached.current = true;
        askFailures.current = 0;
        const who: AccountInfo | null = data.enabled ? (data.account ?? null) : null;
        setEnabled(Boolean(data.enabled));
        setAccount((current) => (sameAccount(current, who) ? current : who));
        rememberAccount(who);
      })
      .catch(() => {
        if (cancelled) return;
        // No answer — offline, most often. Whoever was signed in when the
        // server last answered still is: their writing stays theirs, and is
        // sent as soon as the account can be reached.
        const known = knownAccount();
        if (known) {
          setEnabled(true);
          setAccount((current) => current ?? known);
          setStatus((current) => (current === "idle" ? "offline" : current));
        }
        const delay = Math.min(5 * 60_000, 15_000 * 2 ** askFailures.current);
        askFailures.current += 1;
        retry = setTimeout(() => setAskAgain((n) => n + 1), delay);
      })
      .finally(() => {
        if (!cancelled) setChecked(true);
      });
    return () => {
      cancelled = true;
      if (retry) clearTimeout(retry);
    };
  }, [ready, askAgain]);
  // Back online, or back in the app: ask straight away rather than at the next retry.
  useEffect(() => {
    if (!ready) return;
    const onBack = () => {
      if (reached.current || document.visibilityState === "hidden") return;
      setAskAgain((n) => n + 1);
    };
    window.addEventListener("online", onBack);
    window.addEventListener("focus", onBack);
    document.addEventListener("visibilitychange", onBack);
    return () => {
      window.removeEventListener("online", onBack);
      window.removeEventListener("focus", onBack);
      document.removeEventListener("visibilitychange", onBack);
    };
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
      rememberAccount(null);
      setAccount(null);
      return;
    }
    if (!res.ok) {
      // The account answered, and could not give the changes: the next look
      // reads the whole copy. A cursor that keeps failing would otherwise
      // keep this device from ever seeing another's writing.
      if (res.status >= 500) cursor.current = null;
      throw new Error("Could not load subjects");
    }
    const data = await res.json();
    if (Number(data.of) > 1) {
      // Too big for one answer: the rest of the parts, then all of it as one.
      const parts: Writing[] = [data.doc];
      for (let part = 1; part < Number(data.of); part++) {
        const more = await fetch(`/api/subjects?part=${part}&of=${data.of}`, { cache: "no-store" });
        if (!more.ok) throw new Error("Could not load subjects");
        parts.push((await more.json()).doc);
      }
      data.doc = joinParts(parts);
    }
    const full = await applyRemote(data.doc);
    // The whole copy resets what the account is known to hold; changes add to it.
    if (data.full) base.current = emptyBase();
    remember(base.current, full);
    if (data.cursor) cursor.current = String(data.cursor);
    loaded.current = true;
    setNudge((n) => n + 1);
    // Some pictures could not be fetched, and their boxes were left out. The
    // next look reads the whole copy again — a look for changes only would
    // never bring them back — and comes soon.
    if ((full as { leftOut?: number }).leftOut) {
      cursor.current = null;
      setTimeout(() => {
        if (accountRef.current) load().catch(() => {});
      }, 60_000);
    }
  }, [applyRemote]);

  // Once signed in: read the account's subjects. Again on focus, for changes made on another device;
  // and if either fails, again until it works — until it does, nothing from
  // the account is here and nothing written here reaches it.
  const starting = useRef(false);
  useEffect(() => {
    if (!ready || !account) return;
    let cancelled = false;
    let retry: ReturnType<typeof setTimeout> | null = null;
    const start = async () => {
      // One try at a time: two at once could each start a sync code.
      if (starting.current) return;
      starting.current = true;
      try {
        if (!cancelled) await load();
        failures.current = 0;
        // Once per visit, bring Drive up to date even if nothing is edited:
        // only subjects that differ from their last backup are uploaded.
        if (!cancelled) {
          backupDue.current = true;
          setTimeout(() => void backupRef.current(), 15_000);
        }
        if (!cancelled) setStatus("saved");
      } catch {
        if (cancelled) return;
        setStatus(navigator.onLine ? "error" : "offline");
        const delay = Math.min(5 * 60_000, 15_000 * 2 ** failures.current);
        failures.current += 1;
        retry = setTimeout(() => setAttempt((n) => n + 1), delay);
      } finally {
        starting.current = false;
      }
    };
    start();
    // Another device's changes, on coming back to the app — not more often
    // than every few minutes; straight away if the account was never reached
    // or the connection has just come back. And whatever was written here
    // while it could not be sent goes now, not at the next retry. An app
    // opened from a phone's home screen comes back with "visibilitychange",
    // and not always with "focus".
    const look = (always: boolean) => {
      if (!loaded.current) {
        if (starting.current) return;
        if (retry) clearTimeout(retry);
        setAttempt((n) => n + 1);
        return;
      }
      setNudge((n) => n + 1);
      if (!always && Date.now() - lastLoad.current < LOAD_EVERY_MS) return;
      load().catch(() => {});
    };
    const onFocus = () => look(false);
    const onShown = () => document.visibilityState === "visible" && look(false);
    const onOnline = () => look(true);
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onShown);
    window.addEventListener("online", onOnline);
    return () => {
      cancelled = true;
      if (retry) clearTimeout(retry);
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onShown);
      window.removeEventListener("online", onOnline);
    };
  }, [ready, account, load, attempt]);

  const backup = useCallback(async () => {
    if (backupTimer.current) clearTimeout(backupTimer.current);
    backupTimer.current = null;
    if (!backupDue.current) return;
    backupDue.current = false;
    lastBackup.current = Date.now();
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

  /**
   * Send a change. Pictures the account lacks go first, a few at a time and
   * apart from the change; then the change itself, with every picture as a
   * reference, in pieces that each fit in one request. A save carrying
   * several new pictures used to be over the size a request may have, and
   * was refused on every try — so nothing more ever reached the account.
   */
  const send = useCallback(async (change: Writing, hiding = false) => {
    for (let round = 0; round < 2; round++) {
      let { doc: body, sent, inline } = await withRefs(change, onServer.current);
      for (const batch of pictureBatches(inline)) {
        const res = await fetch("/api/subjects/images", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ images: batch }),
        });
        if (res.status === 401) throw new SignedOut();
        if (!res.ok) throw new Error("Could not save pictures");
        for (const h of ((await res.json().catch(() => ({}))).stored ?? []) as string[]) onServer.current.add(h);
      }
      if (inline.size) ({ doc: body, sent } = await withRefs(change, onServer.current));
      let missing: string[] = [];
      for (const piece of splitWriting(body)) {
        const text = JSON.stringify(piece);
        const res = await fetch("/api/subjects", {
          method: "PUT",
          headers: { "content-type": "application/json" },
          body: text,
          // Browsers carry a request past the page's end only up to 64 KB.
          keepalive: hiding && text.length < 60_000,
        });
        if (res.status === 409) {
          // The account lacks pictures this device thought it had: they go again, whole.
          missing = (await res.json().catch(() => ({}))).missing ?? [];
          break;
        }
        if (res.status === 401) throw new SignedOut();
        if (!res.ok) throw new Error("save failed");
      }
      if (missing.length) {
        for (const h of missing) onServer.current.delete(h);
        continue;
      }
      remember(base.current, change);
      for (const h of sent) onServer.current.add(h);
      return;
    }
    throw new Error("save failed");
  }, []);

  // Autosave: a burst of typing is one request, and only what changed goes.
  useEffect(() => {
    if (!account || !loaded.current) return;
    const change = delta(writing, base.current);
    if (isEmpty(change)) return;
    setStatus("saving");
    const timer = setTimeout(async () => {
      try {
        await send(change);
        setSavedAt(Date.now());
        setStatus("saved");
        backupDue.current = true;
        if (!backupTimer.current) backupTimer.current = setTimeout(backup, BACKUP_DELAY_MS);
      } catch (error) {
        if (error instanceof SignedOut) {
          rememberAccount(null);
          setAccount(null);
          setStatus("error");
          return;
        }
        // Still safe on this device; the change stays unsent, and goes with the next try.
        // One retry waiting at a time, however many saves failed while offline.
        setStatus(navigator.onLine ? "error" : "offline");
        if (!retrySave.current) {
          retrySave.current = setTimeout(() => {
            retrySave.current = null;
            setNudge((n) => n + 1);
          }, 30_000);
        }
      }
    }, SAVE_DELAY_MS);
    return () => clearTimeout(timer);
  }, [account, writing, backup, nudge, send]);

  const flushNow = useCallback(async () => {
    if (!account || !loaded.current) return;
    const change = delta(writingRef.current, base.current);
    if (isEmpty(change)) return;
    try {
      await send(change, true);
      setSavedAt(Date.now());
      setStatus("saved");
    } catch {
      /* the autosave, or the next visit, sends it */
    }
  }, [account, send]);

  // Putting the tab away is the moment work is most likely to be left: send
  // the backup then, in a request the browser finishes even as the page goes.
  useEffect(() => {
    if (!account) return;
    const onHide = () => {
      if (document.visibilityState !== "hidden") return;
      // Unsent changes go now, in a request the browser finishes even if the
      // tab is then closed — a moment after, once the last keystrokes are in.
      setTimeout(() => void flushNow(), 50);
      if (!backupDue.current || Date.now() - lastBackup.current < BACKUP_DELAY_MS) return;
      if (navigator.sendBeacon?.("/api/subjects/backup")) {
        backupDue.current = false;
        lastBackup.current = Date.now();
      }
    };
    document.addEventListener("visibilitychange", onHide);
    return () => document.removeEventListener("visibilitychange", onHide);
  }, [account, flushNow]);

  const signOut = useCallback(async () => {
    await fetch("/api/auth/logout", { method: "POST" }).catch(() => {});
    loaded.current = false;
    base.current = emptyBase();
    cursor.current = null;
    rememberAccount(null);
    setAccount(null);
    setStatus("idle");
  }, []);

  const backupNow = useCallback(async () => {
    backupDue.current = true;
    await backup();
  }, [backup]);

  return { enabled, account, checked, status, savedAt, backedUpAt, backupProblem, signOut, backupNow, applyRemote };
}
