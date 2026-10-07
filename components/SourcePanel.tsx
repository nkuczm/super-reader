"use client";

import { useState } from "react";
import { assess, type SourceHealth } from "@/lib/health";
import type { Source } from "@/lib/store";

const VERDICT_LABEL: Record<string, string> = {
  healthy: "Healthy",
  quiet: "Quiet",
  degraded: "Degraded",
  declining: "Declining",
  "losing-access": "Losing access",
  broken: "Broken",
  unknown: "Not checked yet",
};

const ago = (at?: number) => {
  if (!at) return "—";
  const mins = Math.round((Date.now() - at) / 60_000);
  if (mins < 60) return `${Math.max(1, mins)} min ago`;
  const hours = Math.round(mins / 60);
  if (hours < 48) return `${hours} h ago`;
  return `${Math.round(hours / 24)} days ago`;
};

/**
 * One outlet's page: remove it, or see how it has been answering — from the
 * refreshes this device has recorded (lib/health.ts): uptime over the last
 * month, what each refresh brought back, and how fresh its newest story is.
 */
export default function SourcePanel({
  source,
  feedName,
  health,
  onRemove,
}: {
  source: Source;
  feedName: string;
  health: SourceHealth | undefined;
  onRemove: () => void;
}) {
  const [showStats, setShowStats] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const a = assess(health);
  const days = health?.days ?? [];
  const runs = days.reduce((n, d) => n + d.runs, 0);
  const failures = days.reduce((n, d) => n + d.failures, 0);
  const uptime = runs ? Math.round(((runs - failures) / runs) * 1000) / 10 : null;
  const recent = [...(health?.runs ?? [])].reverse().slice(0, 12);
  const perDay = days.length ? Math.round(days.reduce((n, d) => n + d.fetched, 0) / days.length) : null;

  return (
    <div className="source-panel">
      <div className="source-panel-actions">
        <button className={`btn ghost small${showStats ? " on" : ""}`} aria-expanded={showStats} onClick={() => setShowStats((s) => !s)}>
          Stats &amp; uptime
        </button>
        {confirming ? (
          <span className="confirm-row">
            <span>Remove “{source.title}” from {feedName}?</span>
            <button className="link-btn danger" onClick={onRemove}>Remove</button>
            <button className="link-btn" onClick={() => setConfirming(false)}>Keep</button>
          </span>
        ) : (
          <button className="btn ghost small danger-text" onClick={() => setConfirming(true)}>
            Remove this feed
          </button>
        )}
      </div>
      {showStats && (
        <div className="source-stats">
          <div className="source-stat-grid">
            <div>
              <span>Status</span>
              <b className={`verdict-${a.verdict}`}>{VERDICT_LABEL[a.verdict] ?? a.verdict}</b>
            </div>
            <div>
              <span>Uptime (30 days)</span>
              <b>{uptime === null ? "—" : `${uptime}%`}</b>
              <em>{runs ? `${runs - failures} of ${runs} refreshes answered` : "no refreshes yet"}</em>
            </div>
            <div>
              <span>Last refresh</span>
              <b>{ago(a.lastRun)}</b>
              <em>{a.fetched} stories came back</em>
            </div>
            <div>
              <span>Newest story</span>
              <b>{ago(a.newest)}</b>
            </div>
            <div>
              <span>Stories per refresh</span>
              <b>{perDay ?? "—"}</b>
              <em>{a.baseline !== null ? `usually ${Math.round(a.baseline)}` : "best day's count, averaged"}</em>
            </div>
            <div>
              <span>Held now</span>
              <b>{a.held}</b>
            </div>
          </div>
          <p className="field-note">{a.reason}</p>
          {recent.length > 0 && (
            <table className="status-table source-runs">
              <thead>
                <tr>
                  <th>Refresh</th>
                  <th>Result</th>
                  <th className="num">Stories</th>
                </tr>
              </thead>
              <tbody>
                {recent.map((run) => (
                  <tr key={run.at}>
                    <td>{new Date(run.at).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}</td>
                    <td className={run.ok && run.fetched > 0 ? "" : "run-bad"}>
                      {run.ok ? (run.fetched > 0 ? "OK" : "Empty") : run.status ? `Failed (${run.status})` : "Failed"}
                    </td>
                    <td className="num">{run.fetched}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <p className="field-note source-url">
            Feed address: <a href={source.feedUrl} target="_blank" rel="noreferrer">{source.feedUrl}</a>
            <br />
            Measured on this device, from its own refreshes.
          </p>
        </div>
      )}
    </div>
  );
}
