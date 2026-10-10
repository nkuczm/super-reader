/**
 * Google: signing in, and writing backups to the person's own Drive.
 *
 * Sign-in is the standard OAuth authorization-code flow with PKCE, done on the
 * server so the client secret never reaches a browser. The scopes are the
 * smallest that do the job: who you are (openid, email, profile) and
 * drive.file — which lets this app create Google Docs and touch only the
 * files it created, never anything else in the Drive.
 *
 * Plain fetch against Google's documented endpoints; no SDK to carry.
 */

export const GOOGLE_AUTH = "https://accounts.google.com/o/oauth2/v2/auth";
export const GOOGLE_TOKEN = "https://oauth2.googleapis.com/token";
export const SCOPES = ["openid", "email", "profile", "https://www.googleapis.com/auth/drive.file"];

export function googleConfig() {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  return clientId && clientSecret ? { clientId, clientSecret } : null;
}

/** Where Google sends the person back — this deployment's own callback. */
export function redirectUri(request: Request) {
  const url = new URL(request.url);
  const host = request.headers.get("x-forwarded-host") ?? url.host;
  const proto = request.headers.get("x-forwarded-proto") ?? url.protocol.replace(":", "");
  return `${proto}://${host}/api/auth/callback`;
}

export function authUrl(params: { clientId: string; redirectUri: string; state: string; challenge: string }) {
  const url = new URL(GOOGLE_AUTH);
  url.searchParams.set("client_id", params.clientId);
  url.searchParams.set("redirect_uri", params.redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", SCOPES.join(" "));
  url.searchParams.set("state", params.state);
  url.searchParams.set("code_challenge", params.challenge);
  url.searchParams.set("code_challenge_method", "S256");
  // A refresh token, so backups can be written after the tab is closed.
  url.searchParams.set("access_type", "offline");
  url.searchParams.set("prompt", "consent select_account");
  url.searchParams.set("include_granted_scopes", "true");
  return url.toString();
}

export type GoogleIdentity = { sub: string; email: string; name?: string; picture?: string };

/**
 * The identity in an ID token received directly from Google's token
 * endpoint, over TLS, in exchange for our client secret. Its signature need
 * not be re-checked for that reason (Google's guidance for this flow), but
 * who it was issued to, by whom, and whether it is current still are.
 */
export function identityFromIdToken(idToken: string, clientId: string, now = Date.now()): GoogleIdentity {
  const [, payload] = idToken.split(".");
  if (!payload) throw new Error("Malformed ID token");
  const claims = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
  if (claims.aud !== clientId) throw new Error("ID token was issued to another app");
  if (claims.iss !== "https://accounts.google.com" && claims.iss !== "accounts.google.com") {
    throw new Error("ID token is not from Google");
  }
  if (typeof claims.exp !== "number" || claims.exp * 1000 < now) throw new Error("ID token has expired");
  if (!claims.sub || !claims.email) throw new Error("ID token has no identity");
  if (claims.email_verified === false) throw new Error("That Google account's email is not verified");
  return { sub: String(claims.sub), email: String(claims.email), name: claims.name, picture: claims.picture };
}

export async function exchangeCode(params: {
  code: string;
  verifier: string;
  redirectUri: string;
  clientId: string;
  clientSecret: string;
}): Promise<{ identity: GoogleIdentity; refreshToken?: string; accessToken: string }> {
  const res = await fetch(GOOGLE_TOKEN, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code: params.code,
      code_verifier: params.verifier,
      client_id: params.clientId,
      client_secret: params.clientSecret,
      redirect_uri: params.redirectUri,
      grant_type: "authorization_code",
    }),
    signal: AbortSignal.timeout(15000),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.id_token) throw new Error(`Google sign-in failed (${res.status})`);
  return {
    identity: identityFromIdToken(data.id_token, params.clientId),
    refreshToken: data.refresh_token,
    accessToken: data.access_token,
  };
}

export async function accessTokenFrom(refreshToken: string): Promise<string> {
  const config = googleConfig();
  if (!config) throw new Error("Google is not configured");
  const res = await fetch(GOOGLE_TOKEN, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: config.clientId,
      client_secret: config.clientSecret,
      refresh_token: refreshToken,
      grant_type: "refresh_token",
    }),
    signal: AbortSignal.timeout(15000),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.access_token) throw new Error(`Google refused the stored sign-in (${res.status})`);
  return data.access_token;
}

/* ------------------------------------------------------------------------ */
/* Drive                                                                     */
/* ------------------------------------------------------------------------ */

