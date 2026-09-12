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
  return new Date(then).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

/**
 * When a source gave a day and no time.
 *
 * "8:00 PM" under a Federal Register notice is a time nobody stated — the
 * source said the twelfth of September and the stamp behind it is the issue's
 * release time, kept so the thing sorts into the right place. Showing the
 * date is what the source actually claimed.
 */
export function dayLabel(iso?: string) {
  if (!iso) return "";
  const then = Date.parse(iso);
  if (Number.isNaN(then)) return "";

  const date = new Date(then);
  const now = new Date();
  const midnight = (d: Date) =>
    new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const days = Math.round((midnight(now) - midnight(date)) / 86_400_000);

  if (days === 0) return "today";
  if (days === 1) return "yesterday";
  return date.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    ...(date.getFullYear() === now.getFullYear() ? {} : { year: "numeric" }),
  });
}

/**
 * How old an article is, said the way its source knows it: a relative time
 * where there is a real timestamp, a date where there is only a day.
 */
export function published(article: {
  publishedAt?: string;
  datePrecision?: "day";
}) {
  return article.datePrecision === "day"
    ? dayLabel(article.publishedAt)
    : timeAgo(article.publishedAt);
}

export function hostOf(url: string) {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}
