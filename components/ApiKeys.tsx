"use client";

import { useEffect, useState } from "react";
import type { ApiCatalogEntry } from "@/lib/apis";
import {
  decryptVault,
  encryptVault,
  isVaultBlob,
  WrongPassphrase,
  type Secrets,
} from "@/lib/vault";
import {
  SUB_PREFIX,
  knownRefusal,
  normaliseHost,
  subscriptionId,
  subscriptionsIn,
  tidyCookie,
} from "@/lib/subscriptions";
import { Icon } from "./icons";

type Props = {
  /** The encrypted vault as it stands, or null if there is not one yet. */
  vault: unknown | null;
  /** The keys in use on this device, empty when locked or unset. */
  keys: Secrets;
  onChange: (next: { vault: unknown | null; keys: Secrets }) => void;
};

/**
 * API keys, encrypted with a passphrase before they are allowed to sync.
 *
 * The server never sees a key: it receives the encrypted blob it cannot read,
 * and, for a request that calls an API, the key itself in a header which it
 * uses once and keeps nothing of. That is what makes "my key" mean anything on
 * a deployment anyone can open.
 */
export default function ApiKeys({ vault, keys, onChange }: Props) {
  const [apis, setApis] = useState<ApiCatalogEntry[]>([]);
  const [draft, setDraft] = useState<Secrets>(keys);
  const [passphrase, setPassphrase] = useState("");
  const [confirmPassphrase, setConfirmPassphrase] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [newSite, setNewSite] = useState("");
  const [newCookie, setNewCookie] = useState("");

  /**
   * What is in the fields versus what is actually stored. Without this the
   * panel cannot answer the only question it is ever asked — did that save?
   */
  const trimmed: Secrets = {};
  for (const [id, value] of Object.entries(draft)) {
    if (value.trim()) trimmed[id] = value.trim();
  }
  const dirty = JSON.stringify(trimmed) !== JSON.stringify(keys);

  const locked = isVaultBlob(vault) && Object.keys(keys).length === 0;

  useEffect(() => {
    fetch("/api/apis")
      .then((res) => res.json())
      .then((data) => setApis((data.apis as ApiCatalogEntry[]).filter((a) => a.keyNote)))
      .catch(() => setError("Could not load the list of APIs."));
  }, []);

  async function unlock() {
    setBusy(true);
    setError(null);
    try {
      const secrets = await decryptVault(vault as never, passphrase);
      setDraft(secrets);
      onChange({ vault, keys: secrets });
      // The passphrase stays in memory for this session: asking for it again
      // on the next edit is what made saving feel like it had not worked.
    } catch (err) {
      setError(
        err instanceof WrongPassphrase
          ? "That passphrase does not unlock these keys."
          : "Could not open the vault.",
      );
    } finally {
      setBusy(false);
    }
  }

  async function save() {
    const first = !isVaultBlob(vault);
    if (!passphrase) {
      setError(
        first
          ? "Choose a passphrase to protect these keys."
          : "Enter your passphrase to save this change.",
      );
      return;
    }
    if (first && passphrase !== confirmPassphrase) {
      setError("The two passphrases do not match.");
      return;
    }
    if (first && passphrase.length < 8) {
      setError("Use at least 8 characters — this is the only thing protecting the keys.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      // Re-encrypting everything on each save keeps one copy of the truth;
      // there is no separate "changed" list to fall out of step.
      const blob = await encryptVault(trimmed, passphrase);
      onChange({ vault: blob, keys: trimmed });
      setConfirmPassphrase("");
      setSavedAt(Date.now());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save the keys.");
    } finally {
      setBusy(false);
    }
  }

  if (locked) {
    return (
      <div className="offline-box">
        <div className="offline-status">
          <strong>Keys and subscriptions are locked</strong>
          <span>
            They synced from another device. Enter the passphrase to use them
            here — it never leaves this browser.
          </span>
        </div>
        <div className="row" style={{ marginTop: 11 }}>
          <input
            className="input"
            type="password"
            placeholder="Passphrase"
            value={passphrase}
            onChange={(event) => setPassphrase(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && passphrase) void unlock();
            }}
          />
          <button className="btn small" disabled={busy || !passphrase} onClick={unlock}>
            {busy ? <span className="spinner" /> : "Unlock"}
          </button>
        </div>
        {error && <p className="error">{error}</p>}
      </div>
    );
  }

  return (
    <div className="offline-box">
      <div className="offline-status">
        <strong>
          {Object.keys(keys).length > 0
            ? `${Object.keys(keys).length} saved`
            : "Nothing saved yet"}
          {dirty ? (
            <em className="badge warn">unsaved changes</em>
          ) : savedAt ? (
            <em className="badge ok">{Icon.check} saved</em>
          ) : null}
        </strong>
        <span>
          Encrypted with your passphrase in this browser before it syncs, so
          the server stores bytes it cannot read. A key is sent only with the
          request that calls that API, and is never stored on the server.
        </span>
      </div>

      {apis.map((api) => (
        <label key={api.id} className="api-field" style={{ marginTop: 10 }}>
          <span>
            {api.name}
            {keys[api.id] && <em className="badge">set</em>}
          </span>
          <input
            className="input"
            type="password"
            autoComplete="off"
            placeholder={api.ready && !api.keyNote ? "Set on the deployment" : "Paste your key"}
            value={draft[api.id] ?? ""}
            onChange={(event) =>
              setDraft((current) => ({ ...current, [api.id]: event.target.value }))
            }
          />
          <small>{api.keyNote}</small>
        </label>
      ))}

      <p className="field-label reading-label">Subscriptions</p>
      <div className="offline-status">
        <span>
          Outlets you pay for have no full-text feed: to anyone who is not
          signed in they serve a headline and a wall. Paste the cookie your
          browser holds for one and the reader signs in as you when it fetches
          an article from that site — and only that site. It is encrypted with
          the same passphrase, sent with the one request that needs it, and
          never stored on the server or cached where anyone else could be
          handed it.
        </span>
      </div>

      {subscriptionsIn(draft).map(({ host }) => (
        <label key={host} className="api-field" style={{ marginTop: 10 }}>
          <span>
            {host}
            <em className="badge">saved</em>
            <button
              className="link-btn danger"
              style={{ marginLeft: "auto" }}
              onClick={() =>
                setDraft((current) => {
                  const next = { ...current };
                  delete next[subscriptionId(host)];
                  return next;
                })
              }
            >
              Remove
            </button>
          </span>
          {knownRefusal(host) && (
            <small className="sub-warn">{knownRefusal(host)}</small>
          )}
          <input
            className="input"
            type="password"
            autoComplete="off"
            value={draft[subscriptionId(host)] ?? ""}
            onChange={(event) =>
              setDraft((current) => ({
                ...current,
                [subscriptionId(host)]: event.target.value,
              }))
            }
          />
        </label>
      ))}

      <label className="api-field" style={{ marginTop: 10 }}>
        <span>Add a subscription</span>
        <input
          className="input"
          placeholder="wsj.com"
          autoComplete="off"
          value={newSite}
          onChange={(event) => setNewSite(event.target.value)}
        />
        <input
          className="input"
          type="password"
          style={{ marginTop: 6 }}
          placeholder="Paste the cookie for that site"
          autoComplete="off"
          value={newCookie}
          onChange={(event) => setNewCookie(event.target.value)}
        />
        <div className="api-actions" style={{ marginTop: 6 }}>
          <button
            className="btn ghost small"
            disabled={!normaliseHost(newSite) || !tidyCookie(newCookie)}
            onClick={() => {
              const host = normaliseHost(newSite);
              const cookie = tidyCookie(newCookie);
              if (!host || !cookie) return;
              setDraft((current) => ({ ...current, [`${SUB_PREFIX}${host}`]: cookie }));
              setNewSite("");
              setNewCookie("");
            }}
          >
            {Icon.plus} Add
          </button>
        </div>
        {knownRefusal(newSite) && (
          <small className="sub-warn">{knownRefusal(newSite)}</small>
        )}
        <small>
          In the outlet&rsquo;s tab while signed in, open dev tools →
          Application → Cookies and copy the whole row. Not{" "}
          <code>document.cookie</code> — the session cookie that carries a
          subscription is usually HttpOnly, which that leaves out. A sign-in
          expires after a few weeks; when an article says the subscription did
          not apply, paste a fresh one.
        </small>
      </label>

      <label className="api-field">
        <span>Passphrase</span>
        <input
          className="input"
          type="password"
          autoComplete="new-password"
          placeholder={isVaultBlob(vault) ? "Your passphrase" : "Choose one, 8+ characters"}
          value={passphrase}
          onChange={(event) => setPassphrase(event.target.value)}
        />
        {!isVaultBlob(vault) && (
          <input
            className="input"
            type="password"
            autoComplete="new-password"
            placeholder="Repeat it"
            style={{ marginTop: 6 }}
            value={confirmPassphrase}
            onChange={(event) => setConfirmPassphrase(event.target.value)}
          />
        )}
        <small>
          {isVaultBlob(vault)
            ? "Needed to save a change, and to unlock these keys on another device."
            : "There is no way to recover this. Forgetting it means entering the keys again, which is the cost of the server not being able to read them."}
        </small>
      </label>

      {error && <p className="error">{error}</p>}

      <div className="api-actions">
        {Object.keys(keys).length > 0 && (
          <button
            className="link-btn danger"
            onClick={() => {
              setDraft({});
              onChange({ vault: null, keys: {} });
              setSavedAt(null);
            }}
          >
            Remove everything
          </button>
        )}
        <button className="btn small" disabled={busy || !dirty} onClick={save}>
          {busy ? <span className="spinner" /> : Icon.check}
          {dirty ? "Save" : "Saved"}
        </button>
      </div>
    </div>
  );
}
