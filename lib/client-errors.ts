/**
 * Errors from the reader's own browser, sent to the server log.
 *
 * A crash on a phone is otherwise invisible: the page just goes blank, the
 * developer's browser never shows it, and nothing reaches the logs. This
 * sends the message, the stack and the browser's own description of itself —
 * nothing the reader typed or read — so the next blank screen on an iPhone
 * comes with a cause attached. A handful per page load at most.
 */

let sent = 0;
const MAX_PER_LOAD = 5;

export function reportClientError(error: unknown, where: string) {
  if (typeof window === "undefined" || sent >= MAX_PER_LOAD) return;
  sent += 1;
  const err = error instanceof Error ? error : new Error(String(error));
  const body = JSON.stringify({
    where,
    message: String(err.message ?? "").slice(0, 500),
    stack: String(err.stack ?? "").slice(0, 3000),
    userAgent: navigator.userAgent.slice(0, 300),
    path: location.pathname,
  });
  try {
    if (navigator.sendBeacon?.("/api/client-error", new Blob([body], { type: "application/json" }))) return;
  } catch {
    /* fall through to fetch */
  }
  fetch("/api/client-error", { method: "POST", body, keepalive: true, headers: { "content-type": "application/json" } }).catch(() => {});
}

/** Catch what no component caught: errors in timers, events and promises. */
export function listenForClientErrors() {
  if (typeof window === "undefined") return () => {};
  const onError = (event: ErrorEvent) => reportClientError(event.error ?? event.message, "window.onerror");
  const onRejection = (event: PromiseRejectionEvent) => reportClientError(event.reason, "unhandledrejection");
  window.addEventListener("error", onError);
  window.addEventListener("unhandledrejection", onRejection);
  return () => {
    window.removeEventListener("error", onError);
    window.removeEventListener("unhandledrejection", onRejection);
  };
}
