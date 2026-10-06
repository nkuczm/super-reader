"use client";

import { loadSyncCode } from "@/lib/store";
import { Fragment, useEffect, useMemo, useState } from "react";
import { TIERS } from "@/lib/models";
import { Icon } from "./icons";
import {
  ACTIVITY_NAME,
  type Activity,
  daily,
  formatDollars,
  loadSpend,
  loadSharedSpend,
  PROVIDER_NAME,
  SPEND_EVENT,
  summarise,
  type SpendRecord,
} from "@/lib/spend";

function runs(n: number) {
  return `${n} run${n === 1 ? "" : "s"}`;
}

function tokens(n: number) {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return String(n);
}

/** Cost per day, one series: bars with their own value on hover, no legend. */
function DailyBars({ days }: { days: { day: string; cost: number; runs: number }[] }) {
  const max = Math.max(...days.map((d) => d.cost), 0);
  const width = 600;
  const height = 90;
  const gap = 2;
  const bar = (width - gap * (days.length - 1)) / days.length;
  return (
    <svg className="spend-bars" viewBox={`0 0 ${width} ${height + 16}`} role="img"
      aria-label={`Estimated cost per day, last ${days.length} days`}>
      <line x1={0} x2={width} y1={height} y2={height} className="spend-axis" />
      {days.map((d, i) => {
        const h = max > 0 ? Math.max(d.cost > 0 ? 3 : 0, (d.cost / max) * (height - 4)) : 0;
        return (
          <g key={d.day}>
            <rect x={i * (bar + gap)} y={height - h} width={bar} height={h} rx={2} className="spend-bar" />
            {/* A taller invisible target, so a small bar is still easy to hover. */}
            <rect x={i * (bar + gap)} y={0} width={bar} height={height} fill="transparent">
              <title>{`${d.day}: ${formatDollars(d.cost)} across ${d.runs} run${d.runs === 1 ? "" : "s"}`}</title>
            </rect>
          </g>
        );
      })}
      <text x={0} y={height + 13} className="spend-tick">{days[0]?.day.slice(5)}</text>
      <text x={width} y={height + 13} textAnchor="end" className="spend-tick">Today</text>
    </svg>
  );
}

