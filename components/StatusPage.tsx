"use client";

import { useMemo, useState } from "react";
import { Icon } from "./icons";
import {
  assess,
  VERDICT_ORDER,
  type Assessment,
  type Day,
  type HealthLog,
  type Verdict,
} from "@/lib/health";

type Row = { id: string; title: string; feedUrl: string; feed: string; assessment: Assessment; days: Day[] };

const LABEL: Record<Verdict, string> = {
  broken: "Broken",
  "losing-access": "Losing access",
  degraded: "Failing, cached",
  declining: "Declining",
  quiet: "Quiet",
  unknown: "Not checked yet",
  healthy: "Healthy",
};

/** A glyph beside every label, so a state is never told by colour alone. */
const GLYPH: Record<Verdict, string> = {
  broken: "✕",
  "losing-access": "⚠",
  degraded: "!",
  declining: "↘",
  quiet: "…",
  unknown: "?",
  healthy: "✓",
};

function ago(at: number | undefined, now: number) {
  if (!at) return "—";
  const minutes = Math.round((now - at) / 60000);
  if (minutes < 60) return `${Math.max(minutes, 0)}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

/**
 * Stories delivered per day, as small bars — one series, so no legend; each
 * bar says its own number on hover.
 */
function Trend({ days }: { days: Day[] }) {
  const recent = days.slice(-14);
  if (recent.length === 0) return <span className="status-dim">—</span>;
  const max = Math.max(1, ...recent.map((day) => day.fetched));
  const width = 112;
  const height = 24;
  const gap = 2;
  const bar = (width - gap * (14 - 1)) / 14;
  return (
    <svg className="status-trend" width={width} height={height} role="img"
      aria-label={`Stories per day, last ${recent.length} days: ${recent.map((d) => d.fetched).join(", ")}`}>
      {recent.map((day, index) => {
        const h = day.fetched === 0 ? 2 : Math.max(3, (day.fetched / max) * (height - 2));
        const x = (14 - recent.length + index) * (bar + gap);
        return (
          <rect key={day.day} x={x} y={height - h} width={bar} height={h} rx={1.5}
            className={day.failures > 0 && day.fetched === 0 ? "bar-fail" : "bar"}>
            <title>{`${day.day}: ${day.fetched} stories${day.failures ? `, ${day.failures} failed refresh${day.failures === 1 ? "" : "es"}` : ""}`}</title>
          </rect>
        );
      })}
    </svg>
  );
}

export default function StatusPage({
  sources,
  health,
  onOpenMenu,
  onRefresh,
  refreshing,
}: {
  sources: { id: string; title: string; feedUrl: string; feed: string }[];
  health: HealthLog;
  onOpenMenu?: () => void;
  onRefresh: () => void;
  refreshing: boolean;
}) {
  const [filter, setFilter] = useState<"all" | "problems">("problems");
  const now = Date.now();

  const rows: Row[] = useMemo(
    () =>
      sources
        .map((source) => ({
          ...source,
          assessment: assess(health[source.id], now),
          days: health[source.id]?.days ?? [],
        }))
        .sort(
          (a, b) =>
            VERDICT_ORDER.indexOf(a.assessment.verdict) - VERDICT_ORDER.indexOf(b.assessment.verdict) ||
            a.title.localeCompare(b.title),
        ),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [sources, health],
  );

  const counts = new Map<Verdict, number>();
  for (const row of rows) counts.set(row.assessment.verdict, (counts.get(row.assessment.verdict) ?? 0) + 1);
  const problems = rows.filter((row) => !["healthy", "unknown"].includes(row.assessment.verdict));
  const shown = filter === "problems" ? problems : rows;
  const held = rows.reduce((sum, row) => sum + row.assessment.held, 0);

  return (
    <div className="status-page">
      <div className="main-head">
        {onOpenMenu && (
          <button className="menu-btn" onClick={onOpenMenu} aria-label="Open feeds">
            {Icon.menu}
          </button>
        )}
        <div>
          <h1>Source status</h1>
          <p className="sub">
            {rows.length} sources · {held} stories held on this device · {problems.length} need attention
          </p>
        </div>
        <button className="btn small" style={{ marginLeft: "auto" }} onClick={onRefresh} disabled={refreshing}>
          {refreshing ? "Checking…" : "Check now"}
        </button>
      </div>

      <div className="status-tiles">
        {(["broken", "losing-access", "degraded", "declining", "quiet", "healthy"] as Verdict[]).map((verdict) => (
          <div key={verdict} className={`status-tile v-${verdict}`}>
            <strong>{counts.get(verdict) ?? 0}</strong>
            <span>
              <i aria-hidden="true">{GLYPH[verdict]}</i> {LABEL[verdict]}
            </span>
          </div>
        ))}
      </div>

      <div className="status-filter" role="tablist">
        <button role="tab" aria-selected={filter === "problems"} className={filter === "problems" ? "on" : ""}
          onClick={() => setFilter("problems")}>
          Needs attention ({problems.length})
        </button>
        <button role="tab" aria-selected={filter === "all"} className={filter === "all" ? "on" : ""}
          onClick={() => setFilter("all")}>
          All sources ({rows.length})
        </button>
      </div>

      {shown.length === 0 ? (
        <p className="hint" style={{ padding: "16px 20px" }}>
          {rows.length === 0
            ? "No sources yet."
            : "Every source delivered on its last refresh. Switch to All sources to see the numbers."}
        </p>
      ) : (
        <div className="status-table-wrap">
          <table className="status-table">
            <thead>
              <tr>
                <th>Source</th>
                <th>State</th>
                <th className="num">Held</th>
                <th className="num">Last refresh</th>
                <th className="num">Usual</th>
                <th>Last 14 days</th>
                <th className="num">Newest</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((row) => (
                <tr key={row.id}>
                  <td>
                    <div className="status-name">{row.title}</div>
                    <div className="status-dim">{row.feed}</div>
                  </td>
                  <td>
                    <span className={`status-badge v-${row.assessment.verdict}`}>
                      <i aria-hidden="true">{GLYPH[row.assessment.verdict]}</i> {LABEL[row.assessment.verdict]}
                    </span>
                    <div className="status-reason">{row.assessment.reason}</div>
                  </td>
                  <td className="num">{row.assessment.held}</td>
                  <td className="num">
                    {row.assessment.fetched}
                    <div className="status-dim">{ago(row.assessment.lastRun, now)}</div>
                  </td>
                  <td className="num">{row.assessment.baseline === null ? "—" : Math.round(row.assessment.baseline)}</td>
                  <td>
                    <Trend days={row.days} />
                  </td>
                  <td className="num">{ago(row.assessment.newest, now)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="hint status-footnote">
        Recorded on this device at every refresh; history starts when this page was added. “Usual” is the
        typical refresh over the previous week. A source is broken when nothing arrives and nothing is cached, and
        losing access when the publisher keeps refusing (401, 403, 404, 410) while cached stories hide it.
      </p>
    </div>
  );
}
