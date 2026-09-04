"use client";

import { useEffect } from "react";
import type { Settings, ViewMode } from "@/lib/store";

const VIEWS: { id: ViewMode; name: string; blurb: string }[] = [
  {
    id: "magazine",
    name: "Magazine",
    blurb: "Large header image above each story.",
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
        <span className="vp-line w70" />
        <span className="vp-line w45 dim" />
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
}: {
  settings: Settings;
  onChange: (next: Settings) => void;
  onClose: () => void;
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

        <div className="dialog-foot">
          <button className="btn ghost small" onClick={onClose}>
            Done
          </button>
        </div>
      </div>
    </div>
  );
}
