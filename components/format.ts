/*
 * Building a date formatter costs far more than using one, and these run for
 * every row of a list on every render: each is made once and kept.
 */
let oldDate: Intl.DateTimeFormat | undefined;

export function timeAgo(iso?: string) {
  if (!iso) return "";
  const then = Date.parse(iso);
  if (Number.isNaN(then)) return "";
  const mins = Math.round((Date.now() - then) / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days < 30) return `${days}d ago`;
  oldDate ??= new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", year: "numeric" });
  return oldDate.format(then);
}

const hosts = new Map<string, string>();

export function hostOf(url: string) {
  let host = hosts.get(url);
  if (host !== undefined) return host;
  try {
    host = new URL(url).hostname.replace(/^www\./, "");
  } catch {
    host = url;
  }
  if (hosts.size > 5000) hosts.clear();
  hosts.set(url, host);
  return host;
}
