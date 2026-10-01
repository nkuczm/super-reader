"use client";

import { useEffect, useState } from "react";
import { subjectHtml } from "@/lib/subject-doc";
import type { Writing } from "./useAccount";

/**
 * Every saved version of a subject, newest first, each one readable before it
 * is restored. A restore is itself saved as a new version, so it can be undone
 * the same way.
 */
export default function SubjectHistory({
  subjectId,
  onClose,
  onRestored,
}: {
  subjectId: string;
  onClose: () => void;
  onRestored: (doc: Writing) => void;
}) {
  const [versions, setVersions] = useState<{ id: string; savedAt: string }[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [chosen, setChosen] = useState<string | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    fetch("/api/subjects/history", { cache: "no-store" })
      .then(async (res) => {
        const data = await res.json();
        if (!res.ok) throw new Error(data.error ?? "Could not load history");
        setVersions(data.versions);
      })
      .catch((e) => setError(e.message));
  }, []);

  useEffect(() => {
    if (!chosen) return;
    setPreview(null);
    fetch(`/api/subjects/history?id=${encodeURIComponent(chosen)}`, { cache: "no-store" })
      .then(async (res) => {
        const data = await res.json();
        if (!res.ok) throw new Error(data.error ?? "Could not load that version");
        const doc = data.doc as Writing;
        const note = doc.notes?.find((n) => n.id === subjectId);
        setPreview(note ? subjectHtml(note, doc.boards?.[subjectId]) : "");
      })
      .catch((e) => setError(e.message));
  }, [chosen, subjectId]);

  const restore = async () => {
    if (!chosen) return;
    setBusy(true);
    try {
      const res = await fetch("/api/subjects/restore", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ versionId: chosen, subjectId }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Restore failed");
      onRestored(data.doc);
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Restore failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="history-overlay" role="dialog" aria-label="Version history" onClick={onClose}>
      <div className="history-panel" onClick={(event) => event.stopPropagation()}>
        <div className="history-head">
          <h2>Version history</h2>
          <button className="btn ghost small" onClick={onClose}>
            Close
          </button>
        </div>
        {error && <p className="signin-error">{error}</p>}
        <div className="history-body">
          <ol className="history-list">
            {versions === null && !error && <li>Loading…</li>}
            {versions?.length === 0 && <li>No saved versions yet.</li>}
            {versions?.map((v) => (
              <li key={v.id}>
                <button className={chosen === v.id ? "on" : ""} onClick={() => setChosen(v.id)}>
                  {new Date(v.savedAt).toLocaleString([], {
                    month: "short",
                    day: "numeric",
                    hour: "numeric",
                    minute: "2-digit",
                  })}
                </button>
              </li>
            ))}
          </ol>
          <div className="history-preview">
            {!chosen && <p className="sub">Choose a version to read it.</p>}
            {chosen && preview === null && <p className="sub">Loading…</p>}
            {chosen && preview === "" && <p className="sub">This subject did not exist in that version.</p>}
            {preview ? (
              <>
                {/* Sandboxed: the version is shown, never run. */}
                <iframe className="history-frame" sandbox="" srcDoc={preview} title="Version preview" />
                <button className="btn" disabled={busy} onClick={() => void restore()}>
                  {busy ? "Restoring…" : "Restore this version"}
                </button>
              </>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}
