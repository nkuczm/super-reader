/**
 * The address the person actually used to reach this server.
 *
 * Not `request.url`: a self-hosted Next server (the Cloud Run container)
 * builds that from the address it listens on, `http://0.0.0.0:8080`, not
 * the one in the browser. Vercel's own runtime hides this by passing
 * `x-forwarded-host`; Cloud Run passes the browser's `Host` header and
 * `x-forwarded-proto`. Read in that order, it is right on both, and on a
 * plain `next start` at localhost.
 *
 * Trusting Host here is safe for what it is used for: a browser always sends
 * the host it is talking to, so a cross-site page cannot make it lie, and
 * Google accepts only the sign-in callbacks registered with it.
 */
export function publicOrigin(request: Request): string {
  const url = new URL(request.url);
  const first = (value: string | null) => value?.split(",")[0].trim() || null;
  const host = first(request.headers.get("x-forwarded-host")) ?? first(request.headers.get("host")) ?? url.host;
  const proto = first(request.headers.get("x-forwarded-proto")) ?? url.protocol.replace(":", "");
  return `${proto === "https" ? "https" : "http"}://${host}`;
}

/** A path on this site, as the browser should be sent to it. */
export function sitePath(request: Request, path: string): URL {
  return new URL(path, publicOrigin(request));
}
