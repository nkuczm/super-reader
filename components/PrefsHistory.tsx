"use client";

import { useState } from "react";

type Version = { id: string; savedAt: string; keys: string[]; settings: number; vault: boolean };

const when = (iso: string) =>
  new Date(iso).toLocaleString(undefined, { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" });

/**
 * Earlier copies of the account's settings and keys, kept before a key was
 * removed or replaced. Bringing one back restores only keys the account no
 * longer has; nothing held now is replaced. Key names are shown, never values.
 */
export default function PrefsHistory({ onRestored }: { onRestored: () => void }) {
  const [versions, setVersions] = useState<Version[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    setError(null);
    try {
      const res = await fetch("/api/account/prefs/history", { cache: "no-store" });
      const data = await res.json().catch(() => ({}));
      if (res.status === 401) throw new Error("Sign in to see earlier copies of your keys.");
      if (!res.ok) throw new Error(data.error ?? "Could not load earlier copies");
      setVersions(data.versions ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load earlier copies");
    }
  }

  async function restore(id: string) {
    setBusy(id);
    setNote(null);
    setError(null);
    try {
      const res = await fetch("/api/account/prefs/history", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? "Could not bring those keys back");
      const back: string[] = data.restored ?? [];
      setNote(back.length ? `Brought back: ${back.join(", ")}.` : "Every key in that copy is already in your account.");
      onRestored();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not bring those keys back");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="prefs-history">
      {!versions ? (
        <button className="btn ghost small" onClick={load}>
          Earlier copies of your keys…
        </button>
      ) : versions.length === 0 ? (
        <p className="field-note">None yet. A copy is kept here before a key is removed or replaced.</p>
      ) : (
        <>
          <p className="field-note">Bringing one back restores the keys it had that your account doesn&rsquo;t. Nothing you have now is replaced.</p>
          <ul className="feed-history-list">
            {versions.map((v) => (
              <li key={v.id}>
                <span>
                  <strong>{when(v.savedAt)}</strong> · {v.keys.length ? v.keys.join(", ") : "no keys"}
                </span>
                <button className="btn small" disabled={busy !== null || !v.keys.length} onClick={() => restore(v.id)}>
                  {busy === v.id ? <span className="spinner" /> : "Bring back"}
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
      {note && <p className="field-note">{note}</p>}
      {error && <p className="error">{error}</p>}
    </div>
  );
}
