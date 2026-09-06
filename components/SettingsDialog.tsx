"use client";

import { useEffect } from "react";
import type { Settings, ViewMode } from "@/lib/store";

const VIEWS: { id: ViewMode; name: string; blurb: string }[] = [
  {
    id: "magazine",
    name: "Magazine",
    blurb: "Bigger image on the left of each story.",
  },
  {
    id: "cards",
    name: "Cards",
    blurb: "Small thumbnail beside the headline.",
  },
  {
    id: "list",
    name: "List",
    blurb: "Headlines only, no images. Most on screen at once.",
  },
];

/** A small drawing of each layout, so the choice is obvious before picking. */
function Preview({ view }: { view: ViewMode }) {
  if (view === "magazine") {
    return (
      <div className="vp vp-magazine" aria-hidden="true">
        <span className="vp-img" />
        <div className="vp-col">
          <span className="vp-line w80" />
          <span className="vp-line w60 dim" />
          <span className="vp-line w70 dim" />
        </div>
      </div>
    );
  }
  if (view === "cards") {
    return (
      <div className="vp vp-cards" aria-hidden="true">
        <div className="vp-col">
          <span className="vp-line w80" />
          <span className="vp-line w55 dim" />
          <span className="vp-line w65 dim" />
        </div>
        <span className="vp-thumb" />
      </div>
    );
  }
  return (
    <div className="vp vp-list" aria-hidden="true">
      <span className="vp-line w85" />
      <span className="vp-line w70" />
      <span className="vp-line w78" />
      <span className="vp-line w60" />
    </div>
  );
}

export default function SettingsDialog({
  settings,
  onChange,
  onClose,
  offline,
  storedCount,
  onDownload,
}: {
  settings: Settings;
  onChange: (next: Settings) => void;
  onClose: () => void;
  /** How many articles are on this device right now. */
  storedCount: number;
  offline: {
    state: "idle" | "working" | "done" | "error";
    done?: number;
    total?: number;
    at?: number | null;
    result?: { saved: number; failed: number };
  };
  onDownload: () => void;
}) {
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
        aria-label="Settings"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="dialog-head">
          <h2>Settings</h2>
          <p>How your articles are laid out on this device.</p>
        </div>

        <div className="dialog-body">
          <p className="field-label">View</p>
          <div className="view-grid" role="radiogroup" aria-label="View">
            {VIEWS.map((view) => (
              <button
                key={view.id}
                role="radio"
                aria-checked={settings.view === view.id}
                className={`view-option ${settings.view === view.id ? "selected" : ""}`}
                onClick={() => onChange({ ...settings, view: view.id })}
              >
                <Preview view={view.id} />
                <strong>{view.name}</strong>
                <span>{view.blurb}</span>
              </button>
            ))}
          </div>

          <p className="field-label reading-label">Reading</p>
          <label className="check-row">
            <input
              type="checkbox"
              checked={settings.hideRead}
              onChange={(event) =>
                onChange({ ...settings, hideRead: event.target.checked })
              }
            />
            <span>
              Hide articles I&rsquo;ve opened
              <em>Otherwise they stay in the list, dimmed.</em>
            </span>
          </label>
        </div>

          {settings.openOnSite.length > 0 && (
            <>
              <p className="field-label reading-label">Opened on their site</p>
              <p className="hint" style={{ marginTop: 0, marginBottom: 10 }}>
                These skip reader view, because their text is only served to a
                browser that is signed in.
              </p>
              <ul className="host-list">
                {settings.openOnSite.map((host) => (
                  <li key={host}>
                    <span>{host}</span>
                    <button
                      className="link-btn"
                      onClick={() =>
                        onChange({
                          ...settings,
                          openOnSite: settings.openOnSite.filter(
                            (h) => h !== host,
                          ),
                        })
                      }
                    >
                      Try reader view again
                    </button>
                  </li>
                ))}
              </ul>
            </>
          )}

          <p className="field-label reading-label">Offline</p>
          <div className="offline-box">
            <div className="offline-status">
              <strong>
                {offline.state === "working"
                  ? `Downloading… ${offline.done ?? 0} of ${offline.total ?? 0}`
                  : offline.state === "error"
                    ? "Download didn't finish"
                    : offline.at
                      ? `Saved ${new Date(offline.at).toLocaleString(undefined, {
                          month: "short",
                          day: "numeric",
                          hour: "numeric",
                          minute: "2-digit",
                        })}`
                      : "Nothing downloaded yet"}
              </strong>
              <span>
                {/* The count is the answer to "is this actually working?" —
                    a run that saved nothing used to look the same as one that
                    saved everything. */}
                <strong className="offline-count">
                  {storedCount} article{storedCount === 1 ? "" : "s"} on this
                  device
                </strong>
                {offline.result && (
                  <>
                    {" · "}
                    {offline.result.saved} saved
                    {offline.result.failed > 0 &&
                      `, ${offline.result.failed} unavailable`}{" "}
                    last run
                  </>
                )}
                <br />
                The newest 15 stories from each source, plus everything in
                Saved, are kept on this device so you can read them without a
                connection. This happens on your first visit after 7am and
                after 4pm ET. Downloaded articles carry a blue check in the
                list.
              </span>
            </div>
            <button
              className="btn ghost small offline-btn"
              onClick={onDownload}
              disabled={offline.state === "working"}
            >
              {offline.state === "working" ? <span className="spinner" /> : null}
              Download now
            </button>
          </div>

        <div className="dialog-foot">
          {/* Which build this is, so "has it updated?" is answerable. */}
          <span className="build-stamp">
            {(process.env.NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA ?? "local").slice(0, 7)}
          </span>
          <button className="btn ghost small" onClick={onClose}>
            Done
          </button>
        </div>
      </div>
    </div>
  );
}
