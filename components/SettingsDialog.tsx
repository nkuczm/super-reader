"use client";

import ApiKeys from "./ApiKeys";
import TeamFeeds from "./TeamFeeds";
import { Icon } from "./icons";
import { useEffect, useState } from "react";
import { costAt, DEFAULT_QUICK_MODEL, MODEL_CHOICES, monthlyUsage, TIERS, TYPICAL_RUN, type Tier } from "@/lib/models";
import { formatDollars, loadSpend, type AiProvider } from "@/lib/spend";
import { encodeKeysHeader, KEYS_HEADER } from "@/lib/vault";
import { FLAGS_EVENT, loadFlags } from "@/lib/flags";
import FlagsDialog from "./FlagsDialog";
import StorageSection from "./StorageSection";
import DbUsageSection from "./DbUsageSection";
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
  onOpenStatus,
  onOpenSpend,
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
    result?: { saved: number; failed: number; skipped?: number };
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
  onOpenStatus: () => void;
  onOpenSpend: () => void;
}) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  const [flagsOpen, setFlagsOpen] = useState(false);
  const [tab, setTabState] = useState<SettingsTab>(() => {
    try {
      const held = localStorage.getItem(TAB_KEY) as SettingsTab | null;
      return SETTINGS_TABS.some((t) => t.id === held) ? held! : "reading";
    } catch {
      return "reading";
    }
  });
  const setTab = (next: SettingsTab) => {
    setTabState(next);
    try { localStorage.setItem(TAB_KEY, next); } catch { /* not remembered */ }
  };
  const [flagCount, setFlagCount] = useState(0);
  useEffect(() => {
    const count = () => setFlagCount(loadFlags().length);
    count();
    window.addEventListener(FLAGS_EVENT, count);
    return () => window.removeEventListener(FLAGS_EVENT, count);
  }, []);

  return (
    <div className="overlay" onMouseDown={() => !flagsOpen && onClose()}>
      {flagsOpen && <FlagsDialog onClose={() => setFlagsOpen(false)} />}
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
        </div>

        <div className="dialog-body">
          <div className="settings-tabs" role="tablist" aria-label="Settings sections">
            {SETTINGS_TABS.map((t) => (
              <button key={t.id} role="tab" aria-selected={tab === t.id} className={tab === t.id ? "on" : ""} onClick={() => setTab(t.id)}>
                {t.name}
              </button>
            ))}
          </div>

          {tab === "reading" && (
            <>
            <p className="field-label">Layout</p>
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

            <p className="field-label reading-label">Sources</p>
            <div className="settings-links">
              <button className="btn ghost small" onClick={onOpenStatus}>Source status</button>
              <a className="btn ghost small" href="/extension" target="_blank" rel="noopener">Chrome extension</a>
            </div>
            <p className="field-note">Which sources are delivering, which look broken or are losing access.</p>
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
                <em>The download otherwise runs quietly on every visit.</em>
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
                  <details className="settings-more">
                    <summary>How offline reading works</summary>
                    The newest 15 stories from each source, plus everything in
                    Saved, are kept on this device so you can read them without a
                    connection. Anything missing is fetched whenever the app is
                    open, so an interrupted download finishes itself; the full
                    refresh runs on the first visit after 7am and after 4pm ET.
                    Downloaded articles carry a blue check in the list.{" "}
                    {persisted
                      ? "This browser has agreed to keep the cache."
                      : "This browser may clear the cache when space is short — adding the app to your Home Screen usually prevents that."}
                  </details>
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

            </>
          )}

          {tab === "subjects" && (
            <>
            <p className="field-label">Notes</p>
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
                <em>Selecting text in an article offers <strong>Add to note</strong>, word for word.</em>
              </span>
            </label>
            <p className="field-note">
              {noteCount === 0
                ? "Notes live in the sidebar, beside your feeds. Make one with New note, or straight from your first highlight."
                : `${noteCount} note${noteCount === 1 ? "" : "s"} in the sidebar. Turning this off leaves them there; it only stops highlighting from offering to quote.`}
            </p>

            <p className="field-label reading-label">Subjects</p>
            <label className="check-row">
              <input
                type="checkbox"
                checked={settings.subjects}
                onChange={(event) =>
                  onChange({ ...settings, subjects: event.target.checked })
                }
              />
              <span>
                Subjects
                <em>Each note becomes a subject: story cards, text boxes, tables, transcripts, a whiteboard, and AI tools.</em>
              </span>
            </label>

            {settings.subjects && (
              <label className="check-row">
                <input
                  type="checkbox"
                  checked={settings.hideSubjectBoxes}
                  onChange={(event) => onChange({ ...settings, hideSubjectBoxes: event.target.checked })}
                />
                <span>
                  Hide boxes in subjects
                  <em>The document view reads as one page; borders come back when you point at a box.</em>
                </span>
              </label>
            )}

            {settings.subjects && (
              <div className="box-width-setting">
                <p className="field-note" style={{ marginTop: 0 }}>
                  Text box width
                  <span className="box-width-value">{settings.textBoxWidth ? `${settings.textBoxWidth}px` : "Default"}</span>
                </p>
                <div className="box-width-controls">
                  <input
                    type="range"
                    min={160}
                    max={760}
                    step={20}
                    aria-label="Text box width"
                    value={settings.textBoxWidth || 280}
                    onChange={(event) => onChange({ ...settings, textBoxWidth: Number(event.target.value) })}
                  />
                  <button type="button" className="link-btn" disabled={!settings.textBoxWidth}
                    onClick={() => onChange({ ...settings, textBoxWidth: 0 })}>
                    Reset
                  </button>
                </div>
                <details className="settings-more">
                  <summary>Preview</summary>
                <div className="box-width-preview" aria-hidden="true">
                  <div className="box-width-sample" style={{ width: settings.textBoxWidth ? `min(${settings.textBoxWidth}px, 100%)` : "100%" }}>
                    <b>Interview notes</b>
                    <p>
                      She said the plant would close by spring. Two suppliers have already stopped deliveries, and
                      the union meets on Thursday.
                    </p>
                  </div>
                </div>
                <p className="field-note">
                  New whiteboard boxes start this wide; document boxes are no wider. Default: full column, 280px on the whiteboard.
                </p>
                </details>
              </div>
            )}


            </>
          )}

          {tab === "ai" && (
            <>
            {!settings.subjects && (
              <p className="field-note" style={{ marginTop: 0 }}>
                The AI tools work inside subjects. <button className="link-btn" onClick={() => setTab("subjects")}>Turn on Subjects</button> to use them.
              </p>
            )}
            {settings.subjects && (
              <div className="ai-choice">
                <p className="field-label" style={{ marginTop: 0 }}>Provider</p>
                <div className="seg" role="radiogroup" aria-label="AI provider">
                  {(["anthropic", "openai"] as const).map((provider) => (
                    <button
                      key={provider}
                      role="radio"
                      aria-checked={settings.aiProvider === provider}
                      className={settings.aiProvider === provider ? "on" : ""}
                      onClick={() => onChange({ ...settings, aiProvider: provider })}
                    >
                      {provider === "anthropic" ? "Claude (Anthropic)" : "OpenAI"}
                    </button>
                  ))}
                </div>
                <p className="field-note">
                  {apiKeys[settings.aiProvider]
                    ? `Using your ${settings.aiProvider === "openai" ? "OpenAI" : "Anthropic"} key.`
                    : <>No {settings.aiProvider === "openai" ? "OpenAI" : "Anthropic"} key yet — <button className="link-btn" onClick={() => setTab("account")}>add one under Account</button>.</>}
                </p>
                <p className="field-label reading-label">Models</p>
                {(["deep", "quick"] as const).map((tier) => {
                  const openai = settings.aiProvider === "openai";
                  const key = tier === "deep" ? (openai ? "openaiModel" : "anthropicModel") : (openai ? "openaiQuickModel" : "anthropicQuickModel");
                  return (
                    <ModelPicker key={`${tier}-${settings.aiProvider}`} tier={tier}
                      provider={settings.aiProvider}
                      value={settings[key]}
                      onChange={(id) => onChange({ ...settings, [key]: id })}
                      openaiKey={apiKeys.openai}
                    />
                  );
                })}
                <p className="field-label reading-label">Usage</p>
                <div className="settings-links">
                  <button className="btn ghost small" onClick={onOpenSpend}>AI spending</button>
                  <button className="btn ghost small" onClick={() => setFlagsOpen(true)}>
                    Flagged AI results{flagCount ? ` (${flagCount})` : ""}
                  </button>
                </div>
              </div>
            )}

            </>
          )}

          {tab === "account" && (
            <>
              <p className="field-label">Storage</p>
              <StorageSection />

              <p className="field-label reading-label">Database usage</p>
              <DbUsageSection />

            <p className="field-label reading-label">API keys &amp; subscriptions</p>
            <ApiKeys vault={vault} keys={apiKeys} onChange={onKeysChange} />

            <p className="field-label reading-label">Team feeds</p>
            <p className="field-note" style={{ marginTop: 0, marginBottom: 10 }}>
              A shared list beside Saved: the <strong>Team</strong> button on a story adds it for everyone.
            </p>
            <TeamFeeds
              teams={teams}
              busy={teamsBusy}
              onCreate={onCreateTeam}
              onConnect={onJoinTeam}
              onLeave={onLeaveTeam}
            />


            </>
          )}
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

/** The settings, in four places: how stories read, how subjects work, the AI, and the account. */
type SettingsTab = "reading" | "subjects" | "ai" | "account";
const SETTINGS_TABS: { id: SettingsTab; name: string }[] = [
  { id: "reading", name: "Reading" },
  { id: "subjects", name: "Subjects" },
  { id: "ai", name: "AI" },
  { id: "account", name: "Account" },
];
const TAB_KEY = "super-reader:settings-tab";

/**
 * The model, chosen by what it is like rather than by its name, with what
 * each would cost a month at the pace this device has been using AI.
 */
function ModelPicker({ tier, provider, value, onChange, openaiKey }: {
  tier: Tier;
  provider: AiProvider;
  value: string;
  onChange: (id: string) => void;
  openaiKey?: string;
}) {
  const [usage] = useState(() => monthlyUsage(loadSpend(), Date.now(), tier));
  const [open, setOpen] = useState(false);
  const defaultId = tier === "quick" ? DEFAULT_QUICK_MODEL[provider] : MODEL_CHOICES[provider].find((m) => m.recommended)?.id;
  // What the reader's own OpenAI key can run, so newer models appear only when they will work.
  const [available, setAvailable] = useState<Set<string> | null>(null);
  useEffect(() => {
    if (provider !== "openai" || !openaiKey) return;
    let live = true;
    fetch("/api/subjects/models", { headers: { [KEYS_HEADER]: encodeKeysHeader({ openai: openaiKey }) } })
      .then((r) => r.json())
      .then((d: { models?: string[] | null }) => live && d.models && setAvailable(new Set(d.models)))
      .catch(() => {});
    return () => { live = false; };
  }, [provider, openaiKey]);
  const offered = MODEL_CHOICES[provider].filter((m) => !m.unconfirmed || available?.has(m.id) || m.id === value);
  const current = offered.find((m) => m.id === value) ?? offered.find((m) => m.id === defaultId);
  const choices = open ? offered : offered.filter((m) => m === current);
  const known = choices.some((m) => m.id === value);
  const [custom, setCustom] = useState(!known && provider === "openai");
  const basis = usage.runs > 0 ? usage : null;
  return (
    <div className="model-pick" role="radiogroup" aria-label={`${TIERS[tier].name} model`}>
      <div className="model-tier">
        <b>{TIERS[tier].name}</b>
        <span>{TIERS[tier].blurb}</span>
        <button className="link-btn" onClick={() => setOpen((v) => !v)}>{open ? "Done" : "Change"}</button>
      </div>
      {choices.map((m) => {
        const on = !custom && m === current;
        const cost = basis ? costAt(m, basis) : costAt(m, TYPICAL_RUN[tier]);
        return (
          <button key={m.id} role="radio" aria-checked={on} className={`model-option${on ? " on" : ""}`}
            onClick={() => { setCustom(false); onChange(m.id); setOpen(false); }}>
            <span className="model-name">{m.name}{m.id === defaultId && <span className="model-tag">Default</span>}</span>
            <span className="model-blurb">{m.blurb}</span>
            <span className="model-cost">
              <b>{basis ? `≈ ${formatDollars(cost)}/month` : `≈ ${formatDollars(cost)} per ${tier === "deep" ? "insights run" : "search"}`}</b>
              <span>${m.input} in · ${m.output} out per million tokens</span>
            </span>
          </button>
        );
      })}
      {provider === "openai" && (open || custom) && (
        custom ? (
          <label className="api-field">
            <span>Another OpenAI model, by name</span>
            <input className="input" autoFocus value={known ? "" : value} placeholder="e.g. gpt-5-pro"
              onChange={(e) => onChange(e.target.value)} />
          </label>
        ) : (
          <button className="link-btn model-other" onClick={() => setCustom(true)}>Use another OpenAI model…</button>
        )
      )}
      {open && <p className="field-note model-basis">
        {basis
          ? `Estimates use your pace on this device for these tools: about ${basis.runs} run${basis.runs === 1 ? "" : "s"} a month${usage.days < 30 ? `, from ${Math.max(1, usage.days)} day${usage.days === 1 ? "" : "s"} of use` : ""}. Real bills vary with how long subjects and scripts are.`
          : "No use of these tools recorded on this device yet, so costs are shown per typical run. Fact-checks of long scripts cost several times more."}
      </p>}
    </div>
  );
}