const DRIVE = "https://www.googleapis.com/drive/v3/files";
const UPLOAD = "https://www.googleapis.com/upload/drive/v3/files";
const DOC = "application/vnd.google-apps.document";
const FOLDER = "application/vnd.google-apps.folder";

/**
 * One call to Drive. It gives up after 20 seconds, or at `deadline` (a time,
 * in ms) if that comes first: a backup has to answer before its function is
 * stopped, and one stopped mid-way answers nothing at all.
 */
async function drive(accessToken: string, url: string, init: RequestInit = {}, deadline?: number) {
  const wait = Math.max(1000, Math.min(20000, deadline ? deadline - Date.now() : 20000));
  const res = await fetch(url, {
    ...init,
    headers: { authorization: `Bearer ${accessToken}`, ...(init.headers ?? {}) },
    signal: AbortSignal.timeout(wait),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) console.error("drive request failed", res.status, JSON.stringify(data?.error ?? data).slice(0, 500));
  return { ok: res.ok, status: res.status, data };
}

/**
 * What a refusal from Drive means, in words that say what to do. The two
 * 403s that matter are both setup, not bugs: the Drive API switched off in
 * the Cloud project, or the Drive box left unticked when signing in.
 */
export function driveProblem(status: number, data: { error?: { message?: string; errors?: { reason?: string }[]; details?: { reason?: string }[] } }, doing: string) {
  const reasons = [
    ...(data?.error?.errors ?? []).map((e) => e.reason),
    ...(data?.error?.details ?? []).map((e) => e.reason),
  ].join(" ");
  const message = data?.error?.message ?? "";
  if (/accessNotConfigured|SERVICE_DISABLED/i.test(reasons) || /has not been used|is disabled/i.test(message)) {
    return `Could not ${doing}: the Google Drive API is not enabled for this app's Google Cloud project. Enable it under APIs & Services → Library → Google Drive API, wait a minute, and try again.`;
  }
  if (/insufficientPermissions|ACCESS_TOKEN_SCOPE_INSUFFICIENT/i.test(reasons) || /insufficient/i.test(message)) {
    return `Could not ${doing}: Google Drive access was not granted. Sign out, sign in again, and tick the box that lets Super Reader create files in your Drive.`;
  }
  return `Could not ${doing} (${status}${message ? `: ${message}` : ""})`;
}

export async function createFolder(accessToken: string, name: string): Promise<string> {
  const { ok, status, data } = await drive(accessToken, `${DRIVE}?fields=id`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ name, mimeType: FOLDER }),
  });
  if (!ok || !data.id) throw new Error(driveProblem(status, data, "create the backup folder"));
  return data.id;
}

/** Whether a file this app made is still there (not deleted or trashed). */
export async function fileAlive(accessToken: string, fileId: string, deadline?: number): Promise<boolean> {
  const { ok, data } = await drive(accessToken, `${DRIVE}/${encodeURIComponent(fileId)}?fields=id,trashed`, {}, deadline);
  return ok && !data.trashed;
}

function multipart(metadata: object, html: string) {
  const boundary = `sr${Math.random().toString(36).slice(2)}`;
  const body =
    `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(metadata)}\r\n` +
    `--${boundary}\r\nContent-Type: text/html; charset=UTF-8\r\n\r\n${html}\r\n--${boundary}--`;
  return { body, contentType: `multipart/related; boundary=${boundary}` };
}

/** A new Google Doc from HTML; Drive converts it. */
export async function createDoc(accessToken: string, params: { name: string; html: string; folder?: string }, deadline?: number) {
  const { body, contentType } = multipart(
    { name: params.name, mimeType: DOC, ...(params.folder ? { parents: [params.folder] } : {}) },
    params.html,
  );
  const { ok, status, data } = await drive(accessToken, `${UPLOAD}?uploadType=multipart&fields=id,webViewLink`, {
    method: "POST",
    headers: { "content-type": contentType },
    body,
  }, deadline);
  if (!ok || !data.id) throw new Error(driveProblem(status, data, "create the Google Doc"));
  return { id: data.id as string, url: (data.webViewLink as string) ?? `https://docs.google.com/document/d/${data.id}/edit` };
}

/** Replace a Doc's contents (and title) with new HTML. */
export async function updateDoc(accessToken: string, fileId: string, params: { name: string; html: string }, deadline?: number) {
  const { body, contentType } = multipart({ name: params.name }, params.html);
  const { ok, status, data } = await drive(
    accessToken,
    `${UPLOAD}/${encodeURIComponent(fileId)}?uploadType=multipart&fields=id`,
    { method: "PATCH", headers: { "content-type": contentType }, body },
    deadline,
  );
  if (!ok) throw new Error(driveProblem(status, data, "update the Google Doc"));
}
