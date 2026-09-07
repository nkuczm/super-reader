"use client";

import { useEffect, useState } from "react";
import { Icon } from "./icons";

type Props = {
  code: string | null;
  busy: boolean;
  onCreate: () => Promise<void>;
  onConnect: (code: string) => Promise<void>;
  onDisconnect: () => void;
  onClose: () => void;
};

export default function SyncDialog({
  code,
  busy,
  onCreate,
  onConnect,
  onDisconnect,
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
                This replaces the feeds on this device with the synced ones.
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
