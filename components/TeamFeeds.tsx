"use client";

import { useState } from "react";
import { Icon } from "./icons";
import type { TeamFeed } from "@/lib/store";

/**
 * Setting up team feeds, from inside Settings.
 *
 * A team feed is shared by a connect code, the same shape of secret as a sync
 * code: whoever holds it can read the list and add to it. Nothing else about
 * this device travels with it.
 */
export default function TeamFeeds({
  teams,
  busy,
  onCreate,
  onConnect,
  onLeave,
}: {
  teams: TeamFeed[];
  busy: boolean;
  onCreate: (name: string) => Promise<void>;
  onConnect: (code: string) => Promise<void>;
  onLeave: (code: string) => void;
}) {
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);

  async function run(action: () => Promise<void>, fallback: string) {
    setError(null);
    try {
      await action();
      setName("");
      setCode("");
      setAdding(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : fallback);
    }
  }

  async function copy(value: string) {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(value);
      setTimeout(() => setCopied(null), 1800);
    } catch {
      setError("Couldn't copy — select the code and copy it manually.");
    }
  }

  return (
    <div className="teams">
      {teams.length > 0 && (
        <ul className="team-list">
          {teams.map((team) => (
            <li key={team.code}>
              <div className="team-row">
                <span className="team-name">
                  {Icon.people} {team.name}
                </span>
                <button className="link-btn danger" onClick={() => onLeave(team.code)}>
                  Leave
                </button>
              </div>
              <div className="code-row">
                <code className="sync-code">{team.code}</code>
                <button className="btn small" onClick={() => copy(team.code)}>
                  {copied === team.code ? "Copied" : "Copy"}
                </button>
              </div>
              <p className="hint">
                Anyone you give this code to can read and add to{" "}
                <strong>{team.name}</strong>.
              </p>
            </li>
          ))}
        </ul>
      )}

      {adding || teams.length === 0 ? (
        <>
          <p className="field-label reading-label">Create a team feed</p>
          <div className="row">
            <input
              className="input"
              placeholder="Team name"
              value={name}
              maxLength={60}
              onChange={(event) => setName(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && name.trim()) {
                  run(() => onCreate(name.trim()), "Could not create that team feed");
                }
              }}
            />
            <button
              className="btn small"
              disabled={busy || !name.trim()}
              onClick={() => run(() => onCreate(name.trim()), "Could not create that team feed")}
            >
              Create
            </button>
          </div>
          <p className="hint">
            Makes an empty shared list and a code to hand out. Only the articles
            saved to it are shared — never your own feeds, saved articles or
            what you have read.
          </p>

          <div className="divider">
            <span>or</span>
          </div>

          <p className="field-label">Join with a connect code</p>
          <div className="row">
            <input
              className="input"
              placeholder="XXXXX-XXXXX-XXXXX-XXXXX"
              value={code}
              onChange={(event) => setCode(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  run(() => onConnect(code), "Could not join that team feed");
                }
              }}
            />
            <button
              className="btn small"
              disabled={busy || code.trim().length < 8}
              onClick={() => run(() => onConnect(code), "Could not join that team feed")}
            >
              Join
            </button>
          </div>
          {teams.length > 0 && (
            <button className="link-btn team-cancel" onClick={() => setAdding(false)}>
              Cancel
            </button>
          )}
        </>
      ) : (
        <button className="btn ghost small team-add" onClick={() => setAdding(true)}>
          {Icon.plus} Add or create a team feed
        </button>
      )}

      {error && <p className="error">{error}</p>}
    </div>
  );
}
