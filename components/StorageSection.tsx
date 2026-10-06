"use client";

import { useEffect, useMemo, useState } from "react";
import { loadNotes } from "@/lib/notes";
import { loadSaved } from "@/lib/store";
import { loadBoards } from "@/lib/subjects";
import { offlineSizes } from "@/lib/offline";
import { formatBytes, savedUsage, subjectUsage } from "@/lib/storage";

type Sort = { by: "size" | "date"; desc: boolean };

/**
 * What subjects and saved articles take up on this device, with each
 * subject listed — sortable by size or by when it was last edited.
 */
export default function StorageSection() {
  const subjects = useMemo(() => subjectUsage(loadNotes(), loadBoards()), []);
  const saved = useMemo(() => loadSaved(), []);
  const [offline, setOffline] = useState<Map<string, number> | null>(null);
  const [device, setDevice] = useState<{ usage: number; quota: number } | null>(null);
  const [open, setOpen] = useState(false);
  const [sort, setSort] = useState<Sort>({ by: "size", desc: true });

  useEffect(() => {
    void offlineSizes().then(setOffline);
    void navigator.storage?.estimate?.().then((e) => e.usage !== undefined && e.quota !== undefined && setDevice({ usage: e.usage, quota: e.quota })).catch(() => {});
  }, []);

  const total = subjects.reduce((n, s) => n + s.bytes, 0);
  const images = subjects.reduce((n, s) => n + s.images, 0);
  const savedInfo = offline ? savedUsage(saved, offline) : null;
  const rows = [...subjects].sort((a, b) => {
    const d = sort.by === "size" ? a.bytes - b.bytes : a.edited - b.edited;
    return sort.desc ? -d : d;
  });
  const sortBy = (by: Sort["by"]) => setSort((s) => (s.by === by ? { by, desc: !s.desc } : { by, desc: true }));
  const arrow = (by: Sort["by"]) => (sort.by === by ? (sort.desc ? " ↓" : " ↑") : "");

  return (
    <div className="storage">
      <div className="storage-lines">
        <div>
          <span>Subjects</span>
          <b>{formatBytes(total)}</b>
          <em>{subjects.length} subject{subjects.length === 1 ? "" : "s"}{images ? ` · pictures ${formatBytes(images)}` : ""}</em>
        </div>
        <div>
          <span>Saved articles</span>
          <b>{savedInfo ? formatBytes(savedInfo.list + savedInfo.copies) : "…"}</b>
          <em>
            {saved.length} saved
            {savedInfo && savedInfo.withCopy > 0 ? ` · ${savedInfo.withCopy} kept for offline reading (${formatBytes(savedInfo.copies)})` : ""}
          </em>
        </div>
        {savedInfo && savedInfo.offlineTotal > savedInfo.copies && (
          <div>
            <span>Other offline copies</span>
            <b>{formatBytes(savedInfo.offlineTotal - savedInfo.copies)}</b>
            <em>Recent stories from your feeds, kept to read without a connection</em>
          </div>
        )}
        {device && (
          <div>
            <span>Offline storage</span>
            <b>{formatBytes(device.usage)}</b>
            <em>Articles kept to read without a connection, and the app&apos;s own files — of {formatBytes(device.quota)} this browser allows</em>
          </div>
        )}
      </div>

      {subjects.length > 0 && (
        <details className="settings-more" open={open} onToggle={(e) => setOpen((e.target as HTMLDetailsElement).open)}>
          <summary>Show each subject</summary>
          <table className="storage-table">
            <thead>
              <tr>
                <th>Subject</th>
                <th className="num"><button onClick={() => sortBy("date")} aria-label="Sort by last edited">Last edited{arrow("date")}</button></th>
                <th className="num"><button onClick={() => sortBy("size")} aria-label="Sort by size">Size{arrow("size")}</button></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((s) => (
                <tr key={s.id}>
                  <td>
                    <div className="storage-name">{s.name}</div>
                    <div className="storage-dim">{s.items} item{s.items === 1 ? "" : "s"}{s.images ? ` · pictures ${formatBytes(s.images)}` : ""}</div>
                  </td>
                  <td className="num storage-dim">{new Date(s.edited).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}</td>
                  <td className="num"><b>{formatBytes(s.bytes)}</b></td>
                </tr>
              ))}
            </tbody>
          </table>
        </details>
      )}
    </div>
  );
}
