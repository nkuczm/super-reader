"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { FLAGS_EVENT, flagsAsText, loadFlags, removeFlag, updateFlag, type Flag } from "@/lib/flags";
import { Icon } from "./icons";

const KIND: Record<Flag["kind"], string> = {
  "fact-check": "Fact check",
  production: "Production prep",
  omissions: "Worth considering",
  insight: "Insight",
  reading: "Suggested reading",
  "transcript-search": "Transcript search",
};

/** The flagged AI results, newest first, to read through and send on for tuning. */
export default function FlagsDialog({ onClose }: { onClose: () => void }) {
  const [flags, setFlags] = useState<Flag[]>(() => loadFlags());
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    const reload = () => setFlags(loadFlags());
    window.addEventListener(FLAGS_EVENT, reload);
    const esc = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", esc);
    return () => {
      window.removeEventListener(FLAGS_EVENT, reload);
      window.removeEventListener("keydown", esc);
    };
  }, [onClose]);
  const newest = [...flags].sort((a, b) => b.at - a.at);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(flagsAsText(newest));
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard refused */
    }
  };
  const download = () => {
    const url = URL.createObjectURL(new Blob([JSON.stringify(newest, null, 2)], { type: "application/json" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `flagged-ai-results-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return createPortal(
    <div className="overlay" onMouseDown={onClose}>
      <div className="dialog flags-dialog" role="dialog" aria-modal="true" aria-label="Flagged AI results" onMouseDown={(e) => e.stopPropagation()}>
        <div className="dialog-head">
          <button className="dialog-close" aria-label="Close" onClick={onClose}>{Icon.close}</button>
          <h2>Flagged AI results</h2>
          <p>Each one keeps what the AI said and what it was looking at. Copy them into a conversation to tune the prompts.</p>
        </div>
        <div className="dialog-body">
          <div className="flags-actions">
            <button className="btn small" disabled={!flags.length} onClick={() => void copy()}>{copied ? "Copied ✓" : "Copy all as text"}</button>
            <button className="btn ghost small" disabled={!flags.length} onClick={download}>Download (JSON)</button>
          </div>
          {newest.length === 0 && <p className="field-note">Nothing flagged yet. Use the ⚑ on any AI result — a fact-check finding, an insight, a suggestion, a search result.</p>}
          {newest.map((f) => (
            <div key={f.id} className="flag-item">
              <div className="flag-meta">
                <b>{KIND[f.kind]}</b>
                <span>{new Date(f.at).toLocaleString()}</span>
                {f.subject && <span>{f.subject}</span>}
                {f.model && <span>{f.model}</span>}
                <button className="link-btn flag-remove" onClick={() => removeFlag(f.id)}>Remove</button>
              </div>
              {f.context.map((c, i) => (
                <p key={i} className="flag-context"><span>{c.label}</span>{c.text}</p>
              ))}
              <p className="flag-output"><span>AI said</span>{f.output}</p>
              {f.links && f.links.length > 0 && (
                <p className="flag-context"><span>Sources</span>
                  {f.links.map((l, i) => (
                    <span key={i} className="flag-link">{l.url ? <a href={l.url} target="_blank" rel="noopener noreferrer">{l.title}</a> : l.title}</span>
                  ))}
                </p>
              )}
              <textarea className="input flag-note" rows={2} placeholder="Your note on this result…" defaultValue={f.note ?? ""}
                onBlur={(e) => e.target.value !== (f.note ?? "") && updateFlag(f.id, { note: e.target.value.trim() })} />
            </div>
          ))}
        </div>
      </div>
    </div>,
    document.body,
  );
}
