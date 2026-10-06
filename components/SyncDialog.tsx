"use client";

import { useEffect, useState } from "react";
import { Icon } from "./icons";

type Props = {
  code: string | null;
  busy: boolean;
  onCreate: () => Promise<void>;
  onConnect: (code: string) => Promise<void>;
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
function FeedHistory({ code, onRestore }: { code: string; onRestore: Props["onRestore"] }) {
  const [versions, setVersions] = useState<Version[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  async function load() {
    setError(null);
    try {
      const res = await fetch(`/api/sync/history?code=${encodeURIComponent(code)}`, { cache: "no-store" });
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

export default function SyncDialog({
  code,
  busy,
  onCreate,
  onConnect,
  onDisconnect,
  onRestore,
  onClose,
}: Props) {
  const [entry, setEntry] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  async function connect() {
    setError(null);
    try {
      await onConnect(entry);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not connect");
    }
  }

  async function create() {
    setError(null);
    try {
      await onCreate();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not start syncing");
    }
  }

  async function copy() {
    if (!code) return;
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      setError("Couldn't copy — select the code and copy it manually.");
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
      <div
        className="dialog"
        role="dialog"
        aria-modal="true"
        aria-label="Sync across devices"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="dialog-head">
          <button
            className="dialog-close"
            aria-label="Close"
            onClick={onClose}
          >
            {Icon.close}
          </button>
          <h2>Sync across devices</h2>
          <p>
            Your feeds live in this browser. Turn on sync to read them
            everywhere — no account needed.
          </p>
        </div>

        <div className="dialog-body">
          {code ? (
            <>
              <p className="field-label">This device&rsquo;s sync code</p>
              <div className="code-row">
                <code className="sync-code">{code}</code>
                <button className="btn small" onClick={copy}>
                  {copied ? "Copied" : "Copy"}
                </button>
              </div>
              <p className="hint">
                Open this app on another device, choose <strong>Sync</strong>,
                and paste this code. Keep it private: anyone with the code can
                read and change your feeds.
              </p>
              <FeedHistory code={code} onRestore={onRestore} />
              <button className="btn ghost small stop-sync" onClick={onDisconnect}>
                Stop syncing on this device
              </button>
            </>
          ) : (
            <>
              <button className="btn" onClick={create} disabled={busy}>
                {busy ? <span className="spinner" /> : Icon.sync}
                Start syncing this device
              </button>
              <p className="hint">
                Creates a private code and uploads the feeds you already have.
              </p>

              <div className="divider">
                <span>or</span>
              </div>

              <p className="field-label">Already have a code?</p>
              <div className="row">
                <input
                  className="input"
                  placeholder="XXXXX-XXXXX-XXXXX-XXXXX"
                  value={entry}
                  onChange={(event) => setEntry(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") connect();
                  }}
                />
                <button
                  className="btn small"
                  onClick={connect}
                  disabled={busy || entry.trim().length < 8}
                >
                  Connect
                </button>
              </div>
              <p className="hint">
                The synced feeds come to this device, and any feeds only this
                device has are added to them.
              </p>
            </>
          )}

          {error && <p className="error">{error}</p>}
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
