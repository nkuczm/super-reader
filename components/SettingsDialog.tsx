"use client";

import ApiKeys from "./ApiKeys";
import TeamFeeds from "./TeamFeeds";
import { Icon } from "./icons";
import { useEffect } from "react";
import type { Settings, TeamFeed, ViewMode } from "@/lib/store";

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
  targetCount,
  persisted,
  vault,
  apiKeys,
  onKeysChange,
  onDownload,
  noteCount,
  teams,
  teamsBusy,
  onCreateTeam,
  onJoinTeam,
  onLeaveTeam,
}: {
  settings: Settings;
  onChange: (next: Settings) => void;
  onClose: () => void;
  /** How many articles are on this device right now, and how many are wanted. */
  storedCount: number;
  targetCount: number;
  /** Whether the browser agreed to keep this cache rather than evict it. */
  persisted: boolean;
  vault: unknown | null;
  apiKeys: Record<string, string>;
  onKeysChange: (next: { vault: unknown | null; keys: Record<string, string> }) => void;
  offline: {
    state: "idle" | "working" | "done" | "error";
    done?: number;
    total?: number;
    at?: number | null;
    result?: { saved: number; failed: number };
  };
  onDownload: () => void;
  /** How many notes exist, so the switch can say what it is switching off. */
  noteCount: number;
  /** The team feeds this device is connected to. */
  teams: TeamFeed[];
  teamsBusy: boolean;
  onCreateTeam: (name: string) => Promise<void>;
  onJoinTeam: (code: string) => Promise<void>;
  onLeaveTeam: (code: string) => void;
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
          <button
            className="dialog-close"
            aria-label="Close"
            onClick={onClose}
          >
            {Icon.close}
          </button>
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

          <p className="field-label reading-label">Big stories</p>
          <div
            className="scope-switch metric-switch"
            role="radiogroup"
            aria-label="What the circle beside a big story shows"
          >
            <button
              role="radio"
              aria-checked={settings.bigStoryMetric === "score"}
              className={settings.bigStoryMetric === "score" ? "on" : ""}
              onClick={() => onChange({ ...settings, bigStoryMetric: "score" })}
            >
              Score /100
            </button>
            <button
              role="radio"
              aria-checked={settings.bigStoryMetric === "newsrooms"}
              className={settings.bigStoryMetric === "newsrooms" ? "on" : ""}
              onClick={() => onChange({ ...settings, bigStoryMetric: "newsrooms" })}
            >
              Newsrooms
            </button>
          </div>
          <p className="field-note">
            Tap the circle on any article to see how the number was worked out.
          </p>

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

          <p className="field-label reading-label">Notes</p>
          <label className="check-row">
            <input
              type="checkbox"
              checked={settings.quoteToNote}
              onChange={(event) =>
                onChange({ ...settings, quoteToNote: event.target.checked })
              }
            />
            <span>
              Highlight text to quote it into a note
              <em>
                Selecting text in an article offers <strong>Add to note</strong>.
                The quote is kept word for word, and the article is saved with
                it so it is still there later.
              </em>
            </span>
          </label>
          <p className="field-note">
            {noteCount === 0
              ? "Notes live in the sidebar, beside your feeds. Make one with New note, or straight from your first highlight."
              : `${noteCount} note${noteCount === 1 ? "" : "s"} in the sidebar. Turning this off leaves them there; it only stops highlighting from offering to quote.`}
          </p>

          <p className="field-label reading-label">Team feeds</p>
          <p className="hint" style={{ marginTop: 0, marginBottom: 12 }}>
            A shared list that sits beside your saved articles. Save a story to
            it with the <strong>Team</strong> button and everyone on the feed
            sees it.
          </p>
          <TeamFeeds
            teams={teams}
            busy={teamsBusy}
            onCreate={onCreateTeam}
            onConnect={onJoinTeam}
            onLeave={onLeaveTeam}
          />

          <p className="field-label reading-label">API keys</p>
          <ApiKeys vault={vault} keys={apiKeys} onChange={onKeysChange} />

          <p className="field-label reading-label">Offline</p>
          <label className="check-row">
            <input
              type="checkbox"
              checked={settings.showDownloadBar}
              onChange={(event) =>
                onChange({ ...settings, showDownloadBar: event.target.checked })
              }
            />
            <span>
              Show a progress bar while downloading
              <em>
                Off by default. The download runs quietly on every visit; the
                count below says what is on this device.
              </em>
            </span>
          </label>
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
                  {storedCount} of {targetCount} article
                  {targetCount === 1 ? "" : "s"} on this device
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
                connection. Anything missing is fetched whenever the app is
                open, so an interrupted download finishes itself; the full
                refresh runs on the first visit after 7am and after 4pm ET.
                Downloaded articles carry a blue check in the list.
                <br />
                {persisted
                  ? "This browser has agreed to keep the cache."
                  : "This browser may clear the cache when space is short — adding the app to your Home Screen usually prevents that."}
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
