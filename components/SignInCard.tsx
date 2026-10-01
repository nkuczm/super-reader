"use client";

import type { AccountInfo, SaveStatus } from "./useAccount";

const GOOGLE = (
  <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true">
    <path fill="#EA4335" d="M24 9.5c3.5 0 6.6 1.2 9.1 3.6l6.8-6.8C35.8 2.4 30.3 0 24 0 14.6 0 6.6 5.4 2.7 13.3l7.9 6.1C12.5 13.6 17.8 9.5 24 9.5z" />
    <path fill="#4285F4" d="M46.1 24.6c0-1.6-.1-3.1-.4-4.6H24v9h12.4c-.5 2.9-2.2 5.3-4.6 6.9l7.4 5.8c4.3-4 6.9-9.9 6.9-17.1z" />
    <path fill="#FBBC05" d="M10.6 28.6A14.6 14.6 0 0 1 9.5 24c0-1.6.3-3.2.8-4.6l-7.9-6.1A24 24 0 0 0 0 24c0 3.9.9 7.5 2.6 10.7l8-6.1z" />
    <path fill="#34A853" d="M24 48c6.5 0 11.9-2.1 15.9-5.8l-7.4-5.8c-2.1 1.4-4.8 2.3-8.5 2.3-6.2 0-11.5-4.1-13.4-9.8l-8 6.1C6.6 42.6 14.6 48 24 48z" />
  </svg>
);

export function signInHref() {
  return "/api/auth/google";
}

/** What stands in front of Subjects for someone not signed in. */
export default function SignInCard({ onOpenMenu, failed }: { onOpenMenu: () => void; failed?: boolean }) {
  return (
    <section className="signin-page">
      <button className="icon-btn menu-btn signin-menu" onClick={onOpenMenu} aria-label="Open menu">
        ☰
      </button>
      <div className="signin-card">
        <h1>Subjects need a Google sign-in</h1>
        <p>
          Your research is kept with your Google account: encrypted on our server, saved as you type, with every version
          kept, and backed up as Google Docs in your own Drive.
        </p>
        <p className="signin-small">
          Signing in also ties this device&apos;s feeds and sync code to your account. Feeds, saved stories and reading
          work without signing in, as before.
        </p>
        {failed && <p className="signin-error">Sign-in did not complete. Please try again.</p>}
        <a className="signin-btn" href={signInHref()}>
          {GOOGLE} Sign in with Google
        </a>
        <p className="signin-small">
          Super Reader can only see the Docs it creates in your Drive — nothing else there.
        </p>
      </div>
    </section>
  );
}

export function describe(status: SaveStatus, savedAt: number | null) {
  if (status === "saving") return "Saving…";
  if (status === "offline") return "Offline — saved on this device";
  if (status === "error") return "Not saved to your account yet — kept on this device, retrying";
  if (status === "saved" && savedAt) return `Saved ${new Date(savedAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}`;
  if (status === "saved") return "All changes saved";
  return "";
}

/** Who is signed in and whether the work is saved — or an invitation to sign in. */
export function AccountStrip({
  account,
  enabled,
  status,
  savedAt,
  backedUpAt,
  backupProblem,
  onSignOut,
}: {
  account: AccountInfo | null;
  enabled: boolean;
  status: SaveStatus;
  savedAt: number | null;
  backedUpAt: number | null;
  backupProblem?: string | null;
  onSignOut: () => void;
}) {
  if (!enabled) return null;
  if (!account) {
    return (
      <div className="account-strip nudge">
        <span>Sign in with Google to back up your subjects and keep every version.</span>
        <a className="signin-btn small" href={signInHref()}>
          {GOOGLE} Sign in
        </a>
      </div>
    );
  }
  return (
    <div className={`account-strip ${status}`}>
      <span className="account-who" title={account.email}>
        {account.email}
      </span>
      <span className="account-status" role="status">
        {describe(status, savedAt)}
        {backedUpAt ? ` · Backed up to Drive ${new Date(backedUpAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}` : ""}
      </span>
      {backupProblem && <span className="account-problem">{backupProblem}</span>}
      <button className="link-btn" onClick={onSignOut}>
        Sign out
      </button>
    </div>
  );
}
