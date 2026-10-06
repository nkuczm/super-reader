"use client";

import { useEffect, useState } from "react";
import { formatBytes } from "@/lib/storage";
import type { UsageReport } from "@/lib/db-usage";

const GB = 1024 ** 3;
const TABLE_NAME: Record<string, string> = {
  subject_versions: "Version history (from before changes were kept)",
  subject_changes: "Version history",
  subject_store: "Subjects (older whole copy)",
  subject_images: "Pictures",
  subject_backups: "Google Docs backup records",
  feed_syncs: "Device sync",
  accounts: "Accounts",
  sessions: "Sign-in sessions",
  corpus_stories: "News index (Pulse)",
  corpus_reddit: "News index — Reddit",
  corpus_sweeps: "News index — sweeps",
  db_usage: "This usage count",
};
const dollars = (n: number) => (n < 0.01 ? (n === 0 ? "$0" : "<$0.01") : `$${n.toFixed(2)}`);

/**
 * What the app costs the database (Neon), counted by the server for every
 * request since this was added: data moved this month by part of the app,
 * what is stored now, and what that would cost on Neon's paid plan.
 */
export default function DbUsageSection() {
  const [report, setReport] = useState<UsageReport | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    fetch("/api/usage", { cache: "no-store" })
      .then(async (res) => {
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(res.status === 401 ? "Sign in to see what the database is used for." : data.error ?? "Couldn't read the database's usage.");
        setReport(data as UsageReport);
      })
      .catch((e) => setProblem(e instanceof Error ? e.message : "Couldn't read the database's usage."));
  }, []);

  if (problem) return <p className="field-note">{problem}</p>;
  if (!report) return <p className="field-note">Reading the database's usage…</p>;

  const p = report.prices;
  const moved = report.rows.reduce((n, r) => n + r.bytesIn + r.bytesOut, 0);
  const mine = report.rows.reduce((n, r) => n + r.mine, 0);
  const now = new Date();
  const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
  // The pace of the days counted so far, over a whole month.
  const counted = Math.max(1, report.days.length);
  const projected = (moved / counted) * daysInMonth;
  const transferCost = Math.max(0, projected / GB - p.transferIncluded) * p.transfer;
  const storageCost = (report.storage.total / GB) * p.storage;
  const ms = report.rows.reduce((n, r) => n + r.ms, 0);
  const freeShare = Math.min(1, projected / (p.freeTransfer * GB));

  return (
    <div className="storage db-usage">
      <div className="storage-lines">
        <div>
          <span>Data moved this month</span>
          <b>{formatBytes(moved)}</b>
          <em>
            Since {report.days[0]?.day ?? report.since} · on pace for about {formatBytes(projected)} this month
            {mine && mine !== moved ? ` · ${formatBytes(mine)} of it your account's` : ""}
          </em>
        </div>
        <div className="db-meter" aria-label="Against the Free plan's allowance">
          <span className="db-meter-bar"><span style={{ width: `${Math.round(freeShare * 100)}%` }} className={freeShare >= 1 ? "over" : ""} /></span>
          <em>
            {freeShare >= 1
              ? `More than the Free plan's ${p.freeTransfer} GB a month.`
              : `${Math.round(freeShare * 100)}% of the Free plan's ${p.freeTransfer} GB a month.`}{" "}
            On the Launch plan {p.transferIncluded} GB is included, so this costs {dollars(transferCost)}.
          </em>
        </div>
        <div>
          <span>Stored</span>
          <b>{formatBytes(report.storage.total)}</b>
          <em>About {dollars(storageCost)} a month on the Launch plan ({dollars(p.storage)} per GB-month)</em>
        </div>
        <div>
          <span>Time the database spent answering</span>
          <b>{ms < 60_000 ? `${Math.round(ms / 1000)} s` : `${Math.round(ms / 60_000)} min`}</b>
          <em>
            Compute is billed for the time the database is awake ({dollars(p.compute)} per CU-hour on Launch), which
            includes the 5 minutes it waits before sleeping — see Neon's dashboard for that, and for restore history
            ({dollars(p.history)} per GB-month).
          </em>
        </div>
      </div>

      <button className="link-btn storage-toggle" onClick={() => setOpen((v) => !v)} aria-expanded={open}>
        {open ? "Hide" : "Show"} what it is used for
      </button>
      {open && (
        <>
          <table className="storage-table">
            <thead>
              <tr>
                <th>Part of the app</th>
                <th className="num">Data moved</th>
                <th className="num">Requests</th>
              </tr>
            </thead>
            <tbody>
              {report.rows.map((r) => (
                <tr key={r.category}>
                  <td>
                    <span className="storage-name">{r.name}</span>
                    <div className="storage-dim">
                      {formatBytes(r.bytesIn)} read · {formatBytes(r.bytesOut)} written · {formatBytes((r.bytesIn + r.bytesOut) / Math.max(1, r.requests))} a request
                    </div>
                  </td>
                  <td className="num">{formatBytes(r.bytesIn + r.bytesOut)}</td>
                  <td className="num">{r.requests.toLocaleString()}</td>
                </tr>
              ))}
              {report.rows.length === 0 && (
                <tr><td colSpan={3} className="storage-dim">Nothing counted yet this month.</td></tr>
              )}
            </tbody>
          </table>
          <table className="storage-table">
            <thead>
              <tr>
                <th>Stored in</th>
                <th className="num">Size</th>
              </tr>
            </thead>
            <tbody>
              {report.storage.tables.slice(0, 12).map((t) => (
                <tr key={t.name}>
                  <td>{TABLE_NAME[t.name] ?? t.name}</td>
                  <td className="num">{formatBytes(t.bytes)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="field-note">
            Counted by this app for every request it makes to the database, since this page was added. Neon's own
            numbers also include its connection overhead, so they run somewhat higher.
          </p>
        </>
      )}
    </div>
  );
}