export default function SpendPage({ onOpenMenu, onBack }: { onOpenMenu?: () => void; onBack?: () => void }) {
  const [records, setRecords] = useState<SpendRecord[]>([]);
  /** Whether these are every device's runs (through the sync code) or this one's. */
  const [shared, setShared] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const load = () => {
      // This device's at once, then everyone's as soon as the server answers.
      setRecords(loadSpend());
      void loadSharedSpend(loadSyncCode()).then((result) => {
        if (cancelled) return;
        setRecords(result.records);
        setShared(result.shared);
      });
    };
    load();
    window.addEventListener(SPEND_EVENT, load);
    return () => {
      cancelled = true;
      window.removeEventListener(SPEND_EVENT, load);
    };
  }, []);

  const byDevice = useMemo(() => {
    const map = new Map<string, SpendRecord[]>();
    for (const r of records) map.set(r.device ?? "Earlier runs", [...(map.get(r.device ?? "Earlier runs") ?? []), r]);
    return [...map.entries()]
      .map(([device, list]) => ({ device, ...summarise(list) }))
      .sort((a, b) => b.cost - a.cost);
  }, [records]);

  const now = Date.now();
  const monthStart = new Date(now);
  monthStart.setDate(1);
  monthStart.setHours(0, 0, 0, 0);

  const all = useMemo(() => summarise(records), [records]);
  const month = useMemo(() => summarise(records.filter((r) => r.at >= monthStart.getTime())), [records, monthStart]);
  const week = useMemo(() => summarise(records.filter((r) => r.at >= now - 7 * 86_400_000)), [records, now]);
  const days = useMemo(() => daily(records, 30, now), [records, now]);

  const byModel = useMemo(() => {
    const map = new Map<string, SpendRecord[]>();
    for (const r of records) {
      const key = `${r.provider}|${r.model}`;
      map.set(key, [...(map.get(key) ?? []), r]);
    }
    return [...map.entries()]
      .map(([key, list]) => ({ key, provider: list[0].provider, model: list[0].model, ...summarise(list) }))
      .sort((a, b) => b.cost - a.cost || b.runs - a.runs);
  }, [records]);

  /** What the money went on: each tool, under its tier, and the runs from before activities were kept. */
  const byActivity = useMemo(() => {
    const of = (a: Activity | undefined) => records.filter((r) => r.activity === a);
    const tiers = (["deep", "quick"] as const).map((tier) => ({
      tier,
      rows: TIERS[tier].activities.map((a) => ({ key: a, name: ACTIVITY_NAME[a], ...summarise(of(a)) })),
    }));
    const earlier = summarise(of(undefined));
    return { tiers, earlier };
  }, [records]);

  const bySubject = useMemo(() => {
    const map = new Map<string, SpendRecord[]>();
    for (const r of records) map.set(r.subject ?? "—", [...(map.get(r.subject ?? "—") ?? []), r]);
    return [...map.entries()]
      .map(([subject, list]) => ({ subject, ...summarise(list) }))
      .sort((a, b) => b.cost - a.cost || b.runs - a.runs);
  }, [records]);

  const floor = (s: { unpriced: number }) => (s.unpriced > 0 ? "+" : "");

  return (
    <div className="status-page spend-page">
      <div className="main-head">
        {onOpenMenu && (
          <button className="menu-btn" onClick={onOpenMenu} aria-label="Open feeds">
            {Icon.menu}
          </button>
        )}
        {onBack && (
          <button className="btn ghost small" onClick={onBack} aria-label="Back to Settings">
            {Icon.back} Settings
          </button>
        )}
        <div>
          <h1>AI spending</h1>
          <p className="sub">
            Estimated from the tokens each run reported ·{" "}
            {shared
              ? `every device on your account${byDevice.length > 1 ? ` (${byDevice.length})` : ""}`
              : "this device only — turn on Sync across devices to count them all"}
          </p>
        </div>
      </div>

      <div className="status-tiles">
        <div className="status-tile"><strong>{formatDollars(month.cost)}{floor(month)}</strong><span>This month · {runs(month.runs)}</span></div>
        <div className="status-tile"><strong>{formatDollars(week.cost)}{floor(week)}</strong><span>Last 7 days · {runs(week.runs)}</span></div>
        <div className="status-tile"><strong>{formatDollars(all.cost)}{floor(all)}</strong><span>All time · {runs(all.runs)}</span></div>
        <div className="status-tile">
          <strong>{all.runs ? formatDollars(all.cost / Math.max(1, all.runs - all.unpriced)) : "—"}</strong>
          <span>Per run, on average</span>
        </div>
        <div className="status-tile"><strong>{tokens(all.input + all.output)}</strong><span>Tokens · {tokens(all.input)} in, {tokens(all.output)} out</span></div>
      </div>

      {records.length === 0 ? (
        <p className="hint" style={{ padding: "8px 20px" }}>
          No AI runs yet. Insights run on a subject with two or more stories once Subjects is on and a key is set.
        </p>
      ) : (
        <>
          <p className="field-label" style={{ padding: "4px 20px 0" }}>Last 30 days</p>
          <div style={{ padding: "4px 20px 12px" }}>
            <DailyBars days={days} />
          </div>

          <div className="status-table-wrap">
            <table className="status-table spend-activity">
              <thead>
                <tr><th>Activity</th><th className="num">Runs</th><th className="num">Tokens</th><th className="num">Est. cost</th></tr>
              </thead>
              <tbody>
                {byActivity.tiers.map(({ tier, rows }) => {
                  const total = rows.reduce((n, r) => n + r.cost, 0);
                  return (
                    <Fragment key={tier}>
                      <tr className="spend-tier"><td colSpan={3}>{TIERS[tier].name}</td><td className="num">{formatDollars(total)}</td></tr>
                      {rows.map((row) => (
                        <tr key={row.key}>
                          <td className="status-name spend-indent">{row.name}</td>
                          <td className="num">{row.runs}</td>
                          <td className="num">{tokens(row.input + row.output)}</td>
                          <td className="num">{row.runs ? `${formatDollars(row.cost)}${floor(row)}` : "—"}</td>
                        </tr>
                      ))}
                    </Fragment>
                  );
                })}
                {byActivity.earlier.runs > 0 && (
                  <tr>
                    <td><div className="status-name">Earlier runs</div><div className="status-dim">From before activities were recorded — mostly insights</div></td>
                    <td className="num">{byActivity.earlier.runs}</td>
                    <td className="num">{tokens(byActivity.earlier.input + byActivity.earlier.output)}</td>
                    <td className="num">{formatDollars(byActivity.earlier.cost)}{floor(byActivity.earlier)}</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          <div className="status-table-wrap">
            <table className="status-table">
              <thead>
                <tr><th>Model</th><th className="num">Runs</th><th className="num">Input</th><th className="num">Output</th><th className="num">Est. cost</th></tr>
              </thead>
              <tbody>
                {byModel.map((row) => (
                  <tr key={row.key}>
                    <td><div className="status-name">{row.model}</div><div className="status-dim">{PROVIDER_NAME[row.provider]}</div></td>
                    <td className="num">{row.runs}</td>
                    <td className="num">{tokens(row.input)}</td>
                    <td className="num">{tokens(row.output)}</td>
                    <td className="num">{row.unpriced === row.runs ? "price unknown" : formatDollars(row.cost)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {byDevice.length > 1 && (
            <div className="status-table-wrap">
              <table className="status-table">
                <thead>
                  <tr><th>Device</th><th className="num">Runs</th><th className="num">Est. cost</th></tr>
                </thead>
                <tbody>
                  {byDevice.map((row) => (
                    <tr key={row.device}>
                      <td className="status-name">{row.device}</td>
                      <td className="num">{row.runs}</td>
                      <td className="num">{formatDollars(row.cost)}{floor(row)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <div className="status-table-wrap">
            <table className="status-table">
              <thead>
                <tr><th>Subject</th><th className="num">Runs</th><th className="num">Est. cost</th></tr>
              </thead>
              <tbody>
                {bySubject.map((row) => (
                  <tr key={row.subject}>
                    <td className="status-name">{row.subject}</td>
                    <td className="num">{row.runs}</td>
                    <td className="num">{formatDollars(row.cost)}{floor(row)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
      <p className="hint status-footnote">
        Your provider&apos;s dashboard is the bill; this is an estimate from list prices per million tokens
        (Claude Opus 5.5 $4 in / $20 out; Claude Sonnet 5.5 $2 / $10; GPT-5 mini $0.25 / $2). A model this app does not know a price for is
        counted in tokens and marked “price unknown”, and a total with such runs in it is shown with a “+”.
      </p>
    </div>
  );
}
