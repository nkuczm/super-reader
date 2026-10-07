"use client";

import { useEffect, useState } from "react";
import { Icon } from "./icons";
import { signInHref } from "./SignInCard";

type Props = {
  code: string;
  onDisconnect: () => void;
  /** Bring back what an earlier feed list had that this one does not; says how much came back. */
  onRestore: (versionId: string) => Promise<{ folders: number; sources: number; teams: number }>;
  onClose: () => void;
};

type Version = { id: string; savedAt: string; folders: number; sources: number; teams: number };

const when = (iso: string) =>
  new Date(iso).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
const plural = (n: number, one: string) => `${n} ${one}${n === 1 ? "" : "s"}`;

/**
 * Earlier feed lists, kept on the server before anything was taken out of
 * one. Bringing one back adds what it had that the current list lacks; it
 * removes nothing, so trying one costs nothing.
 */
export function FeedHistory({ listUrl, onRestore }: { listUrl: string; onRestore: Props["onRestore"] }) {
  const [versions, setVersions] = useState<Version[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  async function load() {
    setError(null);
    try {
      const res = await fetch(listUrl, { cache: "no-store" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Could not load earlier feed lists");
      setVersions(data.versions ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load earlier feed lists");
    }
  }

  async function restore(id: string) {
    setBusy(id);
    setDone(null);
    setError(null);
    try {
      const back = await onRestore(id);
      const parts = [
        back.folders ? plural(back.folders, "folder") : "",
        back.sources ? plural(back.sources, "source") : "",
        back.teams ? plural(back.teams, "team feed") : "",
      ].filter(Boolean);
      setDone(parts.length ? `Brought back ${parts.join(", ")}.` : "Everything in that list is already in yours.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not bring that list back");
    } finally {
      setBusy(null);
    }
  }

  if (!versions) {
    return (
      <div className="feed-history">
        <button className="btn ghost small" onClick={load}>
          Earlier feed lists…
        </button>
        {error && <p className="error">{error}</p>}
      </div>
    );
  }
  return (
    <div className="feed-history">
      <p className="field-label">Earlier feed lists</p>
      {versions.length === 0 ? (
        <p className="hint">None yet. A copy is kept here before anything is taken out of your feeds.</p>
      ) : (
        <>
          <p className="hint">Bringing one back adds the folders and sources it had that yours doesn&rsquo;t. Nothing is removed.</p>
          <ul className="feed-history-list">
            {versions.map((v) => (
              <li key={v.id}>
                <span>
                  <strong>{when(v.savedAt)}</strong> · {plural(v.folders, "folder")}, {plural(v.sources, "source")}
                  {v.teams ? `, ${plural(v.teams, "team feed")}` : ""}
                </span>
                <button className="btn small" disabled={busy !== null} onClick={() => restore(v.id)}>
                  {busy === v.id ? <span className="spinner" /> : "Bring back"}
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
      {done && <p className="hint">{done}</p>}
      {error && <p className="error">{error}</p>}
    </div>
  );
}

/**
 * For a device still on an old sync code. Codes are retired: none can be
 * made or entered any more, and signing in with Google folds this one into
 * the account and forgets it.
 */
export default function SyncDialog({ code, onDisconnect, onRestore, onClose }: Props) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      /* the code is on screen to select */
    }
  }

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="overlay" onMouseDown={onClose}>
      <div className="dialog" role="dialog" aria-modal="true" aria-label="Sync" onMouseDown={(event) => event.stopPropagation()}>
        <div className="dialog-head">
          <button className="dialog-close" aria-label="Close" onClick={onClose}>
            {Icon.close}
          </button>
          <h2>Sign in to keep your work</h2>
          <p>
            Sync codes are being retired. Sign in with Google and everything on this device — feeds, saved
            articles, subjects, settings — is kept with your account and on every device you sign in on.
          </p>
        </div>
        <div className="dialog-body">
          <a className="btn" href={signInHref()}>
            Sign in with Google
          </a>
          <p className="hint">This device&rsquo;s sync code is folded into your account when you sign in, then retired.</p>
          <p className="field-label">This device&rsquo;s sync code, until then</p>
          <div className="code-row">
            <code className="sync-code">{code}</code>
            <button className="btn small" onClick={copy}>
              {copied ? "Copied" : "Copy"}
            </button>
          </div>
          <FeedHistory listUrl={`/api/sync/history?code=${encodeURIComponent(code)}`} onRestore={onRestore} />
          <button className="btn ghost small stop-sync" onClick={onDisconnect}>
            Stop syncing on this device
          </button>
        </div>
        <div className="dialog-foot">
          <button className="btn ghost small" onClick={onClose}>
            Done
          </button>
        </div>
      </div>
    </div>
  );
}
